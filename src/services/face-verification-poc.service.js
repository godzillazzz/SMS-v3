'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createFaceVerificationSessionService } = require('./face-verification-session.service');
const { createSupabaseEmployeeReferencePhotoStorage } = require('./employee-reference-photo-storage.service');
const { PROVIDER_NAME, createAwsRekognitionFaceVerificationProvider } = require('./aws-rekognition-face-verification.provider');

function http(statusCode, code, message) { return new HttpError(statusCode, message, { code }); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function createFaceVerificationPocService({
  prisma = prismaDefault,
  sessionService = createFaceVerificationSessionService({ prisma }),
  provider = createAwsRekognitionFaceVerificationProvider(),
  storage = createSupabaseEmployeeReferencePhotoStorage()
} = {}) {
  async function ownedSession(actor, sessionId, allowedStatuses) {
    const row = await prisma.faceVerificationSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        employeeId: true,
        referencePhotoId: true,
        referencePhotoChecksum: true,
        status: true,
        provider: true
      }
    });
    if (!row || row.userId !== actor?.sub) throw http(404, 'FACE_VERIFICATION_SESSION_NOT_FOUND', 'Face verification session not found.');
    if (allowedStatuses && !allowedStatuses.includes(row.status)) throw http(409, 'FACE_VERIFICATION_SESSION_NOT_ACTIONABLE', 'Face verification session is not actionable.');
    return row;
  }

  function getPocConfig() { return provider.publicConfig(); }

  async function createProviderSession({ actor, sessionId }) {
    await ownedSession(actor, sessionId, ['DEVICE_PROOF_VERIFIED']);
    const created = await provider.createLivenessSession({ clientRequestToken: sessionId });
    const session = await sessionService.bindProviderSession({
      sessionId,
      provider: PROVIDER_NAME,
      providerSessionRef: created.providerSessionRef,
      policyProfileId: created.policyProfileId,
      engineVersion: created.engineVersion
    });
    return {
      session,
      providerSessionId: created.providerSessionRef,
      region: created.region,
      challengeType: created.challengeType
    };
  }

  async function completeProviderSession({ actor, sessionId, providerSessionId }) {
    const session = await ownedSession(actor, sessionId, ['PROVIDER_PENDING']);
    if (session.provider !== PROVIDER_NAME) throw http(409, 'VERIFICATION_PROVIDER_SESSION_MISMATCH', 'Trusted provider session does not match.');
    const reference = await prisma.employeeReferencePhoto.findUnique({
      where: { id: session.referencePhotoId },
      select: { id: true, status: true, checksum: true, storageObjectKey: true, storageDeletedAt: true, storageDeletionRequestedAt: true }
    });
    if (!reference || reference.status !== 'ACTIVE' || reference.storageDeletedAt || reference.storageDeletionRequestedAt || reference.checksum !== session.referencePhotoChecksum) {
      await sessionService.failSession(sessionId, 'VERIFICATION_STALE').catch(() => {});
      throw http(409, 'VERIFICATION_STALE', 'Reference Photo authority changed during verification.');
    }

    let referenceBytes;
    try {
      referenceBytes = await storage.getBytes(reference.storageObjectKey);
      if (sha256(referenceBytes) !== session.referencePhotoChecksum) {
        await sessionService.failSession(sessionId, 'VERIFICATION_STALE').catch(() => {});
        throw http(409, 'VERIFICATION_STALE', 'Reference Photo authority changed during verification.');
      }
      const evaluation = await provider.evaluate({ providerSessionRef: providerSessionId, referencePhotoBytes: referenceBytes });
      if (!evaluation.complete) return { pending: true, providerStatus: evaluation.providerStatus };
      const accepted = await sessionService.recordTrustedProviderResult({
        sessionId,
        providerSessionRef: providerSessionId,
        padPassed: evaluation.padPassed,
        faceMatchPassed: evaluation.faceMatchPassed,
        injectionRiskDetected: evaluation.injectionRiskDetected,
        resultCode: evaluation.resultCode,
        policyProfileId: evaluation.policyProfileId,
        engineVersion: evaluation.engineVersion
      });
      return { pending: false, ...accepted };
    } finally {
      if (Buffer.isBuffer(referenceBytes)) referenceBytes.fill(0);
    }
  }

  return { getPocConfig, createProviderSession, completeProviderSession };
}

module.exports = { createFaceVerificationPocService };
