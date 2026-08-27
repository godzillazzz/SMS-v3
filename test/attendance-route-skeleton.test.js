'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const HttpError = require('../src/utils/http-error');
const { errorHandler } = require('../src/middlewares/error-handler');
const { validJpegFixture } = require('./support/valid-jpeg-fixture');
const {
  createAttendanceRoutes,
  attendanceApiEnabled,
  selfHostedFaceRuntimeConfigured,
  inProcessFaceRuntimeConfigured,
  attendanceBiometricRuntimeEnabled
} = require('../src/routes/attendance.routes');

const root = path.resolve(__dirname, '..');
const captureId = '11111111-1111-4111-8111-111111111111';
const shiftAssignmentId = '22222222-2222-4222-8222-222222222222';
const siteId = '33333333-3333-4333-8333-333333333333';
const qrCredentialId = '44444444-4444-4444-8444-444444444444';
const evidence = {
  qrToken: 'attendance-qr-token-1234567890',
  location: {
    latitude: 13.7563,
    longitude: 100.5018,
    accuracyMeters: 12.5,
    capturedAt: '2026-08-24T11:00:00.000Z'
  }
};
const context = {
  captureId,
  eventIntent: 'CHECK_IN',
  shiftAssignmentId,
  evidence: {
    siteId,
    qrMode: 'STEP_UP_QR',
    qrCredentialId,
    location: {
      latitude: '13.7563000',
      longitude: '100.5018000',
      accuracyMeters: '12.50',
      capturedAt: '2026-08-24T11:00:00.000Z'
    }
  }
};

function fakeAuth(req, _res, next) {
  if (req.headers.authorization !== 'Bearer route-test') return next(new HttpError(401, 'Authentication required.'));
  req.user = { sub: 'route-user', role: 'VIEWER' };
  return next();
}

function appFor({ environment, service, selfService }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/attendance', createAttendanceRoutes({
    environment,
    authenticateMiddleware: fakeAuth,
    contractService: service,
    selfService
  }));
  app.use(errorHandler);
  return app;
}

function selfServiceSpy() {
  const calls = [];
  return {
    calls,
    service: {
      async today(input) {
        calls.push(['today', input]);
        return {
          generatedAt: '2026-08-27T08:00:00.000Z',
          employee: { id: 'employee-1', employeeCode: 'EMP001', displayName: 'Employee One' },
          assignment: null,
          scheduleReady: false
        };
      },
      async history(input) {
        calls.push(['history', input]);
        return {
          generatedAt: '2026-08-27T08:00:00.000Z',
          employee: { id: 'employee-1', employeeCode: 'EMP001', displayName: 'Employee One' },
          from: input.from,
          to: input.to,
          rows: []
        };
      },
      async schedule(input) {
        calls.push(['schedule', input]);
        return {
          generatedAt: '2026-08-27T08:00:00.000Z',
          employee: { id: 'employee-1', employeeCode: 'EMP001', displayName: 'Employee One' },
          month: input.month,
          approved: true,
          revision: 1,
          rows: []
        };
      }
    }
  };
}

function serviceSpy() {
  const calls = [];
  return {
    calls,
    service: {
      async assessReadiness(input) {
        calls.push(['readiness', input]);
        return { ok: true, eventIntent: 'CHECK_IN', readiness: { state: 'READY_TO_START_VERIFICATION', attendanceAccepted: false } };
      },
      async beginVerification(input) {
        calls.push(['start', input]);
        return {
          ok: true,
          eventIntent: 'CHECK_IN',
          readiness: { state: 'READY_TO_START_VERIFICATION', attendanceAccepted: false },
          verification: { sessionId: 'session-1', attendanceContext: context }
        };
      },
      async verifyDeviceProof(input) {
        calls.push(['device-proof', input]);
        return { ok: true, verificationReady: true, sessionId: input.sessionId, status: 'DEVICE_PROOF_VERIFIED' };
      },
      async verifyLiveFace(input) {
        calls.push(['face-match', input]);
        return { ok: true, verificationAccepted: true, receipt: 'r'.repeat(43), evidence: { storageStatus: 'NOT_STORED', stored: false } };
      },
      async acceptVerifiedEvent(input) {
        calls.push(['event', input]);
        return { ok: true, attendanceAccepted: true, idempotent: false, event: { id: 'event-1' }, session: { id: 'attendance-session-1' } };
      }
    }
  };
}

