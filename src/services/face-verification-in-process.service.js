'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { logger } = require('../utils/logger');
const { createFaceVerificationSessionService } = require('./face-verification-session.service');
const { createSupabaseEmployeeReferencePhotoStorage, detectedType } = require('./employee-reference-photo-storage.service');
const { deriveActiveFaceChallenge, ACTIVE_FACE_CHALLENGE_FRAME_COUNT } = require('./active-face-challenge.service');
const {
  PROVIDER_NAME,
  VERIFICATION_MODE,
  POLICY_PROFILE_ID,
  MAX_LIVE_PHOTO_SIZE,
  MAX_CHALLENGE_FRAME_SIZE,
  createInProcessFaceMatchProvider
} = require('./in-process-face-match.provider');

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function validateImageFile(file, { requiredCode, invalidCode, maxBytes }) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw http(400, requiredCode, 'Face verification image is required.');
  if (file.buffer.length < 64 || file.buffer.length > maxBytes) throw http(400, invalidCode, 'Face verification image is invalid.');
  const type = detectedType(file.buffer);
  const expectedMime = type === 'png' ? 'image/png' : type === 'jpeg' ? 'image/jpeg' : null;
  if (!expectedMime || file.mimetype !== expectedMime) throw http(415, invalidCode, 'Face verification image must be a valid JPEG or PNG image.');
  return { mimeType: expectedMime, sizeBytes: file.buffer.length, checksum: sha256(file.buffer) };
}

function validateLivePhoto(file) {
  return validateImageFile(file, {
    requiredCode: 'LIVE_FACE_PHOTO_REQUIRED',
    invalidCode: 'LIVE_FACE_PHOTO_INVALID',
    maxBytes: MAX_LIVE_PHOTO_SIZE
  });
}

function validateChallengeFrames(files) {
  if (!Array.isArray(files) || files.length !== ACTIVE_FACE_CHALLENGE_FRAME_COUNT) {
    throw http(400, 'ACTIVE_CHALLENGE_FRAMES_INVALID', `Exactly ${ACTIVE_FACE_CHALLENGE_FRAME_COUNT} active challenge frames are required.`);
  }
  return files.map((file) => validateImageFile(file, {
    requiredCode: 'ACTIVE_CHALLENGE_FRAME_REQUIRED',
    invalidCode: 'ACTIVE_CHALLENGE_FRAME_INVALID',
    maxBytes: MAX_CHALLENGE_FRAME_SIZE
  }));
}

function safeEvidenceResult(result) {
  return Object.freeze({
    storageStatus: result?.storageStatus || 'NOT_STORED',
    stored: result?.storageStatus === 'STORED'
  });
}

const SAFE_MATCH_DIAGNOSTIC_BANDS = new Set(['NEAR_THRESHOLD', 'BELOW_THRESHOLD', 'FAR_BELOW_THRESHOLD']);

function safeMatchDiagnosticBand(evaluation) {
  if (evaluation?.resultCode !== 'FACE_MATCH_FAILED') return 'NOT_EVALUATED';
  const band = String(evaluation?.diagnosticMatchBand || '');
  return SAFE_MATCH_DIAGNOSTIC_BANDS.has(band) ? band : 'NOT_AVAILABLE';
}

