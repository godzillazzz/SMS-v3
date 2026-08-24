'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAttendanceApiContractService, safeVerificationStart } = require('../src/services/attendance-api-contract.service');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const actor = { sub: '11111111-1111-4111-8111-111111111111', role: 'VIEWER' };
const captureId = '22222222-2222-4222-8222-222222222222';
const attendanceEvidence = {
  qrToken: 'raw-current-site-qr-token-that-must-not-leak',
  location: { latitude: 13.72412, longitude: 100.57012, accuracyMeters: 8, capturedAt: '2026-08-24T03:00:00.000Z' }
};

function fakeDependencies() {
  const calls = { prepareContext: [], prepareVerification: [], accept: [] };
  const verification = {
    prepareContext: async (input) => { calls.prepareContext.push(input); return { contextDigest: 'a'.repeat(64) }; },
    prepareVerification: async (input) => {
      calls.prepareVerification.push(input);
      return {
        session: {
          id: '33333333-3333-4333-8333-333333333333',
          status: 'CREATED',
          expiresAt: new Date('2026-08-24T03:05:00.000Z'),
          employeeId: '44444444-4444-4444-8444-444444444444',
          deviceCredentialFingerprint: 'secret-fingerprint',
          referencePhotoChecksum: 'secret-checksum',
          providerSessionRefHash: 'secret-provider-ref-hash'
        },
        challengeId: '55555555-5555-4555-8555-555555555555',
        challenge: 'opaque-device-challenge',
        attendanceContext: {
          captureId,
          eventIntent: 'CHECK_IN',
          shiftAssignmentId: '66666666-6666-4666-8666-666666666666',
          evidence: { siteId: '77777777-7777-4777-8777-777777777777', qrCredentialId: '88888888-8888-4888-8888-888888888888' }
        }
      };
    }
  };
  const events = {
    acceptVerifiedEvent: async (input) => {
      calls.accept.push(input);
      return {
        idempotent: false,
        event: { id: '99999999-9999-4999-8999-999999999999', eventType: 'CHECK_IN' },
        session: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'OPEN' }
      };
    }
  };
  return { calls, verification, events };
}

test('runtime-disabled readiness returns a server blocking state before any context/provider work', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => false });
  const result = await service.assessReadiness({ actor, captureId, eventIntent: 'CHECK_IN', attendanceEvidence });
  assert.equal(result.ok, true);
  assert.equal(result.readiness.state, 'BIOMETRIC_RUNTIME_DISABLED');
  assert.equal(result.readiness.attendanceAccepted, false);
  assert.equal(calls.prepareContext.length, 0);
  assert.equal(calls.prepareVerification.length, 0);
  assert.equal(calls.accept.length, 0);
});

test('runtime-enabled readiness validates server authority but still cannot report Attendance success', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => true });
  const result = await service.assessReadiness({ actor, captureId, eventIntent: 'CHECK_IN', attendanceEvidence, contextDigest: 'f'.repeat(64) });
  assert.equal(result.ok, true);
  assert.equal(result.readiness.state, 'READY_TO_START_VERIFICATION');
  assert.equal(result.readiness.attendanceAccepted, false);
  assert.equal(calls.prepareContext.length, 1);
  assert.deepEqual(Object.keys(calls.prepareContext[0]).sort(), ['actor', 'attendanceEvidence', 'captureId', 'eventIntent']);
  assert.equal(Object.prototype.hasOwnProperty.call(calls.prepareContext[0], 'contextDigest'), false);
});

test('beginVerification is blocked while runtime is disabled and creates no FaceVerificationSession work', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => false });
  const result = await service.beginVerification({ actor, captureId, eventIntent: 'CHECK_IN', attendanceEvidence });
  assert.equal(result.ok, false);
  assert.equal(result.readiness.state, 'BIOMETRIC_RUNTIME_DISABLED');
  assert.equal(result.verification, null);
  assert.equal(calls.prepareVerification.length, 0);
});

test('beginVerification passes only raw Attendance evidence inputs and returns a narrow safe start projection', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => true });
  const result = await service.beginVerification({
    actor,
    captureId,
    eventIntent: 'CHECK_IN',
    attendanceEvidence,
    contextDigest: 'f'.repeat(64),
    padPassed: true,
    faceMatchPassed: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.readiness.attendanceAccepted, false);
  assert.equal(calls.prepareVerification.length, 1);
  assert.deepEqual(Object.keys(calls.prepareVerification[0]).sort(), ['actor', 'attendanceEvidence', 'captureId', 'eventIntent']);
  assert.deepEqual(Object.keys(result.verification).sort(), ['attendanceContext', 'challenge', 'challengeId', 'expiresAt', 'sessionId', 'status']);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret-fingerprint'), false);
  assert.equal(serialized.includes('secret-checksum'), false);
  assert.equal(serialized.includes('secret-provider-ref-hash'), false);
  assert.equal(serialized.includes(attendanceEvidence.qrToken), false);
});

