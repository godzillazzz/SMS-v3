'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIVE_FACE_CHALLENGE_VERSION,
  deriveActiveFaceChallenge
} = require('../src/services/active-face-challenge.service');
const {
  PROVIDER_NAME,
  VERIFICATION_MODE,
  verifierConfig,
  createSelfHostedFaceMatchProvider
} = require('../src/services/self-hosted-face-match.provider');

function jpeg(size = 256) {
  const buffer = Buffer.alloc(size, 7);
  buffer[0] = 0xff; buffer[1] = 0xd8; buffer[2] = 0xff;
  return buffer;
}

function env(overrides = {}) {
  return {
    NODE_ENV: 'test',
    FACE_VERIFIER_URL: 'https://face.internal.example/verify',
    FACE_VERIFIER_SHARED_TOKEN: '0123456789abcdef0123456789abcdef',
    ...overrides
  };
}

const sessionId = '33333333-3333-4333-8333-333333333333';
const activeChallenge = deriveActiveFaceChallenge(sessionId);
const challengeFrameBytes = [jpeg(180), jpeg(181), jpeg(182), jpeg(183)];

test('self-hosted face verifier config fails closed without HTTPS endpoint and server secret', () => {
  assert.throws(() => verifierConfig({ NODE_ENV: 'production' }), /not configured/i);
  assert.throws(() => verifierConfig(env({ NODE_ENV: 'production', FACE_VERIFIER_URL: 'http://face.example/verify' })), /HTTPS/i);
  assert.throws(() => verifierConfig(env({ FACE_VERIFIER_SHARED_TOKEN: 'short' })), /not configured/i);
  const configured = verifierConfig(env());
  assert.equal(configured.url, 'https://face.internal.example/verify');
  assert.ok(configured.token.length >= 16);
});

test('provider sends server-derived active challenge plus transient frames/live/reference images and returns narrow trusted booleans', async () => {
  let captured;
  const provider = createSelfHostedFaceMatchProvider({
    environment: env(),
    fetchImpl: async (url, options) => {
      captured = { url, options };
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.authorization, 'Bearer 0123456789abcdef0123456789abcdef');
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('requestRef'), 'session-ref-123');
      assert.equal(options.body.get('mode'), 'FACE_MATCH_ONLY');
      assert.equal(options.body.get('activeChallengeVersion'), activeChallenge.version);
      assert.equal(options.body.get('activeChallengeCode'), activeChallenge.code);
      assert.equal(options.body.getAll('challengeFrame').length, 4);
      assert.deepEqual(options.body.getAll('challengeFrame').map((frame) => frame.size), [180, 181, 182, 183]);
      assert.equal(options.body.get('livePhoto').size, 256);
      assert.equal(options.body.get('referencePhoto').size, 320);
      return {
        ok: true,
        async json() {
          return { match: true, activeChallengePassed: true, resultCode: 'MATCH', policyProfileId: 'private-v1', engineVersion: 'engine-1', confidence: 99.99 };
        }
      };
    }
  });
  assert.deepEqual(provider.publicConfig(), { provider: PROVIDER_NAME, verificationMode: VERIFICATION_MODE, storesLivePhoto: false, activeChallengeVersion: ACTIVE_FACE_CHALLENGE_VERSION });
  const result = await provider.evaluate({
    providerSessionRef: 'session-ref-123',
    activeChallenge,
    challengeFrameBytes,
    livePhotoBytes: jpeg(256),
    referencePhotoBytes: jpeg(320)
  });
  assert.equal(captured.url, 'https://face.internal.example/verify');
  assert.deepEqual(result, {
    activeChallengePassed: true,
    faceMatchPassed: true,
    resultCode: 'MATCH',
    policyProfileId: 'private-v1',
    engineVersion: 'engine-1',
    providerSessionRef: 'session-ref-123'
  });
  assert.equal('confidence' in result, false, 'raw provider score must not escape the server adapter');
});

test('provider fails closed when activeChallengePassed is missing from the trusted verifier result', async () => {
  const provider = createSelfHostedFaceMatchProvider({ environment: env(), fetchImpl: async () => ({ ok: true, json: async () => ({ match: true }) }) });
  await assert.rejects(
    () => provider.evaluate({ providerSessionRef: 'session-ref-123', activeChallenge, challengeFrameBytes, livePhotoBytes: jpeg(), referencePhotoBytes: jpeg() }),
    (error) => error?.details?.code === 'VERIFICATION_PROVIDER_RESULT_INVALID'
  );
});

test('provider sanitizes transport/provider failures and never exposes raw upstream details', async () => {
  const provider = createSelfHostedFaceMatchProvider({
    environment: env(),
    fetchImpl: async () => { throw new Error('SECRET upstream stack/token detail'); }
  });
  await assert.rejects(
    () => provider.evaluate({ providerSessionRef: 'session-ref-123', activeChallenge, challengeFrameBytes, livePhotoBytes: jpeg(), referencePhotoBytes: jpeg() }),
    (error) => error?.details?.code === 'VERIFICATION_PROVIDER_UNAVAILABLE' && !String(error.message).includes('SECRET')
  );
});