test('Production hides Attendance route skeleton when only Preview flags are present', async () => {
  const spy = serviceSpy();
  const app = appFor({
    environment: { VERCEL_ENV: 'production', ATTENDANCE_API_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_POC_API_ENABLED: 'true' },
    service: spy.service
  });
  const response = await request(app).post('/api/v1/attendance/readiness').send({});
  assert.equal(response.status, 404);
  assert.equal(spy.calls.length, 0);
});

test('Production Attendance route requires its explicit flag and keeps biometric runtime separately gated', async () => {
  const spy = serviceSpy();
  const app = appFor({ environment: { VERCEL_ENV: 'production', ATTENDANCE_API_PRODUCTION_ENABLED: 'true' }, service: spy.service });
  const response = await request(app).post('/api/v1/attendance/readiness')
    .set('Authorization', 'Bearer route-test')
    .send({ captureId, attendanceEvidence: evidence });
  assert.equal(response.status, 200);
  assert.equal(spy.calls.length, 1);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PRODUCTION_ENABLED: 'true' }), false);
});

test('Preview route remains hidden unless ATTENDANCE_API_PREVIEW_ENABLED is explicitly true', async () => {
  const spy = serviceSpy();
  const app = appFor({ environment: { VERCEL_ENV: 'preview' }, service: spy.service });
  const response = await request(app).post('/api/v1/attendance/readiness').set('Authorization', 'Bearer route-test').send({});
  assert.equal(response.status, 404);
  assert.equal(spy.calls.length, 0);
});

test('flagged Preview Attendance route requires authentication before contract execution', async () => {
  const spy = serviceSpy();
  const app = appFor({ environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }, service: spy.service });
  const response = await request(app).post('/api/v1/attendance/readiness').send({});
  assert.equal(response.status, 401);
  assert.equal(spy.calls.length, 0);
});

test('employee self-service read routes are authenticated, actor-scoped, and reject client employee selection', async () => {
  const spy = serviceSpy();
  const self = selfServiceSpy();
  const app = appFor({
    environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' },
    service: spy.service,
    selfService: self.service
  });

  const today = await request(app)
    .get('/api/v1/attendance/me/today')
    .set('Authorization', 'Bearer route-test');
  assert.equal(today.status, 200);
  assert.deepEqual(self.calls[0], ['today', { actor: { sub: 'route-user', role: 'VIEWER' } }]);

  const history = await request(app)
    .get('/api/v1/attendance/me/history?from=2026-08-01&to=2026-08-27')
    .set('Authorization', 'Bearer route-test');
  assert.equal(history.status, 200);
  assert.deepEqual(self.calls[1], ['history', {
    actor: { sub: 'route-user', role: 'VIEWER' },
    from: '2026-08-01',
    to: '2026-08-27'
  }]);

  const schedule = await request(app)
    .get('/api/v1/attendance/me/schedule?month=2026-08')
    .set('Authorization', 'Bearer route-test');
  assert.equal(schedule.status, 200);
  assert.deepEqual(self.calls[2], ['schedule', {
    actor: { sub: 'route-user', role: 'VIEWER' },
    month: '2026-08'
  }]);

  const anonymous = await request(app).get('/api/v1/attendance/me/today');
  assert.equal(anonymous.status, 401);

  const injectedEmployee = await request(app)
    .get('/api/v1/attendance/me/history?employeeId=33333333-3333-4333-8333-333333333333')
    .set('Authorization', 'Bearer route-test');
  assert.equal(injectedEmployee.status, 400);

  const invalidRange = await request(app)
    .get('/api/v1/attendance/me/history?from=27-08-2026&to=2026-08-27')
    .set('Authorization', 'Bearer route-test');
  assert.equal(invalidRange.status, 400);

  const invalidMonth = await request(app)
    .get('/api/v1/attendance/me/schedule?month=08-2026')
    .set('Authorization', 'Bearer route-test');
  assert.equal(invalidMonth.status, 400);

  assert.equal(self.calls.length, 3);
});

test('readiness accepts only raw Attendance evidence and rejects client biometric/context authority fields', async () => {
  const spy = serviceSpy();
  const app = appFor({ environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }, service: spy.service });
  const valid = { captureId, attendanceEvidence: evidence };
  const response = await request(app).post('/api/v1/attendance/readiness').set('Authorization', 'Bearer route-test').send(valid);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.readiness.attendanceAccepted, false);
  assert.equal(spy.calls.length, 1);
  assert.deepEqual(spy.calls[0][1], { actor: { sub: 'route-user', role: 'VIEWER' }, ...valid });
  assert.equal(response.body.data.eventIntent, 'CHECK_IN');

  for (const injected of [
    { ...valid, eventIntent: 'CHECK_OUT' },
    { ...valid, padPassed: true },
    { ...valid, faceMatchPassed: true },
    { ...valid, contextDigest: 'a'.repeat(64) },
    { ...valid, attendanceEvidence: { ...evidence, providerScore: 99 } }
  ]) {
    const rejected = await request(app).post('/api/v1/attendance/readiness').set('Authorization', 'Bearer route-test').send(injected);
    assert.equal(rejected.status, 400);
  }
  assert.equal(spy.calls.length, 1);
});

