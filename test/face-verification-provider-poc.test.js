'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  CompareFacesCommand
} = require('@aws-sdk/client-rekognition');
const {
  PROVIDER_NAME,
  DEFAULT_REGION,
  DEFAULT_CHALLENGE_TYPE,
  providerConfig,
  createAwsRekognitionFaceVerificationProvider
} = require('../src/services/aws-rekognition-face-verification.provider');
const { pocApiEnabled } = require('../src/routes/face-verification.routes');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const env = (extra = {}) => ({
  FACE_VERIFICATION_PROVIDER: PROVIDER_NAME,
  FACE_VERIFICATION_AWS_REGION: DEFAULT_REGION,
  FACE_LIVENESS_MIN_CONFIDENCE: '90',
  FACE_MATCH_MIN_SIMILARITY: '95',
  ...extra
});

function fakeClient(handler) { return { send: async (command) => handler(command) }; }

test('AWS Rekognition PoC config is Thailand-region, audit-image-free and requires explicit thresholds', () => {
  const cfg = providerConfig(env());
  assert.equal(cfg.region, 'ap-southeast-7');
  assert.equal(cfg.challengeType, 'FaceMovementAndLightChallenge');
  assert.equal(cfg.auditImagesLimit, 0);
  assert.equal(cfg.livenessMinConfidence, 90);
  assert.equal(cfg.faceMatchMinSimilarity, 95);
  assert.throws(() => providerConfig({ FACE_VERIFICATION_PROVIDER: PROVIDER_NAME }), (error) => error.details?.code === 'VERIFICATION_PROVIDER_CONFIGURATION_INCOMPLETE');
  assert.throws(() => providerConfig(env({ FACE_VERIFICATION_AWS_REGION: 'us-east-1' })), (error) => error.details?.code === 'VERIFICATION_PROVIDER_REGION_NOT_ALLOWED');
});

test('CreateFaceLivenessSession uses zero audit images, no S3 output and the highest-accuracy default challenge', async () => {
  let captured;
  const provider = createAwsRekognitionFaceVerificationProvider({ environment: env(), client: fakeClient(async (command) => { captured = command; return { SessionId: 'aws-session-1' }; }) });
  const created = await provider.createLivenessSession({ clientRequestToken: '11111111-1111-4111-8111-111111111111' });
  assert.ok(captured instanceof CreateFaceLivenessSessionCommand);
  assert.equal(captured.input.Settings.AuditImagesLimit, 0);
  assert.deepEqual(captured.input.Settings.ChallengePreferences, [{ Type: DEFAULT_CHALLENGE_TYPE }]);
  assert.equal(Object.prototype.hasOwnProperty.call(captured.input.Settings, 'OutputConfig'), false);
  assert.equal(created.providerSessionRef, 'aws-session-1');
  assert.equal(created.region, DEFAULT_REGION);
});

test('provider keeps in-progress liveness pending without calling CompareFaces', async () => {
  let calls = 0;
  const provider = createAwsRekognitionFaceVerificationProvider({ environment: env(), client: fakeClient(async (command) => { calls += 1; assert.ok(command instanceof GetFaceLivenessSessionResultsCommand); return { Status: 'IN_PROGRESS' }; }) });
  const result = await provider.evaluate({ providerSessionRef: 'aws-session', referencePhotoBytes: Buffer.from('reference') });
  assert.equal(result.complete, false);
  assert.equal(result.providerStatus, 'IN_PROGRESS');
  assert.equal(calls, 1);
});

test('low liveness confidence fails PAD and never performs face comparison', async () => {
  let calls = 0;
  const provider = createAwsRekognitionFaceVerificationProvider({ environment: env(), client: fakeClient(async (command) => { calls += 1; assert.ok(command instanceof GetFaceLivenessSessionResultsCommand); return { Status: 'SUCCEEDED', Confidence: 89.9, ReferenceImage: { Bytes: Uint8Array.from([1,2,3]) } }; }) });
  const result = await provider.evaluate({ providerSessionRef: 'aws-session', referencePhotoBytes: Buffer.from('reference') });
  assert.equal(result.padPassed, false);
  assert.equal(result.faceMatchPassed, false);
  assert.equal(result.resultCode, 'AWS_LIVENESS_LOW_CONFIDENCE');
  assert.equal(calls, 1);
});

