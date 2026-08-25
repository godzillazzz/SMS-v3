'use strict';

const crypto = require('node:crypto');

const ACTIVE_FACE_CHALLENGE_VERSION = 'ACTIVE_FACE_CHALLENGE_V1';
const ACTIVE_FACE_CHALLENGE_FRAME_COUNT = 4;
const ACTIVE_FACE_CHALLENGE_CODES = Object.freeze([
  'TURN_LEFT',
  'TURN_RIGHT',
  'LOOK_UP',
  'LOOK_DOWN'
]);

function deriveActiveFaceChallenge(sessionId) {
  const value = String(sessionId || '').trim();
  if (!value) throw new TypeError('Face verification session ID is required.');
  const digest = crypto.createHash('sha256').update(value, 'utf8').digest();
  const code = ACTIVE_FACE_CHALLENGE_CODES[digest[0] % ACTIVE_FACE_CHALLENGE_CODES.length];
  return Object.freeze({
    version: ACTIVE_FACE_CHALLENGE_VERSION,
    code,
    frameCount: ACTIVE_FACE_CHALLENGE_FRAME_COUNT
  });
}

module.exports = {
  ACTIVE_FACE_CHALLENGE_VERSION,
  ACTIVE_FACE_CHALLENGE_FRAME_COUNT,
  ACTIVE_FACE_CHALLENGE_CODES,
  deriveActiveFaceChallenge
};
