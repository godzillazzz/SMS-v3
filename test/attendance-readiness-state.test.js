'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  STATES,
  serverRuntimeReadiness,
  mapAttendanceDomainOutcome
} = require('../src/services/attendance-readiness-state.service');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('server-disabled biometric runtime is a hard blocking UX state and never Attendance PASS', () => {
  const result = serverRuntimeReadiness({ serverRuntimeEnabled: false });
  assert.equal(result.state, 'BIOMETRIC_RUNTIME_DISABLED');
  assert.equal(result.blocking, true);
  assert.equal(result.retryable, false);
  assert.equal(result.action, 'WAIT_FOR_PROVIDER_ACTIVATION');
  assert.equal(result.attendanceAccepted, false);
  assert.equal(result.authority, 'SERVER_DOMAIN_OUTCOME_ONLY');
});

test('server-enabled runtime only means ready to start verification, never Attendance accepted', () => {
  const result = serverRuntimeReadiness({ serverRuntimeEnabled: true });
  assert.equal(result.state, 'READY_TO_START_VERIFICATION');
  assert.equal(result.blocking, false);
  assert.equal(result.action, 'START_VERIFICATION');
  assert.equal(result.attendanceAccepted, false);
});

test('provider, PAD, match, injection, replay, stale and expiry outcomes map fail-closed', () => {
  const cases = [
    ['VERIFICATION_PROVIDER_UNAVAILABLE', 'BIOMETRIC_TEMPORARILY_UNAVAILABLE', 'RETRY_LATER', true],
    ['LIVENESS_FAILED', 'LIVENESS_NOT_VERIFIED', 'RETRY_FACE_VERIFICATION', true],
    ['FACE_MATCH_FAILED', 'FACE_NOT_MATCHED', 'RETRY_FACE_VERIFICATION', true],
    ['CAPTURE_INJECTION_RISK', 'SECURITY_REVIEW_REQUIRED', 'CONTACT_ADMIN_OR_SECURITY', false],
    ['VERIFICATION_PROVIDER_SESSION_MISMATCH', 'SECURITY_REVIEW_REQUIRED', 'CONTACT_ADMIN_OR_SECURITY', false],
    ['VERIFICATION_REPLAYED', 'VERIFICATION_REPLAY_BLOCKED', 'START_NEW_ATTENDANCE_ATTEMPT', false],
    ['VERIFICATION_EXPIRED', 'VERIFICATION_EXPIRED', 'RESTART_VERIFICATION', true],
    ['VERIFICATION_STALE', 'CONTEXT_CHANGED_RESTART', 'RESTART_ATTENDANCE', true],
    ['VERIFICATION_CONTEXT_MISMATCH', 'CONTEXT_CHANGED_RESTART', 'RESTART_ATTENDANCE', true]
  ];
  for (const [code, state, action, retryable] of cases) {
    const result = mapAttendanceDomainOutcome(code);
    assert.equal(result.state, state, code);
    assert.equal(result.action, action, code);
    assert.equal(result.retryable, retryable, code);
    assert.equal(result.attendanceAccepted, false, code);
    assert.equal(result.blocking, true, code);
  }
});

test('device, reference, schedule, site, QR and GPS authority outcomes map to stable remediation states', () => {
  const cases = [
    ['ATTENDANCE_DEVICE_REQUIRED', 'DEVICE_SETUP_REQUIRED', 'ENROLL_DEVICE'],
    ['ATTENDANCE_DEVICE_AUTHORITY_CONFLICT', 'DEVICE_REVIEW_REQUIRED', 'CONTACT_ADMIN'],
    ['DEVICE_PROOF_FAILED', 'DEVICE_PROOF_RETRY', 'RESTART_DEVICE_PROOF'],
    ['FACE_REFERENCE_REQUIRED', 'REFERENCE_PHOTO_REQUIRED', 'CONTACT_ADMIN'],
    ['FACE_REFERENCE_STALE', 'REFERENCE_PHOTO_REVIEW_REQUIRED', 'CONTACT_ADMIN'],
    ['ATTENDANCE_ASSIGNMENT_REQUIRED', 'SCHEDULE_NOT_READY', 'CONTACT_MANAGER'],
    ['ATTENDANCE_SCHEDULE_NOT_APPROVED', 'SCHEDULE_NOT_READY', 'CONTACT_MANAGER'],
    ['ATTENDANCE_SITE_REQUIRED', 'SITE_NOT_READY', 'CONTACT_MANAGER'],
    ['ATTENDANCE_QR_REVOKED', 'QR_RESCAN_REQUIRED', 'SCAN_CURRENT_SITE_QR'],
    ['ATTENDANCE_LOCATION_ACCURACY_INSUFFICIENT', 'LOCATION_REFRESH_REQUIRED', 'REFRESH_LOCATION'],
    ['ATTENDANCE_LOCATION_STALE', 'LOCATION_REFRESH_REQUIRED', 'REFRESH_LOCATION'],
    ['ATTENDANCE_OUTSIDE_SITE_GEOFENCE', 'OUTSIDE_SITE_GEOFENCE', 'MOVE_INSIDE_ASSIGNED_SITE']
  ];
  for (const [code, state, action] of cases) {
    const result = mapAttendanceDomainOutcome(code);
    assert.equal(result.state, state, code);
    assert.equal(result.action, action, code);
    assert.equal(result.attendanceAccepted, false, code);
  }
});

