'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const {
  ACTIVE_FACE_CHALLENGE_FRAME_COUNT,
  deriveActiveFaceChallenge
} = require('./active-face-challenge.service');
const { MAX_ATTENDANCE_FACE_UPLOAD_PART_SIZE } = require('./attendance-face-verification.service');

const MIN_UAT_IMAGE_BYTES = 64;
const ALLOWED_UAT_MIME_TYPES = new Set(['image/jpeg']);

function validateFile(file, label) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new HttpError(400, `${label} is required.`, { code: 'FACE_CHALLENGE_UAT_CAPTURE_INVALID' });
  }
  if (!ALLOWED_UAT_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
    throw new HttpError(400, `${label} must be JPEG.`, { code: 'FACE_CHALLENGE_UAT_CAPTURE_INVALID' });
  }
  if (file.buffer.length < MIN_UAT_IMAGE_BYTES || file.buffer.length > MAX_ATTENDANCE_FACE_UPLOAD_PART_SIZE) {
    throw new HttpError(400, `${label} size is invalid.`, { code: 'FACE_CHALLENGE_UAT_CAPTURE_INVALID' });
  }
}

function wipeFile(file) {
  if (Buffer.isBuffer(file?.buffer)) file.buffer.fill(0);
}

function createAttendanceFaceChallengeUatService() {
  return {
    start() {
      const attemptId = crypto.randomUUID();
      return {
        ok: true,
        uatOnly: true,
        attemptId,
        activeChallenge: deriveActiveFaceChallenge(attemptId),
        verifierCalled: false,
        verificationAccepted: false,
        attendanceAccepted: false,
        retained: false
      };
    },

    acceptCapture({ attemptId, livePhotoFile, challengeFrameFiles }) {
      const frames = Array.isArray(challengeFrameFiles) ? challengeFrameFiles : [];
      const filesToWipe = [livePhotoFile, ...frames].filter(Boolean);
      try {
        if (typeof attemptId !== 'string' || !attemptId) {
          throw new HttpError(400, 'UAT attempt is invalid.', { code: 'FACE_CHALLENGE_UAT_CAPTURE_INVALID' });
        }
        if (frames.length !== ACTIVE_FACE_CHALLENGE_FRAME_COUNT) {
          throw new HttpError(400, 'Active Challenge frame count is invalid.', { code: 'FACE_CHALLENGE_UAT_CAPTURE_INVALID' });
        }
        validateFile(livePhotoFile, 'Live photo');
        frames.forEach((file, index) => validateFile(file, `Challenge frame ${index + 1}`));

        return {
          ok: true,
          uatOnly: true,
          captureReceived: true,
          activeChallenge: deriveActiveFaceChallenge(attemptId),
          verifierCalled: false,
          verificationAccepted: false,
          attendanceAccepted: false,
          receipt: null,
          retained: false
        };
      } finally {
        filesToWipe.forEach(wipeFile);
      }
    }
  };
}

module.exports = {
  createAttendanceFaceChallengeUatService,
  MIN_UAT_IMAGE_BYTES
};
