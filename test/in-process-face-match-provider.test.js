'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PROVIDER_NAME,
  VERIFICATION_MODE,
  DEFAULT_SIMILARITY_THRESHOLD,
  faceMatchDiagnosticBand,
  inProcessFaceConfig,
  evaluateActiveChallenge,
  evaluateActiveChallengeResult,
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

test('face-match diagnostic band is categorical and never exposes the raw similarity', () => {
  assert.equal(faceMatchDiagnosticBand(0.62, 0.62), 'PASS');
  assert.equal(faceMatchDiagnosticBand(0.60, 0.62), 'NEAR_THRESHOLD');
  assert.equal(faceMatchDiagnosticBand(0.50, 0.62), 'BELOW_THRESHOLD');
  assert.equal(faceMatchDiagnosticBand(0.40, 0.62), 'FAR_BELOW_THRESHOLD');
  assert.equal(faceMatchDiagnosticBand(Number.NaN, 0.62), null);
});

test('in-process face config is explicit, bounded, and defaults conservatively', () => {
  assert.equal(inProcessFaceConfig({}).enabled, false);
  const config = inProcessFaceConfig(enabled);
  assert.equal(config.enabled, true);
  assert.equal(config.similarityThreshold, DEFAULT_SIMILARITY_THRESHOLD);
  assert.throws(() => inProcessFaceConfig({ ...enabled, FACE_MATCH_SIMILARITY_THRESHOLD: '0.2' }), /configuration is invalid/i);
  assert.throws(() => inProcessFaceConfig({ ...enabled, FACE_CHALLENGE_MOVEMENT_RADIANS: 'NaN' }), /configuration is invalid/i);
});

test('active challenge uses a neutral baseline, directional movement frames, and a neutral final still', () => {
  const config = inProcessFaceConfig(enabled);
  assert.equal(evaluateActiveChallenge('TURN_LEFT', [pose(), pose({ yaw: 0.24 }), pose({ yaw: 0.22 }), pose({ yaw: 0.04 })], pose(), config), true);
  assert.equal(evaluateActiveChallenge('TURN_RIGHT', [pose(), pose({ yaw: -0.25 }), pose({ yaw: -0.20 }), pose({ yaw: -0.02 })], pose(), config), true);
  assert.equal(evaluateActiveChallenge('LOOK_UP', [pose(), pose({ pitch: -0.23 }), pose({ pitch: -0.19 }), pose()], pose(), config), true);
  assert.equal(evaluateActiveChallenge('LOOK_DOWN', [pose(), pose({ pitch: 0.23 }), pose({ pitch: 0.19 }), pose()], pose(), config), true);
  assert.equal(evaluateActiveChallenge('TURN_LEFT', [pose(), pose({ yaw: 0.05 }), pose({ yaw: 0.04 }), pose()], pose(), config), false);
  assert.equal(evaluateActiveChallenge('TURN_LEFT', [pose({ yaw: 0.35 }), pose({ yaw: 0.5 }), pose({ yaw: 0.45 }), pose({ yaw: 0.4 })], pose(), config), false);
});

test('active challenge result codes remain categorical and preserve baseline, direction, and return-to-neutral enforcement', () => {
  const config = inProcessFaceConfig(enabled);
  assert.equal(
    evaluateActiveChallengeResult('TURN_LEFT', [pose({ yaw: 0.35 }), pose({ yaw: 0.5 }), pose({ yaw: 0.48 }), pose({ yaw: 0.46 })], pose(), config).resultCode,
    'ACTIVE_CHALLENGE_BASELINE_NOT_NEUTRAL'
  );
  assert.equal(
    evaluateActiveChallengeResult('TURN_LEFT', [pose(), pose({ yaw: -0.25 }), pose({ yaw: -0.22 }), pose({ yaw: -0.20 })], pose(), config).resultCode,
    'ACTIVE_CHALLENGE_WRONG_DIRECTION'
  );
  assert.equal(
    evaluateActiveChallengeResult('TURN_LEFT', [pose(), pose({ yaw: 0.25 }), pose({ yaw: 0.22 }), pose()], pose({ yaw: 0.36 }), config).resultCode,
    'ACTIVE_CHALLENGE_FINAL_NOT_NEUTRAL'
  );
  assert.equal(
    evaluateActiveChallengeResult('TURN_LEFT', [pose(), pose({ yaw: 0.05 }), pose({ yaw: 0.04 }), pose()], pose(), config).resultCode,
    'ACTIVE_CHALLENGE_INSUFFICIENT_MOVEMENT'
  );
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
    poses: [pose(), pose({ yaw: 0.25 }), pose({ yaw: 0.22 }), pose(), pose(), pose()],
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
  assert.equal(result.diagnosticMatchBand, 'PASS');
  assert.equal(runtime.calls(), 6);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'similarity'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'embedding'), false);
});

