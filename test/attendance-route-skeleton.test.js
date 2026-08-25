'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const HttpError = require('../src/utils/http-error');
const { errorHandler } = require('../src/middlewares/error-handler');
const {
  createAttendanceRoutes,
  attendanceApiEnabled,
  selfHostedFaceRuntimeConfigured,
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

function appFor({ environment, service }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/attendance', createAttendanceRoutes({
    environment,
    authenticateMiddleware: fakeAuth,
    contractService: service
  }));
  app.use(errorHandler);
  return app;
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
      async acceptVerifiedEvent(input) {
        calls.push(['event', input]);
        return { ok: true, attendanceAccepted: true, idempotent: false, event: { id: 'event-1' }, session: { id: 'attendance-session-1' } };
      }
    }
  };
}

test('Production always hides Attendance route skeleton even if Preview flags are accidentally true', async () => {
  const spy = serviceSpy();
  const app = appFor({
    environment: { VERCEL_ENV: 'production', ATTENDANCE_API_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_POC_API_ENABLED: 'true' },
    service: spy.service
  });
  const response = await request(app).post('/api/v1/attendance/readiness').send({});
  assert.equal(response.status, 404);
  assert.equal(spy.calls.length, 0);
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

test('runtime gate can be true only for explicitly flagged Preview and never Production', () => {
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'preview' }), false);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }), true);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(attendanceBiometricRuntimeEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_POC_API_ENABLED: 'true' }), true);
  assert.equal(selfHostedFaceRuntimeConfigured({ VERCEL_ENV: 'preview', FACE_VERIFICATION_SELF_HOSTED_API_ENABLED: 'true' }), false);
  assert.equal(selfHostedFaceRuntimeConfigured({ VERCEL_ENV: 'preview', FACE_VERIFICATION_SELF_HOSTED_API_ENABLED: 'true', FACE_VERIFIER_URL: 'https://face.example/verify', FACE_VERIFIER_SHARED_TOKEN: '0123456789abcdef' }), true);
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
  const frontendFiles = fs.readdirSync(frontendRoot, { recursive: true }).filter((name) => typeof name === 'string' && /\.(ts|tsx)$/.test(name));
  const imported = frontendFiles.some((name) => fs.readFileSync(path.join(frontendRoot, name), 'utf8').includes('/attendance/verification/start'));
  assert.equal(imported, false);
});
