const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const simpleWebAuthn = require('@simplewebauthn/server');
const prisma = require('../config/prisma');
const env = require('../config/env');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const auth = require('./auth.service');

const publicFailure = 'ไม่สามารถเข้าสู่ระบบด้วย Passkey ได้';
const unavailable = 'Passkey ยังไม่พร้อมใช้งานในสภาพแวดล้อมนี้';
const challengeHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeTransports = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').slice(0, 8) : [];

function assertEnabled(config = env) {
  if (!config.webAuthnEnabled || !config.webAuthnRpName || !config.webAuthnRpId || !config.webAuthnOrigin) {
    throw new HttpError(503, unavailable);
  }
}

function expectedChallenge(hash) {
  return (candidate) => {
    const actual = Buffer.from(challengeHash(candidate), 'hex');
    const expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  };
}

function createWebAuthnService({
  prismaClient = prisma,
  auditService = audit,
  authService = auth,
  webAuthnServer = simpleWebAuthn,
  config = env,
  clock = () => new Date()
} = {}) {
  const expiresAt = () => new Date(clock().getTime() + config.webAuthnChallengeTtlSeconds * 1000);

  async function persistChallenge({ purpose, userId, challenge }) {
    return prismaClient.webAuthnChallenge.create({
      data: { purpose, userId: userId || null, challengeHash: challengeHash(challenge), expiresAt: expiresAt() },
      select: { id: true }
    });
  }

  async function loadChallenge({ id, purpose, userId }) {
    const record = await prismaClient.webAuthnChallenge.findUnique({ where: { id } });
    const now = clock();
    if (!record || record.purpose !== purpose || record.consumedAt || record.expiresAt <= now || (userId !== undefined && record.userId !== userId)) {
      throw new HttpError(400, 'Passkey challenge ไม่ถูกต้องหรือหมดอายุ');
    }
    return record;
  }

  async function consumeChallenge(client, record) {
    const result = await client.webAuthnChallenge.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: clock() } },
      data: { consumedAt: clock() }
    });
    if (result.count !== 1) throw new HttpError(400, 'Passkey challenge ถูกใช้งานแล้วหรือหมดอายุ');
  }

  async function registrationOptions({ userId, currentPassword, displayName }) {
    assertEnabled(config);
    const user = await prismaClient.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.accountStatus !== 'ACTIVE' || user.passwordResetRequired) throw new HttpError(403, 'บัญชีนี้ไม่พร้อมเพิ่ม Passkey');
    const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordValid) throw new HttpError(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    const credentials = await prismaClient.webAuthnCredential.findMany({ where: { userId, revokedAt: null }, select: { credentialId: true, transports: true } });
    const options = await webAuthnServer.generateRegistrationOptions({
      rpName: config.webAuthnRpName,
      rpID: config.webAuthnRpId,
      userName: user.email,
      userDisplayName: user.displayName,
      userID: Buffer.from(user.id, 'utf8'),
      attestationType: 'none',
      timeout: config.webAuthnChallengeTtlSeconds * 1000,
      excludeCredentials: credentials.map((credential) => ({ id: credential.credentialId, transports: safeTransports(credential.transports) })),
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      preferredAuthenticatorType: 'localDevice'
    });
    const challenge = await persistChallenge({ purpose: 'REGISTRATION', userId, challenge: options.challenge });
    return { challengeId: challenge.id, options, displayName: String(displayName || 'Passkey').trim().slice(0, 120) || 'Passkey' };
  }

  async function verifyRegistration({ userId, challengeId, response, displayName }) {
    assertEnabled(config);
    const record = await loadChallenge({ id: challengeId, purpose: 'REGISTRATION', userId });
    await prismaClient.$transaction(async (tx) => consumeChallenge(tx, record));
    let verification;
    try {
      verification = await webAuthnServer.verifyRegistrationResponse({
        response,
        expectedChallenge: expectedChallenge(record.challengeHash),
        expectedOrigin: config.webAuthnOrigin,
        expectedRPID: config.webAuthnRpId,
        requireUserPresence: true,
        requireUserVerification: true
      });
    } catch {
      throw new HttpError(400, 'การยืนยัน Passkey ไม่ถูกต้อง');
    }
    if (!verification.verified || !verification.registrationInfo?.userVerified) throw new HttpError(400, 'การยืนยัน Passkey ไม่สำเร็จ');
    const info = verification.registrationInfo;
    const credential = info.credential;
    const name = String(displayName || 'Passkey').trim().slice(0, 120) || 'Passkey';
    try {
      return await prismaClient.$transaction(async (tx) => {
        const created = await tx.webAuthnCredential.create({
          data: {
            userId,
            credentialId: credential.id,
            publicKey: Buffer.from(credential.publicKey),
            counter: BigInt(credential.counter || 0),
            transports: safeTransports(response?.response?.transports || credential.transports),
            deviceType: info.credentialDeviceType,
            backedUp: Boolean(info.credentialBackedUp),
            displayName: name
          },
          select: { id: true, displayName: true, createdAt: true, lastUsedAt: true }
        });
        await auditService.log({ actorUserId: userId, action: 'PASSKEY_REGISTERED', entityType: 'WebAuthnCredential', entityId: created.id, metadata: { deviceType: info.credentialDeviceType, backedUp: Boolean(info.credentialBackedUp) } }, tx);
        return created;
      });
    } catch (error) {
      if (error?.code === 'P2002') throw new HttpError(409, 'Passkey นี้ถูกลงทะเบียนแล้ว');
      throw error;
    }
  }

  async function authenticationOptions() {
    assertEnabled(config);
    const options = await webAuthnServer.generateAuthenticationOptions({
      rpID: config.webAuthnRpId,
      timeout: config.webAuthnChallengeTtlSeconds * 1000,
      userVerification: 'required',
      allowCredentials: []
    });
    const challenge = await persistChallenge({ purpose: 'AUTHENTICATION', challenge: options.challenge });
    return { challengeId: challenge.id, options };
  }

  async function verifyAuthentication({ challengeId, response, requestId, request }) {
    assertEnabled(config);
    const record = await loadChallenge({ id: challengeId, purpose: 'AUTHENTICATION' });
    await prismaClient.$transaction(async (tx) => consumeChallenge(tx, record));
    const stored = response?.id ? await prismaClient.webAuthnCredential.findUnique({ where: { credentialId: response.id }, include: { user: true } }) : null;
    if (!stored || stored.revokedAt) {
      await auditService.log({ action: 'PASSKEY_LOGIN_FAILED', entityType: 'WebAuthnCredential', entityId: 'unknown', metadata: { requestId, reason: 'credential_unavailable' } });
      throw new HttpError(401, publicFailure);
    }
    let verification;
    try {
      verification = await webAuthnServer.verifyAuthenticationResponse({
        response,
        expectedChallenge: expectedChallenge(record.challengeHash),
        expectedOrigin: config.webAuthnOrigin,
        expectedRPID: config.webAuthnRpId,
        credential: { id: stored.credentialId, publicKey: new Uint8Array(stored.publicKey), counter: Number(stored.counter), transports: safeTransports(stored.transports) },
        requireUserVerification: true,
        advancedFIDOConfig: { userVerification: 'required' }
      });
    } catch {
      await auditService.log({ actorUserId: stored.userId, action: 'PASSKEY_LOGIN_FAILED', entityType: 'WebAuthnCredential', entityId: stored.id, metadata: { requestId, reason: 'verification_failed' } });
      throw new HttpError(401, publicFailure);
    }
    if (!verification.verified || !verification.authenticationInfo?.userVerified) {
      await auditService.log({ actorUserId: stored.userId, action: 'PASSKEY_LOGIN_FAILED', entityType: 'WebAuthnCredential', entityId: stored.id, metadata: { requestId, reason: 'user_verification_required' } });
      throw new HttpError(401, publicFailure);
    }
    await prismaClient.$transaction(async (tx) => {
      await tx.webAuthnCredential.update({ where: { id: stored.id }, data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: clock(), deviceType: verification.authenticationInfo.credentialDeviceType, backedUp: Boolean(verification.authenticationInfo.credentialBackedUp) } });
    });
    try {
      return await authService.loginVerifiedUser(stored.userId, requestId, request, { auditAction: 'PASSKEY_LOGIN_SUCCESS', credentialId: stored.id });
    } catch (error) {
      await auditService.log({ actorUserId: stored.userId, action: 'PASSKEY_LOGIN_FAILED', entityType: 'WebAuthnCredential', entityId: stored.id, metadata: { requestId, reason: 'account_not_eligible' } });
      throw error instanceof HttpError ? error : new HttpError(401, publicFailure);
    }
  }

  async function listCredentials(userId) {
    assertEnabled(config);
    return prismaClient.webAuthnCredential.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, displayName: true, createdAt: true, lastUsedAt: true, deviceType: true, backedUp: true }
    });
  }

  async function renameCredential({ userId, credentialId, displayName }) {
    assertEnabled(config);
    const name = String(displayName || '').trim().slice(0, 120);
    if (!name) throw new HttpError(400, 'กรุณาระบุชื่อ Passkey');
    const result = await prismaClient.webAuthnCredential.updateMany({ where: { id: credentialId, userId, revokedAt: null }, data: { displayName: name } });
    if (result.count !== 1) throw new HttpError(404, 'ไม่พบ Passkey');
    return { id: credentialId, displayName: name };
  }

  async function revokeCredential({ userId, credentialId, currentPassword }) {
    assertEnabled(config);
    const user = await prismaClient.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new HttpError(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    return prismaClient.$transaction(async (tx) => {
      const result = await tx.webAuthnCredential.updateMany({ where: { id: credentialId, userId, revokedAt: null }, data: { revokedAt: clock() } });
      if (result.count !== 1) throw new HttpError(404, 'ไม่พบ Passkey');
      await auditService.log({ actorUserId: userId, action: 'PASSKEY_REVOKED', entityType: 'WebAuthnCredential', entityId: credentialId, metadata: { reason: 'user_revoked' } }, tx);
      return { id: credentialId, revoked: true };
    });
  }

  return { registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication, listCredentials, renameCredential, revokeCredential };
}

module.exports = { createWebAuthnService, publicFailure, unavailable, challengeHash, expectedChallenge };
