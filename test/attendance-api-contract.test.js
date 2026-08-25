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
  const calls = { resolveIntent: [], prepareContext: [], prepareVerification: [], deviceProof: [], liveFace: [], accept: [] };
  const verification = {
    resolveEventIntent: async (input) => { calls.resolveIntent.push(input); return { eventIntent: 'CHECK_IN', shiftAssignmentId: '66666666-6666-4666-8666-666666666666', workDate: '2026-08-24' }; },
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
  const face = {
    verifyDeviceProof: async (input) => { calls.deviceProof.push(input); return { verificationReady: true, sessionId: input.sessionId, status: 'DEVICE_PROOF_VERIFIED' }; },
    verifyLiveFace: async (input) => { calls.liveFace.push(input); return { verificationAccepted: true, receipt: 'server-issued-receipt', receiptExpiresAt: 'soon', evidence: { storageStatus: 'NOT_STORED', stored: false } }; }
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
  return { calls, verification, face, events };
}

test('runtime-disabled readiness returns a server blocking state before any context/provider work', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => false });
  const result = await service.assessReadiness({ actor, captureId, attendanceEvidence });
  assert.equal(result.ok, true);
  assert.equal(result.readiness.state, 'BIOMETRIC_RUNTIME_DISABLED');
  assert.equal(result.readiness.attendanceAccepted, false);
  assert.equal(result.eventIntent, null);
  assert.equal(calls.resolveIntent.length, 0);
  assert.equal(calls.prepareContext.length, 0);
  assert.equal(calls.prepareVerification.length, 0);
  assert.equal(calls.accept.length, 0);
});

test('runtime-enabled readiness validates server authority but still cannot report Attendance success', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => true });
  const result = await service.assessReadiness({ actor, captureId, attendanceEvidence, eventIntent: 'CHECK_OUT', contextDigest: 'f'.repeat(64) });
  assert.equal(result.ok, true);
  assert.equal(result.readiness.state, 'READY_TO_START_VERIFICATION');
  assert.equal(result.readiness.attendanceAccepted, false);
  assert.equal(result.eventIntent, 'CHECK_IN');
  assert.equal(calls.resolveIntent.length, 1);
  assert.equal(calls.prepareContext.length, 1);
  assert.deepEqual(Object.keys(calls.prepareContext[0]).sort(), ['actor', 'attendanceEvidence', 'captureId', 'eventIntent']);
  assert.equal(calls.prepareContext[0].eventIntent, 'CHECK_IN');
  assert.equal(Object.prototype.hasOwnProperty.call(calls.prepareContext[0], 'contextDigest'), false);
});

test('beginVerification is blocked while runtime is disabled and creates no FaceVerificationSession work', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => false });
  const result = await service.beginVerification({ actor, captureId, attendanceEvidence });
  assert.equal(result.ok, false);
  assert.equal(result.readiness.state, 'BIOMETRIC_RUNTIME_DISABLED');
  assert.equal(result.eventIntent, null);
  assert.equal(result.verification, null);
  assert.equal(calls.resolveIntent.length, 0);
  assert.equal(calls.prepareVerification.length, 0);
});

test('beginVerification passes only raw Attendance evidence inputs and returns a narrow safe start projection', async () => {
  const { calls, verification, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, attendanceEventService: events, isBiometricRuntimeEnabled: () => true });
  const result = await service.beginVerification({
    actor,
    captureId,
    attendanceEvidence,
    eventIntent: 'CHECK_OUT',
    contextDigest: 'f'.repeat(64),
    padPassed: true,
    faceMatchPassed: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.readiness.attendanceAccepted, false);
  assert.equal(result.eventIntent, 'CHECK_IN');
  assert.equal(calls.resolveIntent.length, 1);
  assert.equal(calls.prepareVerification.length, 1);
  assert.deepEqual(Object.keys(calls.prepareVerification[0]).sort(), ['actor', 'attendanceEvidence', 'captureId', 'eventIntent']);
  assert.equal(calls.prepareVerification[0].eventIntent, 'CHECK_IN');
  assert.deepEqual(Object.keys(result.verification).sort(), ['attendanceContext', 'challenge', 'challengeId', 'expiresAt', 'sessionId', 'status']);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('secret-fingerprint'), false);
  assert.equal(serialized.includes('secret-checksum'), false);
  assert.equal(serialized.includes('secret-provider-ref-hash'), false);
  assert.equal(serialized.includes(attendanceEvidence.qrToken), false);
});

