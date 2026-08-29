'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { challengeHash, receiptHash, providerRefHash, SESSION_TTL_MS, RECEIPT_TTL_MS } = require('../src/services/face-verification-session.service');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Phase 3B-1 schema adds verification sessions and opaque receipts without biometric media/template persistence', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /enum FaceVerificationPurpose[\s\S]*ATTENDANCE_EVENT[\s\S]*PATROL_EVENT/);
  assert.match(schema, /model FaceVerificationSession/);
  assert.match(schema, /model FaceVerificationReceipt/);
  const block = schema.slice(schema.indexOf('model FaceVerificationSession'), schema.indexOf('model EmployeeLifecycleEvent'));
  assert.doesNotMatch(block, /imageBytes|videoBytes|embedding|template|faceCollection|publicUrl|employeeCode/i);
  assert.match(block, /receiptHash/);
  assert.match(block, /providerSessionRefHash/);
  assert.match(block, /deviceCredentialFingerprint/);
  assert.match(block, /referencePhotoChecksum/);
});

test('migration enforces one active verification per employee/device/purpose and verified-state safety', () => {
  const migration = read('prisma/migrations/202608240002_g06_face_verification_session_v1/migration.sql');
  assert.match(migration, /face_verification_sessions_one_active_per_employee_device_purpose/);
  assert.match(migration, /WHERE "status" IN \('CREATED','DEVICE_PROOF_VERIFIED','PROVIDER_PENDING','VERIFIED'\)/);
  assert.match(migration, /face_verification_sessions_verified_state_check/);
  assert.match(migration, /"pad_passed" IS TRUE/);
  assert.match(migration, /"face_match_passed" IS TRUE/);
  assert.match(migration, /"injection_risk_detected" IS FALSE/);
  assert.match(migration, /face_verification_receipts_receipt_hash_key/);
  assert.match(migration, /device_credential_fingerprint/);
  assert.match(migration, /reference_photo_checksum/);
});

test('opaque challenge, provider correlation and receipt helpers use SHA-256 and never preserve raw secret', () => {
  const challenge = 'challenge-' + crypto.randomUUID();
  const receipt = 'receipt-' + crypto.randomUUID();
  const providerRef = 'provider-' + crypto.randomUUID();
  for (const [raw, hashed] of [[challenge, challengeHash(challenge)], [receipt, receiptHash(receipt)], [providerRef, providerRefHash(providerRef)]]) {
    assert.equal(hashed.length, 64);
    assert.notEqual(hashed, raw);
    assert.match(hashed, /^[0-9a-f]{64}$/);
  }
});

test('verification and receipt lifetimes are short-lived by contract', () => {
  assert.equal(SESSION_TTL_MS, 5 * 60 * 1000);
  assert.equal(RECEIPT_TTL_MS, 2 * 60 * 1000);
  assert.ok(RECEIPT_TTL_MS < SESSION_TTL_MS);
});

test('a fresh retry may supersede only pre-provider verification sessions while provider-pending and verified sessions stay protected', () => {
  const service = read('src/services/face-verification-session.service.js');
  assert.match(service, /RESTARTABLE_SESSION_STATUSES = \['CREATED', 'DEVICE_PROOF_VERIFIED'\]/);
  assert.match(service, /failureCode: 'VERIFICATION_SUPERSEDED'/);
  assert.match(service, /event: 'VERIFICATION_SUPERSEDED'/);
  assert.match(service, /else if \(existing\)[\s\S]*FACE_VERIFICATION_SESSION_ALREADY_ACTIVE/);
  const restartableLine = service.match(/RESTARTABLE_SESSION_STATUSES = \[([^\]]+)\]/)?.[1] || '';
  assert.doesNotMatch(restartableLine, /'PROVIDER_PENDING'|'VERIFIED'/);
});

test('service binds account employee active device current Reference Photo challenge and context before provider work', () => {
  const service = read('src/services/face-verification-session.service.js');
  assert.match(service, /linkedEmployee/);
  assert.match(service, /status: 'ACTIVE'/);
  assert.match(service, /employeeReferencePhoto\.findMany/);
  assert.match(service, /attendanceDeviceEnrollment\.findMany/);
  assert.match(service, /deviceChallengeId/);
  assert.match(service, /contextDigest/);
  assert.doesNotMatch(service, /employeeCode/);
});

test('trusted provider result stays in the core service while Phase 3B-2 exposes only a preview-gated authenticated PoC route', () => {
  const service = read('src/services/face-verification-session.service.js');
  const route = read('src/routes/face-verification.routes.js');
  const routes = read('src/routes/index.js');
  assert.match(service, /recordTrustedProviderResult/);
  assert.match(service, /providerSessionRefHash/);
  assert.match(route, /router.use\(requirePreviewPoc, authenticate\)/);
  assert.match(route, /VERCEL_ENV === 'preview'/);
  assert.match(route, /FACE_VERIFICATION_POC_API_ENABLED === 'true'/);
  assert.ok(routes.includes("router.use('/face-verification', faceVerificationRoutes)"));
});

test('PAD face match and injection risk all gate receipt issuance fail closed', () => {
  const service = read('src/services/face-verification-session.service.js');
  assert.match(service, /CAPTURE_INJECTION_RISK/);
  assert.match(service, /LIVENESS_FAILED/);
  assert.match(service, /FACE_MATCH_FAILED/);
  assert.match(service, /padPassed: true/);
  assert.match(service, /faceMatchPassed: true/);
  assert.match(service, /injectionRiskDetected: false/);
});

test('receipt consumption is atomic single-use and re-checks current authority', () => {
  const service = read('src/services/face-verification-session.service.js');
  assert.match(service, /VERIFICATION_REPLAYED/);
  assert.match(service, /faceVerificationReceipt\.updateMany/);
  assert.match(service, /faceVerificationSession\.updateMany/);
  assert.match(service, /status: 'CONSUMED'/);
  assert.match(service, /VERIFICATION_CONTEXT_MISMATCH/);
  assert.match(service, /VERIFICATION_STALE/);
});

test('Phase 3B core service remains provider-neutral while the AWS PoC adapter is isolated and carries no credential literals', () => {
  const service = read('src/services/face-verification-session.service.js');
  const provider = read('src/services/aws-rekognition-face-verification.provider.js');
  const pkg = read('package.json');
  assert.doesNotMatch(service, /AWS_ACCESS_KEY|AWS_SECRET|IPROOV|REKOGNITION/i);
  assert.match(pkg, /@aws-sdk\/client-rekognition/);
  assert.doesNotMatch(provider, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/);
  assert.doesNotMatch(provider, /OutputConfig|S3Bucket|S3KeyPrefix/);
  assert.ok(fs.existsSync(path.join(root, 'src/routes/face-verification.routes.js')));
});

test('receipt consumer exposes a caller-transaction path for atomic Attendance event acceptance', () => {
  const service = read('src/services/face-verification-session.service.js');
  assert.match(service, /consumeReceiptInTransaction/);
  assert.match(service, /consumeReceiptWithClient/);
  assert.match(service, /VERIFICATION_TRANSACTION_REQUIRED/);
  assert.match(service, /return \{ createSession, verifyDeviceProof, bindProviderSession, recordTrustedProviderResult, recordTrustedFaceMatchOnlyResult, consumeReceipt, consumeReceiptInTransaction, failSession \}/);
});
