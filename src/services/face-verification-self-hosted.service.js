'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createFaceVerificationSessionService } = require('./face-verification-session.service');
const { createSupabaseEmployeeReferencePhotoStorage, detectedType } = require('./employee-reference-photo-storage.service');
const {
  PROVIDER_NAME,
  VERIFICATION_MODE,
  POLICY_PROFILE_ID,
  MAX_LIVE_PHOTO_SIZE,
  createSelfHostedFaceMatchProvider
} = require('./self-hosted-face-match.provider');
const {
  createNoopAttendanceFaceEvidenceStorage,
  assertAttendanceFaceEvidenceStorage
} = require('./attendance-face-evidence-storage.service');

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function validateLivePhoto(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw http(400, 'LIVE_FACE_PHOTO_REQUIRED', 'Live face photo is required.');
  if (file.buffer.length < 64 || file.buffer.length > MAX_LIVE_PHOTO_SIZE) throw http(400, 'LIVE_FACE_PHOTO_INVALID', 'Live face photo is invalid.');
  const type = detectedType(file.buffer);
  const expectedMime = type === 'png' ? 'image/png' : type === 'jpeg' ? 'image/jpeg' : null;
  if (!expectedMime || file.mimetype !== expectedMime) throw http(415, 'LIVE_FACE_PHOTO_INVALID', 'Live face photo must be a valid JPEG or PNG image.');
  return { mimeType: expectedMime, sizeBytes: file.buffer.length, checksum: sha256(file.buffer) };
}

function safeEvidenceResult(result) {
  return Object.freeze({
    storageStatus: result?.storageStatus || 'NOT_STORED',
    stored: result?.storageStatus === 'STORED'
  });
}

function createSelfHostedFaceVerificationService({
  prisma = prismaDefault,
  sessionService = createFaceVerificationSessionService({ prisma }),
  provider = createSelfHostedFaceMatchProvider(),
  referenceStorage = createSupabaseEmployeeReferencePhotoStorage(),
  evidenceStorage = createNoopAttendanceFaceEvidenceStorage(),
  randomUUID = crypto.randomUUID
} = {}) {
  const attendanceEvidenceStorage = assertAttendanceFaceEvidenceStorage(evidenceStorage);

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

  async function verifyFaceMatch({ actor, sessionId, livePhotoFile }) {
    const liveInfo = validateLivePhoto(livePhotoFile);
    const snapshot = await ownedSession(actor, sessionId);
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
          livePhotoBytes: livePhotoFile.buffer,
          referencePhotoBytes: referenceBytes
        });
      } catch (error) {
        await sessionService.failSession(sessionId, error?.details?.code || 'VERIFICATION_PROVIDER_UNAVAILABLE').catch(() => {});
        throw error;
      }

      const accepted = await sessionService.recordTrustedFaceMatchOnlyResult({
        sessionId,
        providerSessionRef,
        faceMatchPassed: evaluation.faceMatchPassed,
        resultCode: evaluation.resultCode,
        policyProfileId: evaluation.policyProfileId || POLICY_PROFILE_ID,
        engineVersion: evaluation.engineVersion
      });

      let evidenceResult = { storageStatus: 'NOT_STORED' };
      if (evaluation.faceMatchPassed === true && accepted.receipt) {
        try {
          evidenceResult = await attendanceEvidenceStorage.store({
            sessionId,
            employeeId: snapshot.employeeId,
            referencePhotoId: snapshot.referencePhotoId,
            livePhotoBytes: livePhotoFile.buffer,
            mimeType: liveInfo.mimeType,
            capturedAt: new Date(),
            verificationPassed: true
          });
        } catch {
          evidenceResult = { storageStatus: 'NOT_STORED' };
        }
      }

      return {
        verificationMode: VERIFICATION_MODE,
        faceMatchPassed: evaluation.faceMatchPassed === true,
        evidence: safeEvidenceResult(evidenceResult),
        session: accepted.session,
        receipt: accepted.receipt || null,
        receiptExpiresAt: accepted.receiptExpiresAt || null
      };
    } finally {
      if (Buffer.isBuffer(referenceBytes)) referenceBytes.fill(0);
      if (Buffer.isBuffer(livePhotoFile?.buffer)) livePhotoFile.buffer.fill(0);
    }
  }

  return { verifyFaceMatch };
}

module.exports = {
  validateLivePhoto,
  createSelfHostedFaceVerificationService
};
