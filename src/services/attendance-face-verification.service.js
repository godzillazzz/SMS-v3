'use strict';

const { createFaceVerificationSessionService } = require('./face-verification-session.service');
const { createSelfHostedFaceVerificationService } = require('./face-verification-self-hosted.service');

const MAX_ATTENDANCE_LIVE_PHOTO_SIZE = 2 * 1024 * 1024;

function safeDeviceProof(result, sessionId) {
  return {
    verificationReady: true,
    sessionId,
    status: result?.status || 'DEVICE_PROOF_VERIFIED'
  };
}

function safeFaceVerification(result) {
  const accepted = result?.faceMatchPassed === true && typeof result?.receipt === 'string' && result.receipt.length > 0;
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
  sessionService = null,
  faceVerificationService = null
} = {}) {
  const sessions = sessionService || createFaceVerificationSessionService();
  const verifier = faceVerificationService || createSelfHostedFaceVerificationService({ sessionService: sessions });

  async function verifyDeviceProof({ actor, sessionId, challengeId, challenge, signatureBase64 } = {}) {
    const result = await sessions.verifyDeviceProof({ actor, sessionId, challengeId, challenge, signatureBase64 });
    return safeDeviceProof(result, sessionId);
  }

  async function verifyLiveFace({ actor, sessionId, livePhotoFile } = {}) {
    const result = await verifier.verifyFaceMatch({ actor, sessionId, livePhotoFile });
    return safeFaceVerification(result);
  }

  return {
    verifyDeviceProof,
    verifyLiveFace
  };
}

module.exports = {
  MAX_ATTENDANCE_LIVE_PHOTO_SIZE,
  safeDeviceProof,
  safeFaceVerification,
  createAttendanceFaceVerificationService
};