test('Reference Photo quality assessment accepts one neutral usable face without exposing biometric data', async () => {
  const runtime = engineWith({ poses: [pose()], similarity: 1 });
  const provider = createInProcessFaceMatchProvider({ environment: enabled, runtime });
  const result = await provider.assessReferencePhoto({ referencePhotoBytes: imageBytes(0x44) });
  assert.deepEqual(result, { accepted: true, resultCode: 'FACE_REFERENCE_VALID' });
  assert.equal(runtime.calls(), 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'embedding'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'similarity'), false);
});

test('Reference Photo quality assessment rejects non-neutral pose and engine evaluation failure distinctly', async () => {
  const nonNeutral = engineWith({ poses: [pose({ yaw: 0.35 })], similarity: 1 });
  const nonNeutralResult = await createInProcessFaceMatchProvider({ environment: enabled, runtime: nonNeutral }).assessReferencePhoto({ referencePhotoBytes: imageBytes(0x45) });
  assert.deepEqual(nonNeutralResult, { accepted: false, resultCode: 'FACE_REFERENCE_NOT_NEUTRAL' });

  const failedRuntime = {
    async observe() { throw new Error('synthetic reference failure'); },
    similarity() { return 1; }
  };
  const invalidResult = await createInProcessFaceMatchProvider({ environment: enabled, runtime: failedRuntime }).assessReferencePhoto({ referencePhotoBytes: imageBytes(0x46) });
  assert.deepEqual(invalidResult, { accepted: false, resultCode: 'FACE_REFERENCE_INVALID' });
});

test('provider distinguishes unusable Reference Photo from actual low-similarity mismatch', async () => {
  let calls = 0;
  const runtime = {
    async observe() {
      calls += 1;
      if (calls === 6) throw new Error('synthetic reference decode failure');
      const poses = [pose(), pose({ yaw: 0.25 }), pose({ yaw: 0.22 }), pose(), pose()];
      return { pose: poses[calls - 1] || pose(), embedding: [1, 0] };
    },
    similarity() { return 0.9; }
  };
  const result = await createInProcessFaceMatchProvider({ environment: enabled, runtime }).evaluate({
    providerSessionRef: 'opaque-server-session-ref',
    activeChallenge: activeChallenge('TURN_LEFT'),
    challengeFrameBytes: Array.from({ length: 4 }, () => imageBytes()),
    livePhotoBytes: imageBytes(0x22),
    referencePhotoBytes: imageBytes(0x33)
  });
  assert.equal(result.activeChallengePassed, true);
  assert.equal(result.faceMatchPassed, false);
  assert.equal(result.resultCode, 'FACE_REFERENCE_INVALID');
});
test('provider rejects a different Reference Photo without exposing similarity or embeddings', async () => {
  const runtime = engineWith({
    poses: [pose(), pose({ yaw: 0.25 }), pose({ yaw: 0.22 }), pose(), pose(), pose()],
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
  assert.equal(result.diagnosticMatchBand, 'FAR_BELOW_THRESHOLD');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'similarity'), false);
});

test('provider reports only a near-threshold category for a close false reject', async () => {
  const runtime = engineWith({
    poses: [pose(), pose({ yaw: 0.25 }), pose({ yaw: 0.22 }), pose(), pose(), pose()],
    similarity: 0.60
  });
  const result = await createInProcessFaceMatchProvider({ environment: enabled, runtime }).evaluate({
    providerSessionRef: 'opaque-server-session-ref',
    activeChallenge: activeChallenge('TURN_LEFT'),
    challengeFrameBytes: Array.from({ length: 4 }, () => imageBytes()),
    livePhotoBytes: imageBytes(0x22),
    referencePhotoBytes: imageBytes(0x33)
  });
  assert.equal(result.faceMatchPassed, false);
  assert.equal(result.resultCode, 'FACE_MATCH_FAILED');
  assert.equal(result.diagnosticMatchBand, 'NEAR_THRESHOLD');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'similarity'), false);
});

test('provider distinguishes challenge frame evaluation failure from movement failure without exposing biometric details', async () => {
  const runtime = {
    async observe() { throw new Error('synthetic frame decode failure'); },
    similarity() { return 1; }
  };
  const result = await createInProcessFaceMatchProvider({ environment: enabled, runtime }).evaluate({
    providerSessionRef: 'opaque-server-session-ref',
    activeChallenge: activeChallenge('TURN_LEFT'),
    challengeFrameBytes: Array.from({ length: 4 }, () => imageBytes()),
    livePhotoBytes: imageBytes(),
    referencePhotoBytes: imageBytes()
  });
  assert.equal(result.activeChallengePassed, false);
  assert.equal(result.faceMatchPassed, false);
  assert.equal(result.resultCode, 'ACTIVE_CHALLENGE_FRAME_EVALUATION_FAILED');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'pose'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'embedding'), false);
});

test('provider does not evaluate Reference Photo when Active Challenge fails', async () => {
  const runtime = engineWith({
    poses: [pose(), pose({ yaw: 0.03 }), pose({ yaw: 0.02 }), pose(), pose()],
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
  assert.equal(result.resultCode, 'ACTIVE_CHALLENGE_INSUFFICIENT_MOVEMENT');
  assert.equal(runtime.calls(), 5);
});
