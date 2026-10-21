'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../src/middlewares/error-handler');
const HttpError = require('../src/utils/http-error');
const { attendanceApiEnabled } = require('../src/config/attendance-api-policy');
const {
  createAttendanceRoutes,
  attendanceFaceChallengeUatEnabled,
  attendanceGeofenceOnlyUatEnabled,
  attendanceBiometricRuntimeEnabled
} = require('../src/routes/attendance.routes');

function auth(req, _res, next) {
  if (req.headers.authorization !== 'Bearer test') return res401(next);
  req.user = { sub: 'self-host-user', role: 'VIEWER' };
  next();
}
function res401(next) {
  next(new HttpError(401, 'Authentication required.'));
}
function serviceSpy(calls) {
  return {
    async assessReadiness(input) {
      calls.push(input);
      return { ok: true, eventIntent: 'CHECK_IN', readiness: { state: 'READY_TO_START_VERIFICATION', attendanceAccepted: false } };
    }
  };
}
function appFor(environment, calls) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/attendance', createAttendanceRoutes({
    environment,
    authenticateMiddleware: auth,
    contractService: serviceSpy(calls)
  }));
  app.use(errorHandler);
  return app;
}

const selfHosted = { NODE_ENV: 'production' };

test('self-hosted production defaults closed and malformed values fail closed', () => {
  assert.equal(attendanceApiEnabled(selfHosted), false);
  assert.equal(attendanceApiEnabled({ NODE_ENV: 'production', SELF_HOSTED_ATTENDANCE_API_ENABLED: 'TRUE' }), false);
  assert.equal(attendanceApiEnabled({ NODE_ENV: 'production', SELF_HOSTED_ATTENDANCE_API_ENABLED: '1' }), false);
  assert.equal(attendanceApiEnabled({ NODE_ENV: 'production', VERCEL_ENV: 'preview', SELF_HOSTED_ATTENDANCE_API_ENABLED: 'true' }), false);
});

test('self-hosted production flag reaches authentication and service', async () => {
  const calls = [];
  const environment = { ...selfHosted, SELF_HOSTED_ATTENDANCE_API_ENABLED: 'true' };
  const app = appFor(environment, calls);
  const anonymous = await request(app).post('/api/v1/attendance/readiness').send({});
  assert.equal(anonymous.status, 401);
  assert.equal(calls.length, 0);
  const authenticated = await request(app)
    .post('/api/v1/attendance/readiness')
    .set('Authorization', 'Bearer test')
    .send({ captureId: '11111111-1111-4111-8111-111111111111', attendanceEvidence: {
      location: { latitude: 13.7, longitude: 100.5, accuracyMeters: 10, capturedAt: '2026-08-24T11:00:00.000Z' }
    } });
  assert.equal(authenticated.status, 200);
  assert.equal(calls.length, 1);
});

test('Vercel production and Preview behavior remain unchanged', () => {
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PRODUCTION_ENABLED: 'true' }), true);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'production', ATTENDANCE_API_PRODUCTION_ENABLED: 'false', SELF_HOSTED_ATTENDANCE_API_ENABLED: 'true', NODE_ENV: 'production' }), false);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'preview', ATTENDANCE_API_PREVIEW_ENABLED: 'true', NODE_ENV: 'production' }), true);
  assert.equal(attendanceApiEnabled({ VERCEL_ENV: 'preview', SELF_HOSTED_ATTENDANCE_API_ENABLED: 'true' }), false);
});

test('UAT-only Attendance routes remain closed on self-hosted production', () => {
  const environment = { ...selfHosted, SELF_HOSTED_ATTENDANCE_API_ENABLED: 'true', G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED: 'true', G06_GEOFENCE_ONLY_UAT_ENABLED: 'true' };
  assert.equal(attendanceFaceChallengeUatEnabled(environment), false);
  assert.equal(attendanceGeofenceOnlyUatEnabled(environment), false);
  assert.equal(attendanceBiometricRuntimeEnabled(environment), false);
});

test('environment contract and example document the non-secret flag', () => {
  const fs = require('node:fs');
  const contract = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../config/environment-contract.json'), 'utf8'));
  const variable = contract.variables.SELF_HOSTED_ATTENDANCE_API_ENABLED;
  assert.equal(variable.default, 'false');
  assert.equal(variable.sensitive, false);
  assert.match(fs.readFileSync(require('node:path').join(__dirname, '../.env.example'), 'utf8'), /SELF_HOSTED_ATTENDANCE_API_ENABLED=false/);
});
