'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  FACE_DIAGNOSTIC_SCHEMA_VERSION,
  providerRefHash,
  safeFaceDiagnostic,
  createFaceVerificationSessionService
} = require('../src/services/face-verification-session.service');

const sessionId = '77777777-7777-4777-8777-777777777777';
const referencePhotoId = '88888888-8888-4888-8888-888888888888';
const createdAt = new Date('2026-09-09T04:00:00.000Z');

function diagnostic(extra = {}) {
  return {
    diagnosticSchemaVersion: FACE_DIAGNOSTIC_SCHEMA_VERSION,
    providerName: 'IN_PROCESS_FACE_MATCH_V1',
    modelName: '@vladmandic/human:3.3.6',
    engineVersion: 'human-3.3.6+hse-faceres-mobilenet+blazeface+facemesh:wasm:v1',
    thresholdValue: 0.62,
    thresholdUnits: 'PROVIDER_SIMILARITY_SCALE',
    thresholdSource: 'DEFAULT',
    metric: 'PROVIDER_SIMILARITY',
    comparator: 'GREATER_THAN_OR_EQUAL',
    scoreBand: 'NEAR_THRESHOLD',
    providerDecision: 'FACE_MATCH_FAILED',
    diagnosticDecision: 'FACE_MATCH_FAILED_LOW_SIMILARITY',
    challengeType: 'LOOK_UP',
    challengeFrameCount: 4,
    identityFrameSource: 'FINAL_NEUTRAL_CAPTURE_RAW',
    referencePhotoId,
    referenceChecksumMatch: true,
    reference: { faceCount: 1, vectorDimension: 1024, vectorFinite: true, normValid: true, faceSizeBand: 'MEDIUM', detectorConfidenceBand: 'HIGH', poseBand: 'NEUTRAL', blurBand: 'UNAVAILABLE', illuminationBand: 'UNAVAILABLE' },
    live: { faceCount: 1, vectorDimension: 1024, vectorFinite: true, normValid: true, faceSizeBand: 'MEDIUM', detectorConfidenceBand: 'HIGH', poseBand: 'NEUTRAL', blurBand: 'UNAVAILABLE', illuminationBand: 'UNAVAILABLE' },
    embedding: [1, 2, 3],
    imageBytes: 'must-not-survive',
    signedUrl: 'must-not-survive',
    ...extra
  };
}

test('safe face diagnostic allow-list removes biometric and credential-shaped fields', () => {
  const result = safeFaceDiagnostic(diagnostic(), { sessionId, referencePhotoId, referenceChecksumMatch: true, createdAt });
  assert.equal(result.diagnosticSchemaVersion, FACE_DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(result.thresholdValue, 0.62);
  assert.equal(result.reference.vectorDimension, 1024);
  assert.equal(result.referenceChecksumMatch, true);
  const json = JSON.stringify(result);
  assert.equal(/embedding|vectorValues|imageBytes|rawImage|signedUrl|token|cookie|authorization/i.test(json), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'embedding'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'imageBytes'), false);
  assert.equal(result.diagnosticCreatedAt, createdAt.toISOString());
});

test('face diagnostic audit metadata is captured for a failed decision without changing session result semantics', async () => {
  let auditPayload = null;
  const providerSessionRef = 'provider-ref-1';
  const snapshot = {
    id: sessionId,
    userId: '99999999-9999-4999-8999-999999999999',
    employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    referencePhotoId,
    referencePhotoChecksum: 'a'.repeat(64),
    status: 'PROVIDER_PENDING',
    verificationMode: 'FACE_MATCH_ONLY',
    provider: 'IN_PROCESS_FACE_MATCH_V1',
    providerSessionRefHash: providerRefHash('provider-ref-1'),
    providerPolicyProfileId: 'FACE_MATCH_ONLY_ACTIVE_CHALLENGE_IN_PROCESS_V1',
    expiresAt: new Date('2099-01-01T00:00:00.000Z')
  };
  const prisma = {
    faceVerificationSession: {
      async findUnique() { return snapshot; },
      async updateMany({ data }) { Object.assign(snapshot, data); return { count: 1 }; }
    },
    async $transaction(callback) {
      return callback({ faceVerificationSession: { async updateMany({ data }) { Object.assign(snapshot, data); return { count: 1 }; } } });
    }
  };
  const audit = { async log(payload) { auditPayload = payload; } };
  const service = createFaceVerificationSessionService({ prisma, audit, clock: () => createdAt });
  const result = await service.recordTrustedFaceMatchOnlyResult({
    sessionId,
    providerSessionRef,
    activeChallengePassed: true,
    faceMatchPassed: false,
    resultCode: 'FACE_MATCH_FAILED',
    policyProfileId: 'FACE_MATCH_ONLY_ACTIVE_CHALLENGE_IN_PROCESS_V1',
    engineVersion: 'human-3.3.6+hse-faceres-mobilenet+blazeface+facemesh:wasm:v1',
    diagnostic: diagnostic()
  });
  assert.equal(result.receipt, null);
  assert.equal(result.session.failureCode, 'FACE_MATCH_FAILED');
  assert.equal(auditPayload.metadata.faceDiagnostic.diagnosticEvent, 'FACE_DIAGNOSTIC_CAPTURED');
  assert.equal(auditPayload.metadata.faceDiagnostic.sessionId, sessionId);
  assert.equal(auditPayload.metadata.faceDiagnostic.referencePhotoId, referencePhotoId);
  assert.equal(auditPayload.metadata.faceDiagnostic.scoreBand, 'NEAR_THRESHOLD');
  assert.equal(JSON.stringify(auditPayload.metadata).includes('must-not-survive'), false);
  assert.equal(JSON.stringify(auditPayload.metadata).includes('embedding'), false);
  assert.equal(providerRefHash(providerSessionRef).length, 64);
});

test('diagnostic read path remains limited to the existing ADMIN audit surface', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/routes/operations.routes.js'), 'utf8');
  assert.match(source, /router\.get\('\/audit-events', authorize\('ADMIN'\)/);
  assert.doesNotMatch(source, /router\.get\('\/face-verification.*diagnostic/);
});