test('device proof and live-face execution remain server-gated and provider-neutral at the Attendance contract', async () => {
  const { calls, verification, face, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, faceVerificationService: face, attendanceEventService: events, isBiometricRuntimeEnabled: () => true });
  const device = await service.verifyDeviceProof({ actor, sessionId: '33333333-3333-4333-8333-333333333333', challengeId: '55555555-5555-4555-8555-555555555555', challenge: 'opaque-device-challenge', signatureBase64: 'opaque-signature' });
  assert.equal(device.ok, true);
  assert.equal(device.verificationReady, true);
  assert.equal(calls.deviceProof.length, 1);
  const livePhotoFile = { buffer: Buffer.from('temporary-live-photo'), mimetype: 'image/jpeg' };
  const matched = await service.verifyLiveFace({ actor, sessionId: '33333333-3333-4333-8333-333333333333', livePhotoFile });
  assert.equal(matched.ok, true);
  assert.equal(matched.verificationAccepted, true);
  assert.equal(matched.receipt, 'server-issued-receipt');
  assert.equal(calls.liveFace.length, 1);
  assert.equal(calls.accept.length, 0);
});

test('device proof and live-face execution fail closed before trusted services when runtime is disabled', async () => {
  const { calls, verification, face, events } = fakeDependencies();
  const service = createAttendanceApiContractService({ verificationContextService: verification, faceVerificationService: face, attendanceEventService: events, isBiometricRuntimeEnabled: () => false });
  const device = await service.verifyDeviceProof({ actor, sessionId: '33333333-3333-4333-8333-333333333333', challengeId: '55555555-5555-4555-8555-555555555555', challenge: 'opaque-device-challenge', signatureBase64: 'opaque-signature' });
  const matched = await service.verifyLiveFace({ actor, sessionId: '33333333-3333-4333-8333-333333333333', livePhotoFile: { buffer: Buffer.from('temporary-live-photo'), mimetype: 'image/jpeg' } });
  assert.equal(device.ok, false);
  assert.equal(device.verificationReady, false);
  assert.equal(matched.ok, false);
  assert.equal(matched.verificationAccepted, false);
  assert.equal(matched.receipt, null);
  assert.equal(calls.deviceProof.length, 0);
  assert.equal(calls.liveFace.length, 0);
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
  const verification = { resolveEventIntent: async () => ({ eventIntent: 'CHECK_IN' }), prepareContext: async () => {}, prepareVerification: async () => {} };
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
  const result = await service.beginVerification({ actor, captureId, attendanceEvidence });
  assert.equal(result.ok, false);
  assert.equal(result.readiness.state, 'BIOMETRIC_RUNTIME_DISABLED');
  assert.equal(calls.resolveIntent.length, 0);
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

test('Attendance API contract remains provider-neutral after gated route skeleton mount', () => {
  const service = read('src/services/attendance-api-contract.service.js');
  const route = read('src/routes/attendance.routes.js');
  const index = read('src/routes/index.js');
  const frontend = fs.readdirSync(path.join(root, 'frontend', 'src'))
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => read(path.join('frontend', 'src', name)))
    .join('\n');
  const attendanceClient = read('frontend/src/pages/attendance/attendance-client.ts');

  assert.doesNotMatch(service, /process\.env|AWS_|Rekognition|CreateFaceLivenessSession|CompareFaces|fetch\(|axios|https?:\/\//i);
  assert.doesNotMatch(service, /padPassed|faceMatchPassed|injectionRiskDetected|contextDigest\s*:/i);
  assert.match(route, /createAttendanceApiContractService/);
  assert.match(route, /attendanceApiEnabled/);
  assert.match(route, /VERCEL_ENV === 'production'/);
  assert.match(route, /const prepareInput = z\.object\(\{\s*captureId: uuid,\s*attendanceEvidence: attendanceEvidenceInput\s*\}\)\.strict\(\)/);
  assert.match(service, /resolveServerIntent/);
  assert.match(index, /router\.use\('\/attendance', attendanceRoutes\)/);
  assert.doesNotMatch(frontend, /attendance-api-contract/);
  assert.match(attendanceClient, /\/attendance\/readiness/);
  assert.match(attendanceClient, /\/attendance\/verification\/start/);
  assert.match(attendanceClient, /\/attendance\/verification\/\$\{encodeURIComponent\(sessionId\)\}\/device-proof/);
  assert.match(attendanceClient, /\/attendance\/verification\/\$\{encodeURIComponent\(sessionId\)\}\/face-match/);
  assert.match(attendanceClient, /\/attendance\/events/);
  assert.doesNotMatch(attendanceClient, /face-verification-self-hosted|AWS_|Rekognition|padPassed|faceMatchPassed|receiptHash/);
});
