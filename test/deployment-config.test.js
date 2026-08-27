const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { attendanceApiEnabled } = require('../src/routes/attendance.routes');

function loadEnvironment(overrides = {}) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.DATABASE_URL;
  delete childEnvironment.DIRECT_URL;
  delete childEnvironment.VERCEL;
  delete childEnvironment.VERCEL_ENV;
  Object.assign(childEnvironment, overrides);
  return spawnSync(process.execPath, ['-e', "require('./src/config/env')"], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: childEnvironment
  });
}

const validJwtSecret = 'x'.repeat(32);

for (const vercelEnvironment of ['preview', 'production']) {
  test(`VERCEL_ENV=${vercelEnvironment} fails fast when DATABASE_URL is missing`, () => {
    const result = loadEnvironment({ NODE_ENV: vercelEnvironment === 'production' ? 'production' : 'test', VERCEL_ENV: vercelEnvironment, JWT_SECRET: validJwtSecret });
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /DATABASE_URL/);
    assert.doesNotMatch(output, /postgres(ql)?:\/\/|localhost|127\.0\.0\.1|sms_v3_(dev|test)/i);
  });
}

test('Vercel environments reject an explicitly configured local database', () => {
  const localDatabaseUrl = ['postgresql:', '', 'test:test@127.0.0.1:5432', 'sms_v3_test'].join('/');
  const result = loadEnvironment({ NODE_ENV: 'production', VERCEL_ENV: 'preview', DATABASE_URL: localDatabaseUrl, JWT_SECRET: validJwtSecret });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /Invalid environment configuration: DATABASE_URL/);
  assert.doesNotMatch(output, /non-local|non-test|localhost|sms_v3_test/);
  assert.doesNotMatch(output, /postgres(ql)?:\/\/|127\.0\.0\.1/);
});

test('local NODE_ENV=test keeps isolated test defaults when not running on Vercel', () => {
  const result = loadEnvironment({ NODE_ENV: 'test' });
  assert.equal(result.status, 0);
});


test('Face Verification PoC environment contract is Preview-only and fail-closed', () => {
  const databaseUrl = ['postgresql:', '', 'preview:preview@example.invalid:5432', 'sms_v3_preview'].join('/');
  const common = { DATABASE_URL: databaseUrl, JWT_SECRET: validJwtSecret };

  const production = loadEnvironment({ ...common, NODE_ENV: 'production', VERCEL_ENV: 'production', FACE_VERIFICATION_POC_API_ENABLED: 'true', FACE_VERIFICATION_PROVIDER: 'AWS_REKOGNITION_POC', FACE_VERIFICATION_AWS_REGION: 'ap-southeast-7', FACE_LIVENESS_MIN_CONFIDENCE: '90', FACE_MATCH_MIN_SIMILARITY: '95' });
  assert.notEqual(production.status, 0);
  assert.match(`${production.stdout}${production.stderr}`, /FACE_VERIFICATION_POC_API_ENABLED/);

  const incompletePreview = loadEnvironment({ ...common, NODE_ENV: 'production', VERCEL_ENV: 'preview', FACE_VERIFICATION_POC_API_ENABLED: 'true' });
  assert.notEqual(incompletePreview.status, 0);
  const incompleteOutput = `${incompletePreview.stdout}${incompletePreview.stderr}`;
  assert.match(incompleteOutput, /FACE_VERIFICATION_PROVIDER/);
  assert.match(incompleteOutput, /FACE_VERIFICATION_AWS_REGION/);
  assert.match(incompleteOutput, /FACE_LIVENESS_MIN_CONFIDENCE/);
  assert.match(incompleteOutput, /FACE_MATCH_MIN_SIMILARITY/);

  const zeroThreshold = loadEnvironment({ ...common, NODE_ENV: 'production', VERCEL_ENV: 'preview', FACE_VERIFICATION_POC_API_ENABLED: 'true', FACE_VERIFICATION_PROVIDER: 'AWS_REKOGNITION_POC', FACE_VERIFICATION_AWS_REGION: 'ap-southeast-7', FACE_LIVENESS_MIN_CONFIDENCE: '0', FACE_MATCH_MIN_SIMILARITY: '95' });
  assert.notEqual(zeroThreshold.status, 0);
  assert.match(`${zeroThreshold.stdout}${zeroThreshold.stderr}`, /FACE_LIVENESS_MIN_CONFIDENCE/);

  const validPreview = loadEnvironment({ ...common, NODE_ENV: 'production', VERCEL_ENV: 'preview', FACE_VERIFICATION_POC_API_ENABLED: 'true', FACE_VERIFICATION_PROVIDER: 'AWS_REKOGNITION_POC', FACE_VERIFICATION_AWS_REGION: 'ap-southeast-7', FACE_LIVENESS_MIN_CONFIDENCE: '90', FACE_MATCH_MIN_SIMILARITY: '95' });
  assert.equal(validPreview.status, 0, `${validPreview.stdout}${validPreview.stderr}`);
});


test('repository config enables Attendance only for Preview while Production still requires its separate explicit flag', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(vercelConfig.env?.ATTENDANCE_API_PREVIEW_ENABLED, 'true');
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }), true);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PRODUCTION_ENABLED: 'true' }), true);
});
