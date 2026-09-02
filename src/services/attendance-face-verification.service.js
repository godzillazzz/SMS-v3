'use strict';

const { ATTACHMENT_PROFILES } = require('./attachment-optimizer.service');
const { createFaceVerificationSessionService } = require('./face-verification-session.service');
const { createSelfHostedFaceVerificationService } = require('./face-verification-self-hosted.service');
const { createInProcessFaceVerificationService } = require('./face-verification-in-process.service');

const MAX_ATTENDANCE_LIVE_PHOTO_SIZE = ATTACHMENT_PROFILES.ATTENDANCE_FACE.imageHardLimitBytes;
const MAX_ATTENDANCE_FACE_UPLOAD_PART_SIZE = ATTACHMENT_PROFILES.ATTENDANCE_FACE.imageHardLimitBytes;

function safeDeviceProof(result, sessionId) {
  return {
    verificationReady: true,
    sessionId,
    status: result?.status || 'DEVICE_PROOF_VERIFIED'
  };
}

function safeFaceVerification(result) {
  const accepted = result?.verificationAccepted === true && typeof result?.receipt === 'string' && result.receipt.length > 0;
  return {
    verificationAccepted: accepted,
    receipt: accepted ? result.receipt : null,
    receiptExpiresAt: accepted ? (result.receiptExpiresAt || null) : null,
    evidence: {
      storageStatus: result?.evidence?.storageStatus || 'NOT_STORED',
      stored: result?.evidence?.stored === true
    }
  };
}

function createAttendanceFaceVerificationService({
  environment = process.env,
  sessionService = null,
  faceVerificationService = null
} = {}) {
  const sessions = sessionService || createFaceVerificationSessionService();
  const verifier = faceVerificationService
    || (environment.FACE_VERIFICATION_IN_PROCESS_ENABLED === 'true'
      ? createInProcessFaceVerificationService({ sessionService: sessions, environment })
      : createSelfHostedFaceVerificationService({ sessionService: sessions, environment }));

  async function verifyDeviceProof({ actor, sessionId, challengeId, challenge, signatureBase64 } = {}) {
    const result = await sessions.verifyDeviceProof({ actor, sessionId, challengeId, challenge, signatureBase64 });
    return safeDeviceProof(result, sessionId);
  }

  async function verifyLiveFace({ actor, sessionId, livePhotoFile, challengeFrameFiles } = {}) {
    const result = await verifier.verifyFaceMatch({ actor, sessionId, livePhotoFile, challengeFrameFiles });
    const safe = safeFaceVerification(result);
    return { ...safe, domainCode: safe.verificationAccepted ? null : (result?.session?.failureCode || 'FACE_MATCH_FAILED') };
  }

  return {
    verifyDeviceProof,
    verifyLiveFace
  };
}

module.exports = {
  MAX_ATTENDANCE_LIVE_PHOTO_SIZE,
  MAX_ATTENDANCE_FACE_UPLOAD_PART_SIZE,
  safeDeviceProof,
  safeFaceVerification,
  createAttendanceFaceVerificationService
};
