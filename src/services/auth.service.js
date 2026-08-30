const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const env = require('../config/env');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { logger } = require('../utils/logger');
const { synchronizeDueLifecycleEventsForEmployee } = require('./employee-lifecycle.service');

const genericFailure = 'Invalid email or password.';
const refreshFailure = 'Invalid or expired refresh token.';
const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const requestMeta = (request = {}) => ({ userAgent: request.userAgent?.slice(0, 500), ipAddress: request.ipAddress?.slice(0, 64) });
const isLoginEligible = (user) => Boolean(user && user.isActive && user.accountStatus === 'ACTIVE' && !user.passwordResetRequired);

function internalAccountStateError() {
  const error = new Error('Authoritative account state no longer permits login.');
  error.code = 'AUTH_ACCOUNT_STATE_INVALID_INTERNAL';
  return error;
}

function logLoginPerformanceStage(requestId, stage, startedAt, status = 'ok') {
  logger.info('performance_stage', { requestId, operation: 'auth_login', stage, durationMs: Number((performance.now() - startedAt).toFixed(2)), status });
}

function accessTokenFor(user, options = {}) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion, ...(options.impersonatorSub && { impersonation: true, impersonatorSub: options.impersonatorSub, impersonatorTokenVersion: options.impersonatorTokenVersion }) }, env.jwtSecret, { algorithm: env.jwtAlgorithm, expiresIn: options.expiresIn || env.jwtExpiresIn, issuer: env.jwtIssuer, audience: env.jwtAudience });
}

async function createSessionTokens(user, request, client) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);
  await client.refreshSession.create({ data: { userId: user.id, refreshTokenHash: hashRefreshToken(refreshToken), tokenVersion: user.tokenVersion, expiresAt, ...requestMeta(request) } });
  return { accessToken: accessTokenFor(user), refreshToken, tokenType: 'Bearer' };
}

async function recordPasswordLoginFailure(user, requestId, operationStartedAt) {
  if (user) {
    try {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } });
    } catch (error) {
      if (error?.code !== 'P2025') throw error;
      user = null;
    }
  }
  await audit.log({ actorUserId: user?.id, action: 'LOGIN_FAILED', entityType: 'User', entityId: user?.id || 'unknown', metadata: { requestId } });
  logger.warn('authentication_failure', { requestId, errorCategory: 'invalid_credentials_or_inactive', status: 401 });
  logger.info('performance_operation', { requestId, operation: 'auth_login', durationMs: Number((performance.now() - operationStartedAt).toFixed(2)), status: 'denied' });
  throw new HttpError(401, genericFailure);
}

async function login(email, password, requestId, request) {
  const operationStartedAt = performance.now();
  let stageStartedAt = performance.now();
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  logLoginPerformanceStage(requestId, 'AUTH_USER_LOOKUP', stageStartedAt);

  stageStartedAt = performance.now();
  const credentialsValid = Boolean(user && await bcrypt.compare(password, user.passwordHash));
  logLoginPerformanceStage(requestId, 'AUTH_PASSWORD_VERIFY', stageStartedAt, credentialsValid ? 'ok' : 'denied');

  if (!credentialsValid) return recordPasswordLoginFailure(user, requestId, operationStartedAt);

  if (user.employeeId) {
    stageStartedAt = performance.now();
    await synchronizeDueLifecycleEventsForEmployee(user.employeeId);
    logLoginPerformanceStage(requestId, 'AUTH_EMPLOYEE_LIFECYCLE_SYNC', stageStartedAt);
  }

  stageStartedAt = performance.now();
  let sessionResult;
  try {
    sessionResult = await prisma.$transaction(async (tx) => {
      const current = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0 } });
      if (!isLoginEligible(current)) throw internalAccountStateError();
      const issued = await createSessionTokens(current, request, tx);
      await audit.log({ actorUserId: current.id, action: 'LOGIN', entityType: 'User', entityId: current.id, metadata: { requestId } }, tx);
      return { issued, current };
    });
  } catch (error) {
    if (error?.code !== 'AUTH_ACCOUNT_STATE_INVALID_INTERNAL' && error?.code !== 'P2025') throw error;
    return recordPasswordLoginFailure(error?.code === 'P2025' ? null : user, requestId, operationStartedAt);
  }

  logLoginPerformanceStage(requestId, 'AUTH_SESSION_CREATE', stageStartedAt);
  logger.info('performance_operation', { requestId, operation: 'auth_login', durationMs: Number((performance.now() - operationStartedAt).toFixed(2)), status: 'ok' });
  const { issued, current } = sessionResult;
  return { ...issued, user: { id: current.id, email: current.email, displayName: current.displayName, role: current.role } };
}

async function loginVerifiedUser(userId, requestId, request, { auditAction = 'PASSKEY_LOGIN_SUCCESS', credentialId } = {}) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(401, genericFailure);
  if (user.employeeId) await synchronizeDueLifecycleEventsForEmployee(user.employeeId);

  try {
    const { issued, current } = await prisma.$transaction(async (tx) => {
      const current = await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0 } });
      if (!isLoginEligible(current)) throw internalAccountStateError();
      const issued = await createSessionTokens(current, request, tx);
      await audit.log({ actorUserId: current.id, action: auditAction, entityType: credentialId ? 'WebAuthnCredential' : 'User', entityId: credentialId || current.id, metadata: { requestId, authenticationMethod: credentialId ? 'passkey' : 'verified' } }, tx);
      return { issued, current };
    });
    return { ...issued, user: { id: current.id, email: current.email, displayName: current.displayName, role: current.role, department: current.department } };
  } catch (error) {
    if (error?.code === 'AUTH_ACCOUNT_STATE_INVALID_INTERNAL' || error?.code === 'P2025') throw new HttpError(401, genericFailure);
    throw error;
  }
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
  let session = await prisma.refreshSession.findUnique({ where: { refreshTokenHash: tokenHash }, include: { user: true } });
  if (!session) {
    logger.warn('refresh_failure', { requestId, errorCategory: 'session_not_found', status: 401 });
    throw new HttpError(401, refreshFailure);
  }
  if (session.user.employeeId) {
    await synchronizeDueLifecycleEventsForEmployee(session.user.employeeId);
    session = await prisma.refreshSession.findUnique({ where: { id: session.id }, include: { user: true } });
  }
  if (!session) throw new HttpError(401, refreshFailure);
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

module.exports = { login, loginVerifiedUser, refresh, logout, logoutAll, genericFailure, refreshFailure, hashRefreshToken, accessTokenFor };
