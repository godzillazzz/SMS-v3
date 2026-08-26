'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const {
  ACTIVE_FACE_CHALLENGE_VERSION,
  ACTIVE_FACE_CHALLENGE_FRAME_COUNT
} = require('./active-face-challenge.service');
const { createInProcessFaceMatchProvider } = require('./in-process-face-match.provider');

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function createAttendanceFaceEngineUatService({
  environment = process.env,
  provider = createInProcessFaceMatchProvider({ environment }),
  randomUUID = crypto.randomUUID,
  nowNs = () => process.hrtime.bigint()
} = {}) {
  async function probe({ photoFile } = {}) {
    if (!photoFile || !Buffer.isBuffer(photoFile.buffer)) {
      throw http(400, 'FACE_ENGINE_UAT_IMAGE_REQUIRED', 'UAT face-engine image is required.');
    }

    const bytes = photoFile.buffer;
    const started = nowNs();
    try {
      const result = await provider.evaluate({
        providerSessionRef: `uat-${randomUUID()}`,
        activeChallenge: {
          version: ACTIVE_FACE_CHALLENGE_VERSION,
          code: 'TURN_LEFT',
          frameCount: ACTIVE_FACE_CHALLENGE_FRAME_COUNT
        },
        challengeFrameBytes: Array.from({ length: ACTIVE_FACE_CHALLENGE_FRAME_COUNT }, () => bytes),
        livePhotoBytes: bytes,
        referencePhotoBytes: bytes
      });
      const elapsedMs = Number(nowNs() - started) / 1e6;
      return Object.freeze({
        uatOnly: true,
        engineReady: true,
        inferenceCompleted: true,
        staticChallengeRejected: result.activeChallengePassed === false,
        resultCode: result.resultCode,
        elapsedMs: Math.round(elapsedMs)
      });
    } finally {
      bytes.fill(0);
    }
  }

  return Object.freeze({ probe });
}

module.exports = { createAttendanceFaceEngineUatService };