test('verification start uses the same strict evidence contract and returns only contract projection', async () => {
  const spy = serviceSpy();
  const app = appFor({ environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }, service: spy.service });
  const response = await request(app).post('/api/v1/attendance/verification/start')
    .set('Authorization', 'Bearer route-test')
    .send({ captureId, attendanceEvidence: evidence });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.verification.sessionId, 'session-1');
  assert.equal(response.body.data.eventIntent, 'CHECK_IN');
  assert.equal(response.body.data.readiness.attendanceAccepted, false);
  assert.equal(spy.calls[0][0], 'start');
});

test('generic Attendance verification endpoints accept only device proof plus bounded in-memory active-challenge frames and live photo', async () => {
  const spy = serviceSpy();
  const app = appFor({ environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }, service: spy.service });
  const sessionId = '55555555-5555-4555-8555-555555555555';
  const proof = await request(app).post(`/api/v1/attendance/verification/${sessionId}/device-proof`)
    .set('Authorization', 'Bearer route-test')
    .send({ challengeId: '66666666-6666-4666-8666-666666666666', challenge: 'opaque-device-challenge', signatureBase64: 'opaque-signature-value' });
  assert.equal(proof.status, 200);
  assert.equal(proof.body.data.verificationReady, true);
  assert.equal(spy.calls[0][0], 'device-proof');
  assert.deepEqual(Object.keys(spy.calls[0][1]).sort(), ['actor', 'challenge', 'challengeId', 'sessionId', 'signatureBase64']);

  const invalidProof = await request(app).post(`/api/v1/attendance/verification/${sessionId}/device-proof`)
    .set('Authorization', 'Bearer route-test')
    .send({ challengeId: '66666666-6666-4666-8666-666666666666', challenge: 'opaque-device-challenge', signatureBase64: 'opaque-signature-value', faceMatchPassed: true });
  assert.equal(invalidProof.status, 400);

  const photo = validJpegFixture();
  let matchRequest = request(app).post(`/api/v1/attendance/verification/${sessionId}/face-match`)
    .set('Authorization', 'Bearer route-test')
    .attach('photo', photo, { filename: 'live.jpg', contentType: 'image/jpeg' });
  for (let index = 0; index < 4; index += 1) matchRequest = matchRequest.attach('challengeFrame', photo, { filename: `challenge-${index + 1}.jpg`, contentType: 'image/jpeg' });
  const match = await matchRequest;
  assert.equal(match.status, 200);
  assert.equal(match.body.data.verificationAccepted, true);
  assert.equal(match.body.data.evidence.storageStatus, 'NOT_STORED');
  assert.equal(spy.calls[1][0], 'face-match');
  assert.equal(Buffer.isBuffer(spy.calls[1][1].livePhotoFile.buffer), true);
  assert.equal(spy.calls[1][1].challengeFrameFiles.length, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(match.body.data, 'faceMatchPassed'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(match.body.data, 'activeChallengePassed'), false);

  let injectedRequest = request(app).post(`/api/v1/attendance/verification/${sessionId}/face-match`)
    .set('Authorization', 'Bearer route-test')
    .field('activeChallengePassed', 'true')
    .attach('photo', photo, { filename: 'live.jpg', contentType: 'image/jpeg' });
  for (let index = 0; index < 4; index += 1) injectedRequest = injectedRequest.attach('challengeFrame', photo, { filename: `injected-${index + 1}.jpg`, contentType: 'image/jpeg' });
  const injectedMatch = await injectedRequest;
  assert.equal(injectedMatch.status, 400);

  const incomplete = await request(app).post(`/api/v1/attendance/verification/${sessionId}/face-match`)
    .set('Authorization', 'Bearer route-test')
    .attach('photo', photo, { filename: 'live.jpg', contentType: 'image/jpeg' })
    .attach('challengeFrame', photo, { filename: 'only-one.jpg', contentType: 'image/jpeg' });
  assert.equal(incomplete.status, 400);

  const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024 * 1024 + 32, 0x22)]);
  let oversizedRequest = request(app).post(`/api/v1/attendance/verification/${sessionId}/face-match`)
    .set('Authorization', 'Bearer route-test')
    .attach('photo', photo, { filename: 'live.jpg', contentType: 'image/jpeg' })
    .attach('challengeFrame', oversized, { filename: 'oversized.jpg', contentType: 'image/jpeg' });
  for (let index = 0; index < 3; index += 1) oversizedRequest = oversizedRequest.attach('challengeFrame', photo, { filename: `small-${index + 1}.jpg`, contentType: 'image/jpeg' });
  const oversizedMatch = await oversizedRequest;
  assert.equal(oversizedMatch.status, 400);
});

