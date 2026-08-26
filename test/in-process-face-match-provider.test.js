'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PROVIDER_NAME,
  VERIFICATION_MODE,
  DEFAULT_SIMILARITY_THRESHOLD,
  inProcessFaceConfig,
  evaluateActiveChallenge,
  createInProcessFaceMatchProvider
} = require('../src/services/in-process-face-match.provider');

function imageBytes(fill = 0x11) {
  const buffer = Buffer.alloc(256, fill);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  return buffer;
}

function pose({ yaw = 0, pitch = 0, roll = 0 } = {}) {
  return Object.freeze({ yaw, pitch, roll });
}

function activeChallenge(code) {
  return { version: 'ACTIVE_FACE_CHALLENGE_V1', code, frameCount: 4 };
}

function engineWith({ poses, similarity = 0.9, liveEmbedding = [1, 0], referenceEmbedding = [1, 0] }) {
  let index = 0;
  return {
    async observe() {
      const current = poses[index] || pose();
      const embedding = index === 5 ? referenceEmbedding : liveEmbedding;
      index += 1;
      return { pose: current, embedding };
    },
    similarity() { return similarity; },
    calls() { return index; }
  };
}

const enabled = { FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' };

test('in-process face config is explicit, bounded, and defaults conservatively', () => {
  assert.equal(inProcessFaceConfig({}).enabled, false);
  const config = inProcessFaceConfig(enabled);
  assert.equal(config.enabled, true);
  assert.equal(config.similarityThreshold, DEFAULT_SIMILARITY_THRESHOLD);
  assert.throws(() => inProcessFaceConfig({ ...enabled, FACE_MATCH_SIMILARITY_THRESHOLD: '0.2' }), /configuration is invalid/i);
  assert.throws(() => inProcessFaceConfig({ ...enabled, FACE_CHALLENGE_MOVEMENT_RADIANS: 'NaN' }), /configuration is invalid/i);
});

test('active challenge requires directional movement and a neutral final still', () => {
  const config = inProcessFaceConfig(enabled);
  assert.equal(evaluateActiveChallenge('TURN_LEFT', [pose({ yaw: 0.24 }), pose({ yaw: 0.22 }), pose({ yaw: 0.04 }), pose()], pose(), config), true);
  assert.equal(evaluateActiveChallenge('TURN_RIGHT', [pose({ yaw: -0.25 }), pose({ yaw: -0.20 }), pose({ yaw: -0.02 }), pose()], pose(), config), true);
  assert.equal(evaluateActiveChallenge('LOOK_UP', [pose({ pitch: -0.23 }), pose({ pitch: -0.19 }), pose(), pose()], pose(), config), true);
  assert.equal(evaluateActiveChallenge('LOOK_DOWN', [pose({ pitch: 0.23 }), pose({ pitch: 0.19 }), pose(), pose()], pose(), config), true);
  assert.equal(evaluateActiveChallenge('TURN_LEFT', [pose({ yaw: 0.05 }), pose({ yaw: 0.04 }), pose(), pose()], pose(), config), false);
  assert.equal(evaluateActiveChallenge('TURN_LEFT', [pose({ yaw: 0.5 }), pose({ yaw: 0.45 }), pose({ yaw: 0.4 }), pose({ yaw: 0.35 })], pose({ yaw: 0.35 }), config), false);
});

test('provider fails closed when disabled and never accepts browser biometric claims', async () => {
  const runtime = engineWith({ poses: [] });
  const provider = createInProcessFaceMatchProvider({ environment: {}, runtime });
  await assert.rejects(
    provider.evaluate({
      providerSessionRef: 'session-1',
      activeChallenge: activeChallenge('TURN_LEFT'),
      challengeFrameBytes: Array.from({ length: 4 }, () => imageBytes()),
      livePhotoBytes: imageBytes(),
      referencePhotoBytes: imageBytes()
    }),
    (error) => error?.details?.code === 'VERIFICATION_PROVIDER_UNAVAILABLE'
  );
  assert.equal(runtime.calls(), 0);
});

test('provider mints only a narrow server-side PASS result after challenge and 1:1 similarity pass', async () => {
  const runtime = engineWith({
    poses: [pose({ yaw: 0.25 }), pose({ yaw: 0.22 }), pose(), pose(), pose(), pose()],
    similarity: 0.81
  });
  const provider = createInProcessFaceMatchProvider({ environment: enabled, runtime });
  const result = await provider.evaluate({
    providerSessionRef: 'opaque-server-session-ref',
    activeChallenge: activeChallenge('TURN_LEFT'),
    challengeFrameBytes: Array.from({ length: 4 }, () => imageBytes()),
    livePhotoBytes: imageBytes(0x22),
    referencePhotoBytes: imageBytes(0x33)
  });
  assert.equal(provider.name, PROVIDER_NAME);
  assert.equal(provider.verificationMode, VERIFICATION_MODE);
  assert.equal(result.activeChallengePassed, true);
  assert.equal(result.faceMatchPassed, true);
  assert.equal(result.resultCode, 'MATCH');
  assert.equal(runtime.calls(), 6);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'similarity'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'embedding'), false);
});

test('provider rejects a different Reference Photo without exposing similarity or embeddings', async () => {
  const runtime = engineWith({
    poses: [pose({ yaw: 0.25 }), pose({ yaw: 0.22 }), pose(), pose(), pose(), pose()],
    similarity: 0.41
  });
  const result = await createInProcessFaceMatchProvider({ environment: enabled, runtime }).evaluate({
    providerSessionRef: 'opaque-server-session-ref',
    activeChallenge: activeChallenge('TURN_LEFT'),
    challengeFrameBytes: Array.from({ length: 4 }, () => imageBytes()),
    livePhotoBytes: imageBytes(0x22),
    referencePhotoBytes: imageBytes(0x33)
  });
  assert.equal(result.activeChallengePassed, true);
  assert.equal(result.faceMatchPassed, false);
  assert.equal(result.resultCode, 'FACE_MATCH_FAILED');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'similarity'), false);
});

test('provider does not evaluate Reference Photo when Active Challenge fails', async () => {
  const runtime = engineWith({
    poses: [pose({ yaw: 0.03 }), pose({ yaw: 0.02 }), pose(), pose(), pose()],
    similarity: 1
  });
  const result = await createInProcessFaceMatchProvider({ environment: enabled, runtime }).evaluate({
    providerSessionRef: 'opaque-server-session-ref',
    activeChallenge: activeChallenge('TURN_LEFT'),
    challengeFrameBytes: Array.from({ length: 4 }, () => imageBytes()),
    livePhotoBytes: imageBytes(),
    referencePhotoBytes: imageBytes()
  });
  assert.equal(result.activeChallengePassed, false);
  assert.equal(result.faceMatchPassed, false);
  assert.equal(result.resultCode, 'ACTIVE_CHALLENGE_FAILED');
  assert.equal(runtime.calls(), 5);
});
