'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('schema and additive migration model face-match-only without pretending PAD/liveness passed', () => {
  const schema = read('prisma/schema.prisma');
  const migration = read('prisma/migrations/202608250001_g06_face_match_only_mode_v1/migration.sql');
  assert.match(schema, /enum FaceVerificationMode[\s\S]*FACE_MATCH_ONLY[\s\S]*FACE_MATCH_WITH_LIVENESS/);
  assert.match(schema, /verificationMode\s+FaceVerificationMode\s+@default\(FACE_MATCH_WITH_LIVENESS\)/);
  assert.match(migration, /"verification_mode" = 'FACE_MATCH_ONLY'/);
  assert.match(migration, /"pad_passed" IS NULL/);
  assert.match(migration, /"injection_risk_detected" IS NULL/);
  assert.match(migration, /"face_match_passed" IS TRUE/);
});

test('core verification service keeps liveness and face-match-only result paths separate', () => {
  const service = read('src/services/face-verification-session.service.js');
  assert.match(service, /recordTrustedProviderResult/);
  assert.match(service, /verificationMode !== 'FACE_MATCH_WITH_LIVENESS'/);
  assert.match(service, /recordTrustedFaceMatchOnlyResult/);
  assert.match(service, /verificationMode !== 'FACE_MATCH_ONLY'/);
  assert.match(service, /padPassed: null, faceMatchPassed: true, injectionRiskDetected: null/);
  assert.match(service, /verificationMode: 'FACE_MATCH_ONLY'/);
});

test('self-hosted route is Preview/test gated, memory-only and never accepts client face-match booleans', () => {
  const route = read('src/routes/face-verification-self-hosted.routes.js');
  assert.ok(route.includes("if (environment.VERCEL_ENV === 'production') return false;"));
  assert.ok(route.includes("environment.VERCEL_ENV === 'preview' && environment.FACE_VERIFICATION_SELF_HOSTED_API_ENABLED === 'true'"));
  assert.match(route, /multer\.memoryStorage\(\)/);
  assert.match(route, /upload\.single\('photo'\)/);
  assert.match(route, /verifier\.verifyFaceMatch/);
  assert.doesNotMatch(route, /padPassed|faceMatchPassed|livenessPassed|confidence|similarity|score/);
});

test('self-hosted face route is mounted separately so legacy AWS PoC remains isolated and paused', () => {
  const routes = read('src/routes/index.js');
  assert.match(routes, /router\.use\('\/face-verification', faceVerificationRoutes\)/);
  assert.match(routes, /router\.use\('\/face-verification-self-hosted', selfHostedFaceVerificationRoutes\)/);
});