test('event acceptance accepts only opaque receipt + server-issued Attendance context', async () => {
  const spy = serviceSpy();
  const app = appFor({ environment: { VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }, service: spy.service });
  const response = await request(app).post('/api/v1/attendance/events')
    .set('Authorization', 'Bearer route-test')
    .send({ receipt: 'r'.repeat(43), attendanceContext: context });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.attendanceAccepted, true);
  assert.equal(response.body.data.event.id, 'event-1');
  assert.equal(spy.calls[0][0], 'event');

  const injected = await request(app).post('/api/v1/attendance/events')
    .set('Authorization', 'Bearer route-test')
    .send({ receipt: 'r'.repeat(43), attendanceContext: context, faceMatchPassed: true });
  assert.equal(injected.status, 400);
  assert.equal(spy.calls.length, 1);
});

test('runtime gates require explicit environment flags and trusted face configuration', () => {
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PRODUCTION_ENABLED: 'true' }), true);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'preview' }), false);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }), true);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_POC_API_ENABLED: 'true' }), false);
  assert.equal(selfHostedFaceRuntimeConfigured({ VERCEL_ENV: 'preview', FACE_VERIFICATION_SELF_HOSTED_API_ENABLED: 'true' }), false);
  assert.equal(selfHostedFaceRuntimeConfigured({ VERCEL_ENV: 'preview', FACE_VERIFICATION_SELF_HOSTED_API_ENABLED: 'true', FACE_VERIFIER_URL: 'https://face.example/verify', FACE_VERIFIER_SHARED_TOKEN: '0123456789abcdef' }), true);
  assert.equal(inProcessFaceRuntimeConfigured({ VERCEL_ENV: 'preview' }), false);
  assert.equal(inProcessFaceRuntimeConfigured({ VERCEL_ENV: 'preview', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' }), true);
  assert.equal(inProcessFaceRuntimeConfigured({ VERCEL_ENV: 'preview', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true', FACE_MATCH_SIMILARITY_THRESHOLD: 'not-a-number' }), false);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' }), true);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PRODUCTION_ENABLED: 'true', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' }), true);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_SELF_HOSTED_API_ENABLED: 'true', FACE_VERIFIER_URL: 'https://face.example/verify', FACE_VERIFIER_SHARED_TOKEN: '0123456789abcdef' }), true);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_POC_API_ENABLED: 'true', FACE_VERIFICATION_SELF_HOSTED_API_ENABLED: 'true', FACE_VERIFIER_URL: 'https://face.example/verify', FACE_VERIFIER_SHARED_TOKEN: '0123456789abcdef' }), false);
});

test('route skeleton is mounted only behind the Attendance prefix and imports no provider implementation', () => {
  const index = fs.readFileSync(path.join(root, 'src/routes/index.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/routes/attendance.routes.js'), 'utf8');
  const frontendRoot = path.join(root, 'frontend/src');
  assert.match(index, /router\.use\('\/attendance', attendanceRoutes\)/);
  assert.match(route, /router\.use\(requirePreviewAttendance, authenticateMiddleware\)/);
  assert.doesNotMatch(route, /aws-rekognition|CreateFaceLivenessSession|CompareFaces|recordTrustedProviderResult|padPassed|faceMatchPassed/i);
  const frontendFiles = fs.readdirSync(frontendRoot, { recursive: true }).filter((name) => typeof name === 'string' && /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name));
  const frontendSource = frontendFiles.map((name) => fs.readFileSync(path.join(frontendRoot, name), 'utf8')).join('\n');
  assert.match(frontendSource, /\/attendance\/verification\/start/);
  assert.match(frontendSource, /\/attendance\/verification\/\$\{encodeURIComponent\(sessionId\)\}\/device-proof/);
  assert.match(frontendSource, /\/attendance\/verification\/\$\{encodeURIComponent\(sessionId\)\}\/face-match/);
  assert.doesNotMatch(frontendSource, /face-verification-self-hosted|AWS_|Rekognition|CompareFaces|padPassed|faceMatchPassed/);
});
