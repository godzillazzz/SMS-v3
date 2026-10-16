const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const env = require('../config/env');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { logger } = require('../utils/logger');

const genericFailure = 'Invalid email or password.';
const refreshFailure = 'Invalid or expired refresh token.';
const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const requestMeta = (request = {}) => ({ userAgent: request.userAgent?.slice(0, 500), ipAddress: request.ipAddress?.slice(0, 64) });
function accessTokenFor(user, options = {}) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion, ...(options.impersonatorSub && { impersonation: true, impersonatorSub: options.impersonatorSub, impersonatorTokenVersion: options.impersonatorTokenVersion }) }, env.jwtSecret, { algorithm: env.jwtAlgorithm, expiresIn: options.expiresIn || env.jwtExpiresIn, issuer: env.jwtIssuer, audience: env.jwtAudience });
}
async function createSessionTokens(user, request, client) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);
  await client.refreshSession.create({ data: { userId: user.id, refreshTokenHash: hashRefreshToken(refreshToken), tokenVersion: user.tokenVersion, expiresAt, ...requestMeta(request) } });
  return { accessToken: accessTokenFor(user), refreshToken, tokenType: 'Bearer' };
}

async function login(email, password, requestId, request) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive || user.accountStatus !== 'ACTIVE' || user.passwordResetRequired || !(await bcrypt.compare(password, user.passwordHash))) {
    if (user) await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } });
    await audit.log({ actorUserId: user?.id, action: 'LOGIN_FAILED', entityType: 'User', entityId: user?.id || 'unknown', metadata: { requestId } });
    logger.warn('authentication_failure', { requestId, errorCategory: 'invalid_credentials_or_inactive', status: 401 });
    throw new HttpError(401, genericFailure);
  }
  const tokens = await prisma.$transaction(async (tx) => {
    const current = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0 } });
    const issued = await createSessionTokens(current, request, tx);
    await audit.log({ actorUserId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, metadata: { requestId } }, tx);
    return issued;
  });
  return { ...tokens, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } };
}

async function revokeAllForUser(userId, action, requestId, client) {
  await client.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  const user = await client.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await audit.log({ actorUserId: userId, action, entityType: 'User', entityId: userId, metadata: { requestId } }, client);
  return user;
}

async function refresh(refreshToken, requestId, request) {
  if (!refreshToken) {
    logger.warn('refresh_failure', { requestId, errorCategory: 'session_missing', status: 401 });
    throw new HttpError(401, refreshFailure);
  }
  const tokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.refreshSession.findUnique({ where: { refreshTokenHash: tokenHash }, include: { user: true } });
  if (!session) {
    logger.warn('refresh_failure', { requestId, errorCategory: 'session_not_found', status: 401 });
    throw new HttpError(401, refreshFailure);
  }
  const invalid = session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive || session.user.accountStatus !== 'ACTIVE' || session.user.passwordResetRequired || session.tokenVersion !== session.user.tokenVersion;
  if (invalid) {
    if (session.revokedAt) await prisma.$transaction((tx) => revokeAllForUser(session.userId, 'TOKEN_REUSE', requestId, tx));
    logger.warn('refresh_failure', { requestId, errorCategory: 'session_invalid', status: 401 });
    throw new HttpError(401, refreshFailure);
  }
  return prisma.$transaction(async (tx) => {
    await tx.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
    const tokens = await createSessionTokens(session.user, request, tx);
    await audit.log({ actorUserId: session.userId, action: 'REFRESH', entityType: 'RefreshSession', entityId: session.id, metadata: { requestId } }, tx);
    return { ...tokens, user: { id: session.user.id, email: session.user.email, displayName: session.user.displayName, role: session.user.role, department: session.user.department } };
  });
}

async function logout(refreshToken, requestId) {
  const session = await prisma.refreshSession.findUnique({ where: { refreshTokenHash: hashRefreshToken(refreshToken) } });
  if (!session || session.revokedAt) return;
  await prisma.$transaction(async (tx) => {
    await tx.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), lastUsedAt: new Date() } });
    await audit.log({ actorUserId: session.userId, action: 'LOGOUT', entityType: 'RefreshSession', entityId: session.id, metadata: { requestId } }, tx);
  });
}

async function logoutAll(userId, requestId) { await prisma.$transaction((tx) => revokeAllForUser(userId, 'LOGOUT_ALL', requestId, tx)); }

module.exports = { login, refresh, logout, logoutAll, genericFailure, refreshFailure, hashRefreshToken, accessTokenFor };