test('Attendance workflow conflicts never become success and CHECK_OUT without CHECK_IN has a specific action', () => {
  const required = mapAttendanceDomainOutcome('ATTENDANCE_CHECK_IN_REQUIRED');
  assert.equal(required.state, 'CHECK_IN_REQUIRED');
  assert.equal(required.action, 'START_CHECK_IN');
  assert.equal(required.attendanceAccepted, false);

  for (const code of ['ATTENDANCE_ALREADY_CHECKED_IN', 'ATTENDANCE_ALREADY_CHECKED_OUT', 'ATTENDANCE_SESSION_CLOSED', 'ATTENDANCE_SESSION_INCONSISTENT', 'ATTENDANCE_EVENT_CONFLICT']) {
    const result = mapAttendanceDomainOutcome(code);
    assert.equal(result.state, 'ATTENDANCE_STATE_REFRESH_REQUIRED');
    assert.equal(result.action, 'REFRESH_ATTENDANCE_STATUS');
    assert.equal(result.attendanceAccepted, false);
  }
});

test('unknown errors fail closed and raw error details are never copied to the public state', () => {
  const error = new Error('SECRET raw provider stack with receipt=do-not-leak');
  error.details = { code: 'SOME_NEW_INTERNAL_FAILURE', providerPayload: 'SECRET_PROVIDER_PAYLOAD' };
  error.stack = 'SECRET_STACK';
  const result = mapAttendanceDomainOutcome(error);
  const serialized = JSON.stringify(result);
  assert.equal(result.state, 'ATTENDANCE_UNAVAILABLE');
  assert.equal(result.blocking, true);
  assert.equal(result.retryable, false);
  assert.equal(result.attendanceAccepted, false);
  assert.equal(result.reasonCode, 'SOME_NEW_INTERNAL_FAILURE');
  assert.equal(serialized.includes('SECRET'), false);
  assert.equal(serialized.includes('receipt='), false);
  assert.equal(serialized.includes('providerPayload'), false);
});

test('every defined readiness state is non-authoritative for Attendance acceptance', () => {
  for (const preset of Object.values(STATES)) {
    const result = mapAttendanceDomainOutcome('__UNKNOWN__');
    assert.equal(result.attendanceAccepted, false);
    assert.equal(Object.prototype.hasOwnProperty.call(preset, 'attendanceAccepted'), false);
  }
});

test('readiness mapper stays internal/provider-neutral while frontend only renders server outcomes', () => {
  const source = read('src/services/attendance-readiness-state.service.js');
  const doc = read('docs/G06_ATTENDANCE_READINESS_UX_CONTRACT.md');
  const routes = fs.readdirSync(path.join(root, 'src', 'routes'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => read(path.join('src', 'routes', name)))
    .join('\n');
  const frontend = [
    read('frontend/src/main.tsx'),
    read('frontend/src/pages/attendance/AttendancePage.tsx'),
    read('frontend/src/pages/attendance/attendance-client.ts')
  ].join('\n');

  assert.doesNotMatch(source, /process\.env|AWS_|Rekognition|CreateFaceLivenessSession|CompareFaces|fetch\(|axios|http:\/\/|https:\/\//i);
  assert.doesNotMatch(source, /padPassed|faceMatchPassed|injectionRiskDetected|receiptHash|receipt\s*=/i);
  assert.doesNotMatch(routes, /attendance-readiness-state\.service/);
  assert.doesNotMatch(frontend, /attendance-readiness-state/);
  assert.doesNotMatch(frontend, /attendanceAccepted\s*[:=]\s*true|padPassed|faceMatchPassed|receiptHash/);
  assert.match(doc, /always returns `attendanceAccepted: false`/);
  assert.match(doc, /Browser orchestration is restricted to the Preview-gated `\/attendance\/\.\.\.` contract/);
  assert.match(doc, /server returns `attendanceAccepted: true` from a committed AttendanceEvent/);
});
