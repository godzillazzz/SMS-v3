'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIVE_FACE_CHALLENGE_VERSION,
  ACTIVE_FACE_CHALLENGE_FRAME_COUNT,
  ACTIVE_FACE_CHALLENGE_CODES,
  deriveActiveFaceChallenge
} = require('../src/services/active-face-challenge.service');

test('active face challenge is server-derived, stable per random session id, and bounded to the approved V1 set', () => {
  const a = deriveActiveFaceChallenge('11111111-1111-4111-8111-111111111111');
  const again = deriveActiveFaceChallenge('11111111-1111-4111-8111-111111111111');
  const b = deriveActiveFaceChallenge('22222222-2222-4222-8222-222222222222');
  assert.deepEqual(a, again);
  assert.equal(a.version, ACTIVE_FACE_CHALLENGE_VERSION);
  assert.equal(a.frameCount, ACTIVE_FACE_CHALLENGE_FRAME_COUNT);
  assert.ok(ACTIVE_FACE_CHALLENGE_CODES.includes(a.code));
  assert.ok(ACTIVE_FACE_CHALLENGE_CODES.includes(b.code));
  assert.equal(Object.isFrozen(a), true);
});

test('active challenge derivation requires the server-created session identity and stores no image or pass result', () => {
  assert.throws(() => deriveActiveFaceChallenge(''), /session ID/i);
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/services/active-face-challenge.service.js'), 'utf8');
  assert.doesNotMatch(source, /prisma|localStorage|sessionStorage|image|photo|frameBytes|passed\s*=/i);
});