test('only a committed AttendanceEvent service result may set attendanceAccepted=true', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => false });
  const receipt = 'opaque-verification-receipt-secret';
  const attendanceContext = { captureId, eventIntent: 'CHECK_IN', shiftAssignmentId: '66666666-6666-4666-8666-666666666666' };
  const result = await service.acceptVerifiedEvent({ actor, receipt, attendanceContext });
  assert.equal(result.ok, true);
  assert.equal(result.attendanceAccepted, true);
  assert.equal(result.event.eventType, 'CHECK_IN');
  assert.equal(calls.accept.length, 1);
  assert.deepEqual(calls.accept[0], { actor, receipt, attendanceContext });
});

test('event-acceptance domain errors map to fail-closed readiness without leaking receipt or raw provider error', async () => {
  const error = new Error('SECRET provider payload receipt=should-not-leak');
  error.details = { code: 'VERIFICATION_REPLAYED', providerPayload: 'SECRET' };
  const verification = { prepareContext: async () => {}, prepareVerification: async () => {} };
  const events = { acceptVerifiedEvent: async () => { throw error; } };
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => true });
  const result = await service.acceptVerifiedEvent({ actor, receipt: 'secret-receipt', attendanceContext: { captureId } });
  assert.equal(result.ok, false);
  assert.equal(result.attendanceAccepted, false);
  assert.equal(result.readiness.state, 'VERIFICATION_REPLAY_BLOCKED');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('SECRET'), false);
  assert.equal(serialized.includes('secret-receipt'), false);
});

test('runtime gate exceptions fail closed without downstream verification work', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({
    verificationContextService: verification,
    attendanceEventService: events,
    isBiometricRuntimeEnabled: () => { throw new Error('runtime config failure'); }
  });
  const result = await service.beginVerification({ actor, captureId, eventIntent: 'CHECK_IN', attendanceEvidence });
  assert.equal(result.ok, false);
  assert.equal(result.readiness.state, 'BIOMETRIC_RUNTIME_DISABLED');
  assert.equal(calls.prepareVerification.length, 0);
});

test('safe verification projection does not expose biometric/provider/internal authority fields', () => {
  const projected = safeVerificationStart({
    session: { id: 's', status: 'CREATED', expiresAt: 'soon', employeeId: 'e', deviceCredentialFingerprint: 'fp', referencePhotoChecksum: 'sum', providerSessionRefHash: 'provider' },
    challengeId: 'c',
    challenge: 'challenge',
    attendanceContext: { captureId: 'cap' },
    receipt: 'must-never-be-here'
  });
  assert.deepEqual(projected, { sessionId: 's', status: 'CREATED', expiresAt: 'soon', challengeId: 'c', challenge: 'challenge', attendanceContext: { captureId: 'cap' } });
});

test('Attendance API contract remains unmounted and provider-neutral', () => {
  const service = read('src/services/attendance-api-contract.service.js');
  const doc = read('docs/G06_ATTENDANCE_API_CONTRACT_DRAFT.md');
  const routes = fs.readdirSync(path.join(root, 'src', 'routes'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => read(path.join('src', 'routes', name)))
    .join('\n');
  const frontend = fs.readdirSync(path.join(root, 'frontend', 'src'))
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => read(path.join('frontend', 'src', name)))
    .join('\n');

  assert.doesNotMatch(service, /process\.env|AWS_|Rekognition|CreateFaceLivenessSession|CompareFaces|fetch\(|axios|https?:\/\//i);
  assert.doesNotMatch(service, /padPassed|faceMatchPassed|injectionRiskDetected|contextDigest\s*:/i);
  assert.doesNotMatch(routes, /attendance-api-contract\.service|\/attendance\/verification\/readiness|\/attendance\/verification\/start|\/attendance\/events/);
  assert.doesNotMatch(frontend, /attendance-api-contract|\/attendance\/verification\/readiness|\/attendance\/verification\/start|\/attendance\/events/);
  assert.match(doc, /INTERNAL \/ UNMOUNTED \/ NO PUBLIC ATTENDANCE WRITE ROUTE/);
  assert.match(doc, /This checkpoint deliberately stops before mounting any route/);
});
