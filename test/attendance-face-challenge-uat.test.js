'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const HttpError = require('../src/utils/http-error');
const { errorHandler } = require('../src/middlewares/error-handler');
const {
  createAttendanceRoutes,
  attendanceFaceChallengeUatEnabled
} = require('../src/routes/attendance.routes');
const { createAttendanceFaceChallengeUatService } = require('../src/services/attendance-face-challenge-uat.service');
const { validJpegFixture } = require('./support/valid-jpeg-fixture');

function fakeAuth(req, _res, next) {
  if (req.headers.authorization !== 'Bearer uat-test') return next(new HttpError(401, 'Authentication required.'));
  req.user = { sub: 'uat-user', role: 'VIEWER' };
  return next();
}

function appFor(environment) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/attendance', createAttendanceRoutes({
    environment,
    authenticateMiddleware: fakeAuth,
    contractService: {
      async assessReadiness() { throw new Error('normal Attendance runtime must remain closed in UAT-only tests'); },
      async beginVerification() { throw new Error('normal Attendance runtime must remain closed in UAT-only tests'); },
      async verifyDeviceProof() { throw new Error('normal Attendance runtime must remain closed in UAT-only tests'); },
      async verifyLiveFace() { throw new Error('normal Attendance runtime must remain closed in UAT-only tests'); },
      async acceptVerifiedEvent() { throw new Error('normal Attendance runtime must remain closed in UAT-only tests'); }
    }
  }));
  app.use(errorHandler);
  return app;
}

function jpeg() {
  return validJpegFixture();
}

function attachCapture(req, photo = jpeg()) {
  let next = req.attach('photo', photo, { filename: 'live.jpg', contentType: 'image/jpeg' });
  for (let index = 0; index < 4; index += 1) {
    next = next.attach('challengeFrame', jpeg(0x40 + index), { filename: `challenge-${index + 1}.jpg`, contentType: 'image/jpeg' });
  }
  return next;
}

test('Face Challenge UAT gate is Preview-only and independent from normal Attendance runtime', async () => {
  assert.equal(attendanceFaceChallengeUatEnabled({ VERCEL_ENV: 'production', G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(attendanceFaceChallengeUatEnabled({ VERCEL_ENV: 'preview' }), false);
  assert.equal(attendanceFaceChallengeUatEnabled({ VERCEL_ENV: 'preview', G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED: 'true' }), true);

  const app = appFor({ VERCEL_ENV: 'preview', G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED: 'true' });
  const normalAttendance = await request(app).post('/api/v1/attendance/readiness')
    .set('Authorization', 'Bearer uat-test')
    .send({});
  assert.equal(normalAttendance.status, 404, 'UAT-only flag must not open normal Attendance API');

  const production = appFor({ VERCEL_ENV: 'production', G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED: 'true', ATTENDANCE_API_PREVIEW_ENABLED: 'true' });
  const hidden = await request(production).post('/api/v1/attendance/uat/face-challenge/start')
    .set('Authorization', 'Bearer uat-test')
    .send({});
  assert.equal(hidden.status, 404);
});

test('Preview UAT start is authenticated and returns only non-authoritative rehearsal state', async () => {
  const app = appFor({ VERCEL_ENV: 'preview', G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED: 'true' });
  const denied = await request(app).post('/api/v1/attendance/uat/face-challenge/start').send({});
  assert.equal(denied.status, 401);

  const started = await request(app).post('/api/v1/attendance/uat/face-challenge/start')
    .set('Authorization', 'Bearer uat-test')
    .send({});
  assert.equal(started.status, 201);
  assert.match(started.body.data.attemptId, /^[0-9a-f-]{36}$/i);
  assert.equal(started.body.data.activeChallenge.version, 'ACTIVE_FACE_CHALLENGE_V1');
  assert.equal(started.body.data.activeChallenge.frameCount, 4);
  assert.ok(['TURN_LEFT', 'TURN_RIGHT', 'LOOK_UP', 'LOOK_DOWN'].includes(started.body.data.activeChallenge.code));
  assert.equal(started.body.data.uatOnly, true);
  assert.equal(started.body.data.verifierCalled, false);
  assert.equal(started.body.data.verificationAccepted, false);
  assert.equal(started.body.data.attendanceAccepted, false);
  assert.equal(started.body.data.retained, false);
  assert.equal(Object.prototype.hasOwnProperty.call(started.body.data, 'receipt'), false);
});

test('Preview UAT capture accepts exactly four transient JPEG frames plus final still and can never issue Attendance authority', async () => {
  const app = appFor({ VERCEL_ENV: 'preview', G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED: 'true' });
  const started = await request(app).post('/api/v1/attendance/uat/face-challenge/start')
    .set('Authorization', 'Bearer uat-test')
    .send({});
  const attemptId = started.body.data.attemptId;

  const accepted = await attachCapture(
    request(app).post(`/api/v1/attendance/uat/face-challenge/${attemptId}/capture`).set('Authorization', 'Bearer uat-test')
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.captureReceived, true);
  assert.equal(accepted.body.data.verifierCalled, false);
  assert.equal(accepted.body.data.verificationAccepted, false);
  assert.equal(accepted.body.data.attendanceAccepted, false);
  assert.equal(accepted.body.data.receipt, null);
  assert.equal(accepted.body.data.retained, false);

  const incomplete = await request(app).post(`/api/v1/attendance/uat/face-challenge/${attemptId}/capture`)
    .set('Authorization', 'Bearer uat-test')
    .attach('photo', jpeg(), { filename: 'live.jpg', contentType: 'image/jpeg' })
    .attach('challengeFrame', jpeg(), { filename: 'one.jpg', contentType: 'image/jpeg' });
  assert.equal(incomplete.status, 400);

  let injected = request(app).post(`/api/v1/attendance/uat/face-challenge/${attemptId}/capture`)
    .set('Authorization', 'Bearer uat-test')
    .field('verificationAccepted', 'true')
    .attach('photo', jpeg(), { filename: 'live.jpg', contentType: 'image/jpeg' });
  for (let index = 0; index < 4; index += 1) injected = injected.attach('challengeFrame', jpeg(), { filename: `injected-${index}.jpg`, contentType: 'image/jpeg' });
  const rejected = await injected;
  assert.equal(rejected.status, 400);
});

test('UAT service zeroes transient image buffers after both success and validation failure', () => {
  const service = createAttendanceFaceChallengeUatService();
  const attemptId = service.start().attemptId;
  const photo = { mimetype: 'image/jpeg', buffer: jpeg(0x55) };
  const frames = [0, 1, 2, 3].map((index) => ({ mimetype: 'image/jpeg', buffer: jpeg(0x60 + index) }));
  const result = service.acceptCapture({ attemptId, livePhotoFile: photo, challengeFrameFiles: frames });
  assert.equal(result.attendanceAccepted, false);
  assert.equal(result.verificationAccepted, false);
  assert.equal(result.verifierCalled, false);
  assert.equal(result.retained, false);
  for (const file of [photo, ...frames]) assert.equal(file.buffer.every((value) => value === 0), true);

  const badPhoto = { mimetype: 'image/png', buffer: Buffer.alloc(128, 0x77) };
  const badFrames = [0, 1, 2, 3].map(() => ({ mimetype: 'image/jpeg', buffer: Buffer.alloc(128, 0x78) }));
  assert.throws(() => service.acceptCapture({ attemptId, livePhotoFile: badPhoto, challengeFrameFiles: badFrames }), /must be JPEG/);
  for (const file of [badPhoto, ...badFrames]) assert.equal(file.buffer.every((value) => value === 0), true);
});
