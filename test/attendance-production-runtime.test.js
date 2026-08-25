'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  productionAttendanceEnabled,
  previewAttendanceEnabled,
  attendanceRuntimeEnabled,
  productionVerifierReady,
  assertProductionAttendanceRuntime
} = require('../src/services/attendance-production-runtime.service');
const {
  attendanceApiEnabled,
  attendanceBiometricRuntimeEnabled,
  attendanceFaceChallengeUatEnabled
} = require('../src/routes/attendance.routes');
const { attendanceSupervisorApiEnabled } = require('../src/routes/attendance-supervisor.routes');
const { attendanceGovernanceApiEnabled } = require('../src/routes/attendance-governance.routes');

const productionReady = {
  VERCEL_ENV: 'production',
  ATTENDANCE_API_PRODUCTION_ENABLED: 'true',
  FACE_VERIFICATION_SELF_HOSTED_API_ENABLED: 'true',
  FACE_VERIFIER_URL: 'https://face.example/verify',
  FACE_VERIFIER_SHARED_TOKEN: '0123456789abcdef'
};

test('Attendance Production remains fail-closed by default', () => {
  const env = { VERCEL_ENV: 'production' };
  assert.equal(productionAttendanceEnabled(env), false);
  assert.equal(attendanceRuntimeEnabled(env), false);
  assert.equal(attendanceApiEnabled(env), false);
  assert.equal(attendanceSupervisorApiEnabled(env), false);
  assert.equal(attendanceGovernanceApiEnabled(env), false);
  assert.doesNotThrow(() => assertProductionAttendanceRuntime(env));
});

test('explicit Production enable requires trusted HTTPS verifier configuration', () => {
  const incomplete = { VERCEL_ENV: 'production', ATTENDANCE_API_PRODUCTION_ENABLED: 'true' };
  assert.equal(productionAttendanceEnabled(incomplete), true);
  assert.equal(productionVerifierReady(incomplete), false);
  assert.throws(() => assertProductionAttendanceRuntime(incomplete), (error) => error?.code === 'ATTENDANCE_PRODUCTION_RUNTIME_INVALID');

  const insecure = { ...productionReady, FACE_VERIFIER_URL: 'http://face.example/verify' };
  assert.equal(productionVerifierReady(insecure), false);
  assert.throws(() => assertProductionAttendanceRuntime(insecure), /trusted face verifier/i);
});

test('explicit Production enable opens core supervisor governance only when verifier contract is ready', () => {
  assert.equal(productionVerifierReady(productionReady), true);
  assert.deepEqual(assertProductionAttendanceRuntime(productionReady), { enabled: true, production: true });
  assert.equal(attendanceApiEnabled(productionReady), true);
  assert.equal(attendanceBiometricRuntimeEnabled(productionReady), true);
  assert.equal(attendanceSupervisorApiEnabled(productionReady), true);
  assert.equal(attendanceGovernanceApiEnabled(productionReady), true);
});

test('Preview gate remains separate and Production never enables UAT face challenge routes', () => {
  const preview = { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' };
  assert.equal(previewAttendanceEnabled(preview), true);
  assert.equal(attendanceRuntimeEnabled(preview), true);
  assert.equal(attendanceGovernanceApiEnabled(preview), true);
  assert.equal(attendanceFaceChallengeUatEnabled({ ...productionReady, G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED: 'true' }), false);
});