function createInProcessFaceVerificationService({
  environment = process.env,
  prisma = prismaDefault,
  sessionService = createFaceVerificationSessionService({ prisma }),
  provider = createInProcessFaceMatchProvider({ environment }),
  referenceStorage = createSupabaseEmployeeReferencePhotoStorage(),
  randomUUID = crypto.randomUUID
} = {}) {
  async function ownedSession(actor, sessionId) {
    const row = await prisma.faceVerificationSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        employeeId: true,
        referencePhotoId: true,
        referencePhotoChecksum: true,
        status: true,
        expiresAt: true
      }
    });
    if (!row || row.userId !== actor?.sub) throw http(404, 'FACE_VERIFICATION_SESSION_NOT_FOUND', 'Face verification session not found.');
    if (row.status !== 'DEVICE_PROOF_VERIFIED') throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Device proof is required before face matching.');
    if (row.expiresAt && row.expiresAt <= new Date()) throw http(410, 'VERIFICATION_EXPIRED', 'Face verification session expired.');
    return row;
  }

  async function verifyFaceMatch({ actor, sessionId, livePhotoFile, challengeFrameFiles }) {
    validateLivePhoto(livePhotoFile);
    validateChallengeFrames(challengeFrameFiles);
    const snapshot = await ownedSession(actor, sessionId);
    const activeChallenge = deriveActiveFaceChallenge(snapshot.id);
    const reference = await prisma.employeeReferencePhoto.findUnique({
      where: { id: snapshot.referencePhotoId },
      select: {
        id: true,
        status: true,
        checksum: true,
        mimeType: true,
        storageObjectKey: true,
        storageDeletedAt: true,
        storageDeletionRequestedAt: true
      }
    });
    if (!reference || reference.status !== 'ACTIVE' || reference.storageDeletedAt || reference.storageDeletionRequestedAt || reference.checksum !== snapshot.referencePhotoChecksum) {
      await sessionService.failSession(sessionId, 'VERIFICATION_STALE').catch(() => {});
      throw http(409, 'VERIFICATION_STALE', 'Reference Photo authority changed during verification.');
    }

    let referenceBytes;
    const providerSessionRef = randomUUID();
    const challengeFrameBytes = challengeFrameFiles.map((file) => file.buffer);
    try {
      referenceBytes = await referenceStorage.getBytes(reference.storageObjectKey);
      if (!Buffer.isBuffer(referenceBytes) || sha256(referenceBytes) !== snapshot.referencePhotoChecksum) {
        await sessionService.failSession(sessionId, 'VERIFICATION_STALE').catch(() => {});
        throw http(409, 'VERIFICATION_STALE', 'Reference Photo authority changed during verification.');
      }

      await sessionService.bindProviderSession({
        sessionId,
        provider: PROVIDER_NAME,
        providerSessionRef,
        verificationMode: VERIFICATION_MODE,
        policyProfileId: POLICY_PROFILE_ID,
        engineVersion: null
      });

      let evaluation;
      try {
        evaluation = await provider.evaluate({
          providerSessionRef,
          activeChallenge,
          challengeFrameBytes,
          livePhotoBytes: livePhotoFile.buffer,
          referencePhotoBytes: referenceBytes
        });
      } catch (error) {
        await sessionService.failSession(sessionId, error?.details?.code || 'VERIFICATION_PROVIDER_UNAVAILABLE').catch(() => {});
        throw error;
      }

      if (evaluation.activeChallengePassed !== true || evaluation.faceMatchPassed !== true) {
        logger.warn('attendance_face_verification_retry', {
          sessionId,
          challengeCode: activeChallenge.code,
          resultCode: evaluation.resultCode || 'UNKNOWN',
          matchBand: safeMatchDiagnosticBand(evaluation)
        });
      }

      const accepted = await sessionService.recordTrustedFaceMatchOnlyResult({
        sessionId,
        providerSessionRef,
        activeChallengePassed: evaluation.activeChallengePassed,
        faceMatchPassed: evaluation.faceMatchPassed,
        resultCode: evaluation.resultCode,
        policyProfileId: evaluation.policyProfileId || POLICY_PROFILE_ID,
        engineVersion: evaluation.engineVersion
      });
      if (evaluation.activeChallengePassed === true && evaluation.faceMatchPassed === true && !accepted.receipt) {
        await sessionService.failSession(sessionId, 'VERIFICATION_RECEIPT_NOT_ISSUED').catch(() => {});
        throw http(409, 'VERIFICATION_RECEIPT_NOT_ISSUED', 'Face verification did not produce an actionable Attendance receipt.');
      }
      return {
        verificationAccepted: evaluation.activeChallengePassed === true && evaluation.faceMatchPassed === true && Boolean(accepted.receipt),
        verificationMode: VERIFICATION_MODE,
        evidence: safeEvidenceResult(null),
        session: accepted.session,
        receipt: accepted.receipt || null,
        receiptExpiresAt: accepted.receiptExpiresAt || null
      };
    } finally {
      if (Buffer.isBuffer(referenceBytes)) referenceBytes.fill(0);
      if (Buffer.isBuffer(livePhotoFile?.buffer)) livePhotoFile.buffer.fill(0);
      for (const frame of challengeFrameBytes) if (Buffer.isBuffer(frame)) frame.fill(0);
    }
  }

  return { verifyFaceMatch };
}

module.exports = {
  validateLivePhoto,
  validateChallengeFrames,
  safeMatchDiagnosticBand,
  createInProcessFaceVerificationService
};