test('successful liveness performs stateless 1:1 CompareFaces in memory and returns only pass/fail metadata', async () => {
  const calls = [];
  const provider = createAwsRekognitionFaceVerificationProvider({ environment: env(), client: fakeClient(async (command) => {
    if (command instanceof GetFaceLivenessSessionResultsCommand) { calls.push('liveness'); return { Status: 'SUCCEEDED', Confidence: 99, ReferenceImage: { Bytes: Uint8Array.from([9,8,7,6]) } }; }
    if (command instanceof CompareFacesCommand) { calls.push('compare'); assert.equal(command.input.SimilarityThreshold, 95); assert.ok(command.input.SourceImage.Bytes); assert.ok(command.input.TargetImage.Bytes); return { FaceMatches: [{ Similarity: 98.5 }] }; }
    throw new Error('unexpected command');
  }) });
  const result = await provider.evaluate({ providerSessionRef: 'aws-session', referencePhotoBytes: Buffer.from('reference-photo') });
  assert.deepEqual(calls, ['liveness','compare']);
  assert.equal(result.padPassed, true);
  assert.equal(result.faceMatchPassed, true);
  assert.equal(result.injectionRiskDetected, false);
  assert.equal(result.resultCode, 'AWS_VERIFICATION_PASS');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'confidence'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'similarity'), false);
});

test('AWS SDK/provider failures are sanitized and never expose raw provider errors', async () => {
  const provider = createAwsRekognitionFaceVerificationProvider({ environment: env(), client: fakeClient(async () => { throw new Error('SECRET provider stack detail'); }) });
  await assert.rejects(() => provider.createLivenessSession({ clientRequestToken: '11111111-1111-4111-8111-111111111111' }), (error) => error.statusCode === 503 && error.details?.code === 'VERIFICATION_PROVIDER_UNAVAILABLE' && !error.message.includes('SECRET'));
});

test('PoC route is test/Preview-only and production cannot enable it with the feature flag alone', () => {
  assert.equal(pocApiEnabled({ NODE_ENV: 'test' }), true);
  assert.equal(pocApiEnabled({ VERCEL_ENV: 'preview', FACE_VERIFICATION_POC_API_ENABLED: 'true' }), true);
  assert.equal(pocApiEnabled({ VERCEL_ENV: 'preview', FACE_VERIFICATION_POC_API_ENABLED: 'false' }), false);
  assert.equal(pocApiEnabled({ VERCEL_ENV: 'production', FACE_VERIFICATION_POC_API_ENABLED: 'true' }), false);
  assert.equal(pocApiEnabled({ NODE_ENV: 'test', VERCEL_ENV: 'production', FACE_VERIFICATION_POC_API_ENABLED: 'true' }), false);
  const route = read('src/routes/face-verification.routes.js');
  assert.match(route, /router.use\(requirePreviewPoc, authenticate\)/);
  assert.doesNotMatch(route, /AWS_ACCESS_KEY|AWS_SECRET_ACCESS|AWS_SESSION_TOKEN/);
});

test('PoC orchestration reads private Reference Photo bytes and never persists provider images or scores', () => {
  const service = read('src/services/face-verification-poc.service.js');
  const provider = read('src/services/aws-rekognition-face-verification.provider.js');
  assert.match(service, /storage\.getBytes/);
  assert.match(service, /referenceBytes\.fill\(0\)/);
  assert.match(service, /recordTrustedProviderResult/);
  assert.doesNotMatch(service, /imageBytes|videoBytes|auditImages|similarity|confidence/i);
  assert.doesNotMatch(provider, /OutputConfig|S3Bucket|S3KeyPrefix/);
});
