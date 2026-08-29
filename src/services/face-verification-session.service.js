'use strict';

const crypto = require('crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { deriveActiveFaceChallenge } = require('./active-face-challenge.service');

const PURPOSES = new Set(['ATTENDANCE_EVENT', 'PATROL_EVENT']);
const VERIFICATION_MODES = new Set(['FACE_MATCH_ONLY', 'FACE_MATCH_WITH_LIVENESS']);
const ACTIVE_SESSION_STATUSES = ['CREATED', 'DEVICE_PROOF_VERIFIED', 'PROVIDER_PENDING', 'VERIFIED'];
const RESTARTABLE_SESSION_STATUSES = ['CREATED', 'DEVICE_PROOF_VERIFIED'];
const SESSION_TTL_MS = 5 * 60 * 1000;
const RECEIPT_TTL_MS = 2 * 60 * 1000;

function http(statusCode, code, message) { return new HttpError(statusCode, message, { code }); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function challengeHash(value) { return sha256(Buffer.from(String(value || ''), 'utf8')); }
function receiptHash(value) { return sha256(Buffer.from(String(value || ''), 'utf8')); }
function providerRefHash(value) { return sha256(Buffer.from(String(value || ''), 'utf8')); }
function digest64(value, code = 'FACE_VERIFICATION_CONTEXT_INVALID') { const text = String(value || '').trim().toLowerCase(); if (!/^[0-9a-f]{64}$/.test(text)) throw http(400, code, 'A SHA-256 context digest is required.'); return text; }
function clean(value, max) { const text = value == null ? '' : String(value).trim(); return text ? text.slice(0, max) : null; }
function safeSession(row) { return row ? { id: row.id, employeeId: row.employeeId, userId: row.userId, deviceEnrollmentId: row.deviceEnrollmentId, referencePhotoId: row.referencePhotoId, purpose: row.purpose, verificationMode: row.verificationMode, status: row.status, contextDigest: row.contextDigest, provider: row.provider, providerPolicyProfileId: row.providerPolicyProfileId, providerEngineVersion: row.providerEngineVersion, providerResultCode: row.providerResultCode, padPassed: row.padPassed, faceMatchPassed: row.faceMatchPassed, injectionRiskDetected: row.injectionRiskDetected, deviceProofVerifiedAt: row.deviceProofVerifiedAt, verifiedAt: row.verifiedAt, failedAt: row.failedAt, failureCode: row.failureCode, expiresAt: row.expiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt } : null; }
function mapConflict(error) { if (error?.code === 'P2002') return http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed. Please start a new verification.'); return error; }

function createFaceVerificationSessionService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  async function linkedEmployee(client, actor) {
    const user = await client.user.findUnique({ where: { id: actor?.sub }, select: { id: true, employeeId: true, isActive: true, accountStatus: true, employee: { select: { id: true, isActive: true, deletedAt: true } } } });
    if (!user?.employeeId || !user.employee) throw http(403, 'FACE_VERIFICATION_EMPLOYEE_LINK_REQUIRED', 'A linked employee account is required.');
    if (!user.isActive || user.accountStatus !== 'ACTIVE' || !user.employee.isActive || user.employee.deletedAt) throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot perform face verification.');
    return { userId: user.id, employeeId: user.employee.id };
  }

  async function exactActiveBinding(client, employeeId) {
    const [devices, photos] = await Promise.all([
      client.attendanceDeviceEnrollment.findMany({ where: { employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' }, take: 2 }),
      client.employeeReferencePhoto.findMany({ where: { employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' }, take: 2 })
    ]);
    if (devices.length !== 1) throw http(409, devices.length ? 'ATTENDANCE_DEVICE_AUTHORITY_CONFLICT' : 'ATTENDANCE_DEVICE_REQUIRED', devices.length ? 'Attendance device authority is inconsistent.' : 'An active Attendance device is required.');
    if (photos.length !== 1) throw http(409, photos.length ? 'FACE_REFERENCE_AUTHORITY_CONFLICT' : 'FACE_REFERENCE_REQUIRED', photos.length ? 'Reference Photo authority is inconsistent.' : 'An active Employee Reference Photo is required.');
    if (photos[0].storageDeletedAt || photos[0].storageDeletionRequestedAt) throw http(409, 'FACE_REFERENCE_STALE', 'The active Reference Photo is not available for verification.');
    return { device: devices[0], referencePhoto: photos[0] };
  }

  async function expireSessionById(sessionId, failureCode = 'VERIFICATION_EXPIRED') {
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const session = await tx.faceVerificationSession.findUnique({ where: { id: sessionId } });
      if (!session) throw http(404, 'FACE_VERIFICATION_SESSION_NOT_FOUND', 'Face verification session not found.');
      if (!ACTIVE_SESSION_STATUSES.includes(session.status)) return safeSession(session);
      const claimed = await tx.faceVerificationSession.updateMany({ where: { id: session.id, status: { in: ACTIVE_SESSION_STATUSES } }, data: { status: 'EXPIRED', failedAt: now, failureCode } });
      if (claimed.count === 1) await audit.log({ actorUserId: session.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: session.id, metadata: { event: 'VERIFICATION_EXPIRED', failureCode, purpose: session.purpose } }, tx);
      return safeSession(await tx.faceVerificationSession.findUnique({ where: { id: session.id } }));
    });
  }

  async function failSession(sessionId, failureCode, metadata = {}) {
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const session = await tx.faceVerificationSession.findUnique({ where: { id: sessionId } });
      if (!session) throw http(404, 'FACE_VERIFICATION_SESSION_NOT_FOUND', 'Face verification session not found.');
      if (['FAILED', 'EXPIRED', 'CONSUMED'].includes(session.status)) return safeSession(session);
      const claimed = await tx.faceVerificationSession.updateMany({ where: { id: sessionId, status: { in: ACTIVE_SESSION_STATUSES } }, data: { status: 'FAILED', failedAt: now, failureCode } });
      if (claimed.count !== 1) throw http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed.');
      await audit.log({ actorUserId: session.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: session.id, metadata: { event: 'VERIFICATION_FAILED', failureCode, ...metadata } }, tx);
      return safeSession(await tx.faceVerificationSession.findUnique({ where: { id: sessionId } }));
    });
  }

  async function createSession({ actor, purpose, contextDigest }) {
    if (!PURPOSES.has(purpose)) throw http(400, 'FACE_VERIFICATION_PURPOSE_INVALID', 'Unsupported face verification purpose.');
    const context = digest64(contextDigest);
    const now = clock(); const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const challenge = randomBytes(32).toString('base64url');
    try {
      return await prisma.$transaction(async (tx) => {
        const identity = await linkedEmployee(tx, actor);
        const binding = await exactActiveBinding(tx, identity.employeeId);
        await tx.faceVerificationSession.updateMany({ where: { employeeId: identity.employeeId, deviceEnrollmentId: binding.device.id, purpose, status: { in: ACTIVE_SESSION_STATUSES }, expiresAt: { lte: now } }, data: { status: 'EXPIRED', failedAt: now, failureCode: 'VERIFICATION_EXPIRED' } });
        const existing = await tx.faceVerificationSession.findFirst({ where: { employeeId: identity.employeeId, deviceEnrollmentId: binding.device.id, purpose, status: { in: ACTIVE_SESSION_STATUSES }, expiresAt: { gt: now } }, select: { id: true, status: true } });
        if (existing && RESTARTABLE_SESSION_STATUSES.includes(existing.status)) {
          const superseded = await tx.faceVerificationSession.updateMany({
            where: { id: existing.id, status: { in: RESTARTABLE_SESSION_STATUSES }, expiresAt: { gt: now } },
            data: { status: 'FAILED', failedAt: now, failureCode: 'VERIFICATION_SUPERSEDED' }
          });
          if (superseded.count !== 1) throw http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed.');
          await audit.log({ actorUserId: identity.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: existing.id, metadata: { event: 'VERIFICATION_SUPERSEDED', purpose } }, tx);
        } else if (existing) {
          throw http(409, 'FACE_VERIFICATION_SESSION_ALREADY_ACTIVE', 'A face verification session is already active.');
        }
        await tx.attendanceDeviceChallenge.updateMany({ where: { employeeId: identity.employeeId, deviceEnrollmentId: binding.device.id, purpose, consumedAt: null }, data: { consumedAt: now } });
        const deviceChallenge = await tx.attendanceDeviceChallenge.create({ data: { employeeId: identity.employeeId, deviceEnrollmentId: binding.device.id, purpose, challengeHash: challengeHash(challenge), expiresAt } });
        const session = await tx.faceVerificationSession.create({ data: { employeeId: identity.employeeId, userId: identity.userId, deviceEnrollmentId: binding.device.id, deviceCredentialFingerprint: binding.device.credentialFingerprint, referencePhotoId: binding.referencePhoto.id, referencePhotoChecksum: binding.referencePhoto.checksum, deviceChallengeId: deviceChallenge.id, purpose, contextDigest: context, expiresAt } });
        await audit.log({ actorUserId: identity.userId, action: 'CREATE', entityType: 'FaceVerificationSession', entityId: session.id, metadata: { event: 'SESSION_CREATED', employeeId: identity.employeeId, deviceEnrollmentId: binding.device.id, referencePhotoId: binding.referencePhoto.id, purpose, contextDigest: context } }, tx);
        return { session: safeSession(session), challengeId: deviceChallenge.id, challenge, keyAlgorithm: binding.device.keyAlgorithm, activeChallenge: deriveActiveFaceChallenge(session.id) };
      });
    } catch (error) { throw mapConflict(error); }
  }

  async function verifyDeviceProof({ actor, sessionId, challengeId, challenge, signatureBase64 }) {
    const now = clock();
    let snapshot;
    try { snapshot = await prisma.$transaction(async (tx) => {
      const session = await tx.faceVerificationSession.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== actor?.sub) throw http(404, 'FACE_VERIFICATION_SESSION_NOT_FOUND', 'Face verification session not found.');
      if (session.status !== 'CREATED') throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Face verification session is not awaiting device proof.');
      if (session.expiresAt <= now) throw http(410, 'VERIFICATION_EXPIRED', 'Face verification session expired.');
      const stored = await tx.attendanceDeviceChallenge.findUnique({ where: { id: challengeId } });
      if (!stored || stored.id !== session.deviceChallengeId || stored.employeeId !== session.employeeId || stored.deviceEnrollmentId !== session.deviceEnrollmentId || stored.purpose !== session.purpose || stored.consumedAt || stored.expiresAt <= now || stored.challengeHash !== challengeHash(challenge)) throw http(400, 'ATTENDANCE_DEVICE_CHALLENGE_INVALID', 'Device proof challenge is invalid or expired.');
      const consumed = await tx.attendanceDeviceChallenge.updateMany({ where: { id: stored.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw http(400, 'ATTENDANCE_DEVICE_CHALLENGE_INVALID', 'Device proof challenge is invalid or expired.');
      const device = await tx.attendanceDeviceEnrollment.findUnique({ where: { id: session.deviceEnrollmentId } });
      if (!device) throw http(409, 'ATTENDANCE_DEVICE_REQUIRED', 'Active Attendance device is required.');
      return { session, device };
    }); } catch (error) { if (error?.details?.code === 'VERIFICATION_EXPIRED') await expireSessionById(sessionId).catch(() => {}); throw error; }
    let signature; let challengeBytes;
    try { signature = Buffer.from(String(signatureBase64 || ''), 'base64'); challengeBytes = Buffer.from(String(challenge || ''), 'base64url'); } catch { signature = Buffer.alloc(0); challengeBytes = Buffer.alloc(0); }
    let verified = false;
    if (signature.length && challengeBytes.length) {
      try { const key = crypto.createPublicKey({ key: snapshot.device.publicKey, format: 'der', type: 'spki' }); verified = crypto.verify('sha256', challengeBytes, { key, dsaEncoding: 'ieee-p1363' }, signature); if (!verified) verified = crypto.verify('sha256', challengeBytes, key, signature); } catch {}
    }
    if (!verified) { await failSession(sessionId, 'DEVICE_PROOF_FAILED'); throw http(400, 'DEVICE_PROOF_FAILED', 'Attendance device proof failed.'); }
    try {
      return await prisma.$transaction(async (tx) => {
        const session = await tx.faceVerificationSession.findUnique({ where: { id: sessionId } });
        if (!session || session.userId !== actor?.sub || session.status !== 'CREATED' || session.expiresAt <= now) throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Face verification session changed during device proof.');
        const identity = await linkedEmployee(tx, actor);
        if (identity.employeeId !== session.employeeId) throw http(409, 'VERIFICATION_STALE', 'Employee authority changed during verification.');
        const binding = await exactActiveBinding(tx, session.employeeId);
        if (binding.device.id !== session.deviceEnrollmentId || binding.device.credentialFingerprint !== session.deviceCredentialFingerprint || binding.referencePhoto.id !== session.referencePhotoId || binding.referencePhoto.checksum !== session.referencePhotoChecksum) throw http(409, 'VERIFICATION_STALE', 'Device or Reference Photo authority changed during verification.');
        const claimed = await tx.faceVerificationSession.updateMany({ where: { id: session.id, status: 'CREATED', expiresAt: { gt: now } }, data: { status: 'DEVICE_PROOF_VERIFIED', deviceProofVerifiedAt: now } });
        if (claimed.count !== 1) throw http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed.');
        await audit.log({ actorUserId: session.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: session.id, metadata: { event: 'DEVICE_PROOF_VERIFIED', employeeId: session.employeeId, deviceEnrollmentId: session.deviceEnrollmentId, purpose: session.purpose } }, tx);
        return safeSession(await tx.faceVerificationSession.findUnique({ where: { id: session.id } }));
      });
    } catch (error) { if (error?.details?.code === 'VERIFICATION_STALE') await failSession(sessionId, 'VERIFICATION_STALE').catch(() => {}); throw mapConflict(error); }
  }

  async function bindProviderSession({ sessionId, provider, providerSessionRef, verificationMode = 'FACE_MATCH_WITH_LIVENESS', policyProfileId = null, engineVersion = null }) {
    const now = clock(); const providerName = clean(provider, 80); const providerRef = clean(providerSessionRef, 1000); const mode = clean(verificationMode, 80);
    if (!providerName || !providerRef) throw http(400, 'VERIFICATION_PROVIDER_SESSION_INVALID', 'Provider session metadata is required.');
    if (!VERIFICATION_MODES.has(mode)) throw http(400, 'FACE_VERIFICATION_MODE_INVALID', 'Unsupported face verification mode.');
    try {
      return await prisma.$transaction(async (tx) => {
        const session = await tx.faceVerificationSession.findUnique({ where: { id: sessionId } });
        if (!session) throw http(404, 'FACE_VERIFICATION_SESSION_NOT_FOUND', 'Face verification session not found.');
        if (session.status !== 'DEVICE_PROOF_VERIFIED') throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Device proof is required before provider capture.');
        if (session.expiresAt <= now) throw http(410, 'VERIFICATION_EXPIRED', 'Face verification session expired.');
        const claimed = await tx.faceVerificationSession.updateMany({ where: { id: session.id, status: 'DEVICE_PROOF_VERIFIED', expiresAt: { gt: now } }, data: { status: 'PROVIDER_PENDING', provider: providerName, providerSessionRefHash: providerRefHash(providerRef), verificationMode: mode, providerPolicyProfileId: clean(policyProfileId, 120), providerEngineVersion: clean(engineVersion, 120) } });
        if (claimed.count !== 1) throw http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed.');
        await audit.log({ actorUserId: session.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: session.id, metadata: { event: 'PROVIDER_SESSION_BOUND', provider: providerName, verificationMode: mode, policyProfileId: clean(policyProfileId, 120), engineVersion: clean(engineVersion, 120) } }, tx);
        return safeSession(await tx.faceVerificationSession.findUnique({ where: { id: session.id } }));
      });
    } catch (error) { if (error?.details?.code === 'VERIFICATION_EXPIRED') await expireSessionById(sessionId).catch(() => {}); throw mapConflict(error); }
  }

  async function recordTrustedProviderResult({ sessionId, providerSessionRef, padPassed, faceMatchPassed, injectionRiskDetected = false, resultCode = null, policyProfileId = null, engineVersion = null }) {
    const now = clock(); const providerRef = clean(providerSessionRef, 1000);
    if (!providerRef) throw http(400, 'VERIFICATION_PROVIDER_SESSION_INVALID', 'Provider session metadata is required.');
    const snapshot = await prisma.faceVerificationSession.findUnique({ where: { id: sessionId } });
    if (!snapshot) throw http(404, 'FACE_VERIFICATION_SESSION_NOT_FOUND', 'Face verification session not found.');
    if (snapshot.status !== 'PROVIDER_PENDING') throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Face verification session is not awaiting a trusted provider result.');
    if (snapshot.verificationMode !== 'FACE_MATCH_WITH_LIVENESS') throw http(409, 'FACE_VERIFICATION_MODE_MISMATCH', 'Face verification mode does not accept a liveness result.');
    if (snapshot.expiresAt <= now) { await expireSessionById(sessionId); throw http(410, 'VERIFICATION_EXPIRED', 'Face verification session expired.'); }
    if (!snapshot.providerSessionRefHash || snapshot.providerSessionRefHash !== providerRefHash(providerRef)) { await failSession(sessionId, 'VERIFICATION_PROVIDER_SESSION_MISMATCH'); throw http(409, 'VERIFICATION_PROVIDER_SESSION_MISMATCH', 'Trusted provider session does not match.'); }
    const trustedResult = { padPassed: padPassed === true, faceMatchPassed: faceMatchPassed === true, injectionRiskDetected: injectionRiskDetected === true };
    let failureCode = null;
    if (trustedResult.injectionRiskDetected) failureCode = 'CAPTURE_INJECTION_RISK'; else if (!trustedResult.padPassed) failureCode = 'LIVENESS_FAILED'; else if (!trustedResult.faceMatchPassed) failureCode = 'FACE_MATCH_FAILED';
    if (failureCode) {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.faceVerificationSession.updateMany({ where: { id: sessionId, status: 'PROVIDER_PENDING' }, data: { status: 'FAILED', padPassed: trustedResult.padPassed, faceMatchPassed: trustedResult.faceMatchPassed, injectionRiskDetected: trustedResult.injectionRiskDetected, providerResultCode: clean(resultCode,80), providerPolicyProfileId: clean(policyProfileId,120) || snapshot.providerPolicyProfileId, providerEngineVersion: clean(engineVersion,120) || snapshot.providerEngineVersion, failedAt: now, failureCode } });
        if (claimed.count !== 1) throw http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed.');
        await audit.log({ actorUserId: snapshot.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: sessionId, metadata: { event: 'VERIFICATION_FAILED', failureCode, provider: snapshot.provider, resultCode: clean(resultCode,80) } }, tx);
      });
      return { session: safeSession(await prisma.faceVerificationSession.findUnique({ where: { id: sessionId } })), receipt: null };
    }
    const receipt = randomBytes(32).toString('base64url');
    const hash = receiptHash(receipt);
    try {
      return await prisma.$transaction(async (tx) => {
        const session = await tx.faceVerificationSession.findUnique({ where: { id: sessionId } });
        if (!session || session.status !== 'PROVIDER_PENDING' || session.expiresAt <= now) throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Face verification session changed before trusted result acceptance.');
        const user = await tx.user.findUnique({ where: { id: session.userId }, select: { id: true, employeeId: true, isActive: true, accountStatus: true, employee: { select: { id: true, isActive: true, deletedAt: true } } } });
        if (!user?.isActive || user.accountStatus !== 'ACTIVE' || user.employeeId !== session.employeeId || !user.employee?.isActive || user.employee.deletedAt) throw http(409, 'VERIFICATION_STALE', 'Employee authority changed during verification.');
        const binding = await exactActiveBinding(tx, session.employeeId);
        if (binding.device.id !== session.deviceEnrollmentId || binding.device.credentialFingerprint !== session.deviceCredentialFingerprint || binding.referencePhoto.id !== session.referencePhotoId || binding.referencePhoto.checksum !== session.referencePhotoChecksum) throw http(409, 'VERIFICATION_STALE', 'Device or Reference Photo authority changed during verification.');
        const receiptExpiresAt = new Date(Math.min(session.expiresAt.getTime(), now.getTime() + RECEIPT_TTL_MS));
        if (receiptExpiresAt <= now) throw http(410, 'VERIFICATION_EXPIRED', 'Face verification session expired.');
        const claimed = await tx.faceVerificationSession.updateMany({ where: { id: session.id, status: 'PROVIDER_PENDING', expiresAt: { gt: now } }, data: { status: 'VERIFIED', padPassed: true, faceMatchPassed: true, injectionRiskDetected: false, providerResultCode: clean(resultCode,80), providerPolicyProfileId: clean(policyProfileId,120) || session.providerPolicyProfileId, providerEngineVersion: clean(engineVersion,120) || session.providerEngineVersion, verifiedAt: now } });
        if (claimed.count !== 1) throw http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed.');
        await tx.faceVerificationReceipt.create({ data: { sessionId: session.id, employeeId: session.employeeId, userId: session.userId, deviceEnrollmentId: session.deviceEnrollmentId, deviceCredentialFingerprint: session.deviceCredentialFingerprint, referencePhotoId: session.referencePhotoId, referencePhotoChecksum: session.referencePhotoChecksum, purpose: session.purpose, verificationMode: session.verificationMode, receiptHash: hash, contextDigest: session.contextDigest, issuedAt: now, expiresAt: receiptExpiresAt } });
        await audit.log({ actorUserId: session.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: session.id, metadata: { event: 'VERIFICATION_VERIFIED', employeeId: session.employeeId, deviceEnrollmentId: session.deviceEnrollmentId, referencePhotoId: session.referencePhotoId, purpose: session.purpose, provider: session.provider, policyProfileId: clean(policyProfileId,120) || session.providerPolicyProfileId, engineVersion: clean(engineVersion,120) || session.providerEngineVersion } }, tx);
        return { session: safeSession(await tx.faceVerificationSession.findUnique({ where: { id: session.id } })), receipt, receiptExpiresAt };
      });
    } catch (error) { if (error?.details?.code === 'VERIFICATION_STALE') await failSession(sessionId, 'VERIFICATION_STALE').catch(() => {}); throw mapConflict(error); }
  }

  async function recordTrustedFaceMatchOnlyResult({ sessionId, providerSessionRef, activeChallengePassed, faceMatchPassed, resultCode = null, policyProfileId = null, engineVersion = null }) {
    const now = clock(); const providerRef = clean(providerSessionRef, 1000);
    if (!providerRef) throw http(400, 'VERIFICATION_PROVIDER_SESSION_INVALID', 'Provider session metadata is required.');
    const snapshot = await prisma.faceVerificationSession.findUnique({ where: { id: sessionId } });
    if (!snapshot) throw http(404, 'FACE_VERIFICATION_SESSION_NOT_FOUND', 'Face verification session not found.');
    if (snapshot.status !== 'PROVIDER_PENDING') throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Face verification session is not awaiting a trusted provider result.');
    if (snapshot.verificationMode !== 'FACE_MATCH_ONLY') throw http(409, 'FACE_VERIFICATION_MODE_MISMATCH', 'Face verification mode does not accept a face-match-only result.');
    if (snapshot.expiresAt <= now) { await expireSessionById(sessionId); throw http(410, 'VERIFICATION_EXPIRED', 'Face verification session expired.'); }
    if (!snapshot.providerSessionRefHash || snapshot.providerSessionRefHash !== providerRefHash(providerRef)) { await failSession(sessionId, 'VERIFICATION_PROVIDER_SESSION_MISMATCH'); throw http(409, 'VERIFICATION_PROVIDER_SESSION_MISMATCH', 'Trusted provider session does not match.'); }
    const activeChallenge = deriveActiveFaceChallenge(sessionId);
    const failureCode = activeChallengePassed === true ? (faceMatchPassed === true ? null : 'FACE_MATCH_FAILED') : 'ACTIVE_CHALLENGE_FAILED';
    if (failureCode) {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.faceVerificationSession.updateMany({ where: { id: sessionId, status: 'PROVIDER_PENDING', verificationMode: 'FACE_MATCH_ONLY' }, data: { status: 'FAILED', padPassed: null, faceMatchPassed: faceMatchPassed === true, injectionRiskDetected: null, providerResultCode: clean(resultCode,80), providerPolicyProfileId: clean(policyProfileId,120) || snapshot.providerPolicyProfileId, providerEngineVersion: clean(engineVersion,120) || snapshot.providerEngineVersion, failedAt: now, failureCode } });
        if (claimed.count !== 1) throw http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed.');
        await audit.log({ actorUserId: snapshot.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: sessionId, metadata: { event: 'VERIFICATION_FAILED', failureCode, provider: snapshot.provider, verificationMode: 'FACE_MATCH_ONLY', resultCode: clean(resultCode,80), activeChallengeVersion: activeChallenge.version, activeChallengeCode: activeChallenge.code, activeChallengePassed: activeChallengePassed === true } }, tx);
      });
      return { session: safeSession(await prisma.faceVerificationSession.findUnique({ where: { id: sessionId } })), receipt: null };
    }
    const receipt = randomBytes(32).toString('base64url');
    const hash = receiptHash(receipt);
    try {
      return await prisma.$transaction(async (tx) => {
        const session = await tx.faceVerificationSession.findUnique({ where: { id: sessionId } });
        if (!session || session.status !== 'PROVIDER_PENDING' || session.verificationMode !== 'FACE_MATCH_ONLY' || session.expiresAt <= now) throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Face verification session changed before trusted result acceptance.');
        const user = await tx.user.findUnique({ where: { id: session.userId }, select: { id: true, employeeId: true, isActive: true, accountStatus: true, employee: { select: { id: true, isActive: true, deletedAt: true } } } });
        if (!user?.isActive || user.accountStatus !== 'ACTIVE' || user.employeeId !== session.employeeId || !user.employee?.isActive || user.employee.deletedAt) throw http(409, 'VERIFICATION_STALE', 'Employee authority changed during verification.');
        const binding = await exactActiveBinding(tx, session.employeeId);
        if (binding.device.id !== session.deviceEnrollmentId || binding.device.credentialFingerprint !== session.deviceCredentialFingerprint || binding.referencePhoto.id !== session.referencePhotoId || binding.referencePhoto.checksum !== session.referencePhotoChecksum) throw http(409, 'VERIFICATION_STALE', 'Device or Reference Photo authority changed during verification.');
        const receiptExpiresAt = new Date(Math.min(session.expiresAt.getTime(), now.getTime() + RECEIPT_TTL_MS));
        if (receiptExpiresAt <= now) throw http(410, 'VERIFICATION_EXPIRED', 'Face verification session expired.');
        const claimed = await tx.faceVerificationSession.updateMany({ where: { id: session.id, status: 'PROVIDER_PENDING', verificationMode: 'FACE_MATCH_ONLY', expiresAt: { gt: now } }, data: { status: 'VERIFIED', padPassed: null, faceMatchPassed: true, injectionRiskDetected: null, providerResultCode: clean(resultCode,80), providerPolicyProfileId: clean(policyProfileId,120) || session.providerPolicyProfileId, providerEngineVersion: clean(engineVersion,120) || session.providerEngineVersion, verifiedAt: now } });
        if (claimed.count !== 1) throw http(409, 'FACE_VERIFICATION_STATE_CONFLICT', 'Face verification state changed.');
        await tx.faceVerificationReceipt.create({ data: { sessionId: session.id, employeeId: session.employeeId, userId: session.userId, deviceEnrollmentId: session.deviceEnrollmentId, deviceCredentialFingerprint: session.deviceCredentialFingerprint, referencePhotoId: session.referencePhotoId, referencePhotoChecksum: session.referencePhotoChecksum, purpose: session.purpose, verificationMode: 'FACE_MATCH_ONLY', receiptHash: hash, contextDigest: session.contextDigest, issuedAt: now, expiresAt: receiptExpiresAt } });
        await audit.log({ actorUserId: session.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: session.id, metadata: { event: 'VERIFICATION_VERIFIED', employeeId: session.employeeId, deviceEnrollmentId: session.deviceEnrollmentId, referencePhotoId: session.referencePhotoId, purpose: session.purpose, provider: session.provider, verificationMode: 'FACE_MATCH_ONLY', policyProfileId: clean(policyProfileId,120) || session.providerPolicyProfileId, engineVersion: clean(engineVersion,120) || session.providerEngineVersion, activeChallengeVersion: activeChallenge.version, activeChallengeCode: activeChallenge.code, activeChallengePassed: true } }, tx);
        return { session: safeSession(await tx.faceVerificationSession.findUnique({ where: { id: session.id } })), receipt, receiptExpiresAt };
      });
    } catch (error) { if (error?.details?.code === 'VERIFICATION_STALE') await failSession(sessionId, 'VERIFICATION_STALE').catch(() => {}); throw mapConflict(error); }
  }

  async function consumeReceiptWithClient(client, { receipt, expected, now = clock() }) {
    const secret = String(receipt || '');
    if (secret.length < 32 || secret.length > 512) throw http(400, 'VERIFICATION_RECEIPT_INVALID', 'Verification receipt is invalid.');
    const e = expected || {};
    const purpose = String(e.purpose || '');
    if (!PURPOSES.has(purpose)) throw http(400, 'FACE_VERIFICATION_PURPOSE_INVALID', 'Unsupported face verification purpose.');
    const context = digest64(e.contextDigest);
    const hashedReceipt = receiptHash(secret);
    const row = await client.faceVerificationReceipt.findUnique({ where: { receiptHash: hashedReceipt }, include: { session: true } });
    if (!row) throw http(404, 'VERIFICATION_RECEIPT_INVALID', 'Verification receipt is invalid.');
    if (row.consumedAt) throw http(409, 'VERIFICATION_REPLAYED', 'Verification receipt was already consumed.');
    if (row.expiresAt <= now || row.session.expiresAt <= now) throw http(410, 'VERIFICATION_EXPIRED', 'Verification receipt expired.');
    if (row.session.status !== 'VERIFIED') throw http(409, 'VERIFICATION_RECEIPT_INVALID', 'Verification receipt is not actionable.');
    const bindingMatch = row.employeeId === e.employeeId
      && row.verificationMode === row.session.verificationMode
      && row.userId === e.userId
      && row.deviceEnrollmentId === e.deviceEnrollmentId
      && row.referencePhotoId === e.referencePhotoId
      && row.purpose === purpose
      && row.contextDigest === context;
    if (!bindingMatch) throw http(409, 'VERIFICATION_CONTEXT_MISMATCH', 'Verification receipt does not match the Attendance context.');
    const user = await client.user.findUnique({ where: { id: row.userId }, select: { id: true, employeeId: true, isActive: true, accountStatus: true, employee: { select: { id: true, isActive: true, deletedAt: true } } } });
    if (!user?.isActive || user.accountStatus !== 'ACTIVE' || user.employeeId !== row.employeeId || !user.employee?.isActive || user.employee.deletedAt) throw http(409, 'VERIFICATION_STALE', 'Employee authority changed before Attendance acceptance.');
    const binding = await exactActiveBinding(client, row.employeeId);
    if (binding.device.id !== row.deviceEnrollmentId || binding.device.credentialFingerprint !== row.deviceCredentialFingerprint || binding.referencePhoto.id !== row.referencePhotoId || binding.referencePhoto.checksum !== row.referencePhotoChecksum) throw http(409, 'VERIFICATION_STALE', 'Device or Reference Photo authority changed before Attendance acceptance.');
    const claimed = await client.faceVerificationReceipt.updateMany({ where: { id: row.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (claimed.count !== 1) throw http(409, 'VERIFICATION_REPLAYED', 'Verification receipt was already consumed.');
    const sessionClaimed = await client.faceVerificationSession.updateMany({ where: { id: row.sessionId, status: 'VERIFIED' }, data: { status: 'CONSUMED' } });
    if (sessionClaimed.count !== 1) throw http(409, 'VERIFICATION_REPLAYED', 'Verification session was already consumed.');
    await audit.log({ actorUserId: row.userId, action: 'UPDATE', entityType: 'FaceVerificationSession', entityId: row.sessionId, metadata: { event: 'VERIFICATION_RECEIPT_CONSUMED', employeeId: row.employeeId, deviceEnrollmentId: row.deviceEnrollmentId, referencePhotoId: row.referencePhotoId, purpose: row.purpose, contextDigest: row.contextDigest } }, client);
    return { sessionId: row.sessionId, employeeId: row.employeeId, userId: row.userId, deviceEnrollmentId: row.deviceEnrollmentId, referencePhotoId: row.referencePhotoId, purpose: row.purpose, contextDigest: row.contextDigest, verifiedAt: row.session.verifiedAt, consumedAt: now, provider: row.session.provider, verificationMode: row.verificationMode, policyProfileId: row.session.providerPolicyProfileId, engineVersion: row.session.providerEngineVersion };
  }

  async function consumeReceiptInTransaction({ tx, receipt, expected }) {
    if (!tx) throw http(500, 'VERIFICATION_TRANSACTION_REQUIRED', 'Verification receipt consumption requires an existing transaction.');
    return consumeReceiptWithClient(tx, { receipt, expected, now: clock() });
  }

  async function consumeReceipt({ receipt, expected }) {
    const hashedReceipt = receiptHash(String(receipt || ''));
    const receiptSnapshot = await prisma.faceVerificationReceipt.findUnique({ where: { receiptHash: hashedReceipt }, select: { sessionId: true } }).catch(() => null);
    try {
      return await prisma.$transaction(async (tx) => consumeReceiptWithClient(tx, { receipt, expected, now: clock() }));
    } catch (error) {
      if (error?.details?.code === 'VERIFICATION_STALE' && receiptSnapshot?.sessionId) await failSession(receiptSnapshot.sessionId, 'VERIFICATION_STALE').catch(() => {});
      throw mapConflict(error);
    }
  }

  return { createSession, verifyDeviceProof, bindProviderSession, recordTrustedProviderResult, recordTrustedFaceMatchOnlyResult, consumeReceipt, consumeReceiptInTransaction, failSession };
}

module.exports = { PURPOSES, ACTIVE_SESSION_STATUSES, SESSION_TTL_MS, RECEIPT_TTL_MS, challengeHash, receiptHash, providerRefHash, createFaceVerificationSessionService };
