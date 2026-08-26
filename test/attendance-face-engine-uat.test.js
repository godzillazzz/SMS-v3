'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const { errorHandler } = require('../src/middlewares/error-handler');
const {
  createAttendanceRoutes,
  attendanceFaceEngineUatEnabled
} = require('../src/routes/attendance.routes');
const { createAttendanceFaceEngineUatService } = require('../src/services/attendance-face-engine-uat.service');

function jpeg(byte = 0x31) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(256, byte)]);
}

function contractStub() {
  const closed = async () => { throw new Error('normal Attendance runtime must not execute in face-engine UAT tests'); };
  return {
    assessReadiness: closed,
    beginVerification: closed,
    verifyDeviceProof: closed,
    verifyLiveFace: closed,
    acceptVerifiedEvent: closed
  };
}

function appFor(environment, faceEngineUatService) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/attendance', createAttendanceRoutes({
    environment,
    authenticateMiddleware: (_req, _res, next) => next(new Error('application auth must not be required by the Vercel-protected engine probe')),
    contractService: contractStub(),
    faceEngineUatService,
    faceChallengeUatService: { start() { throw new Error('unrelated UAT service'); }, acceptCapture() { throw new Error('unrelated UAT service'); } }
  }));
  app.use(errorHandler);
  return app;
}

test('face-engine UAT probe is Preview-only and requires the real in-process runtime gate', async () => {
  assert.equal(attendanceFaceEngineUatEnabled({ VERCEL_ENV: 'production', G06_FACE_ENGINE_UAT_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' }), false);
  assert.equal(attendanceFaceEngineUatEnabled({ VERCEL_ENV: 'preview', G06_FACE_ENGINE_UAT_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(attendanceFaceEngineUatEnabled({ VERCEL_ENV: 'preview', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' }), false);
  assert.equal(attendanceFaceEngineUatEnabled({ VERCEL_ENV: 'preview', G06_FACE_ENGINE_UAT_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' }), true);

  const hidden = appFor(
    { VERCEL_ENV: 'production', G06_FACE_ENGINE_UAT_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' },
    { async probe() { throw new Error('Production must never invoke probe'); } }
  );
  const response = await request(hidden)
    .post('/api/v1/attendance/uat/in-process-face-engine/probe')
    .attach('photo', jpeg(), { filename: 'probe.jpg', contentType: 'image/jpeg' });
  assert.equal(response.status, 404);
});

test('Preview face-engine probe accepts exactly one transient image and returns only narrow technical status', async () => {
  const calls = [];
  const app = appFor(
    { VERCEL_ENV: 'preview', G06_FACE_ENGINE_UAT_PREVIEW_ENABLED: 'true', FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' },
    {
      async probe(input) {
        calls.push(input);
        return { uatOnly: true, engineReady: true, inferenceCompleted: true, staticChallengeRejected: true, resultCode: 'ACTIVE_CHALLENGE_FAILED', elapsedMs: 1234 };
      }
    }
  );

  const accepted = await request(app)
    .post('/api/v1/attendance/uat/in-process-face-engine/probe')
    .attach('photo', jpeg(), { filename: 'probe.jpg', contentType: 'image/jpeg' });
  assert.equal(accepted.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(Buffer.isBuffer(calls[0].photoFile.buffer), true);
  assert.deepEqual(accepted.body.data, {
    uatOnly: true,
    engineReady: true,
    inferenceCompleted: true,
    staticChallengeRejected: true,
    resultCode: 'ACTIVE_CHALLENGE_FAILED',
    elapsedMs: 1234
  });
  for (const forbidden of ['embedding', 'similarity', 'pose', 'faceMatchPassed', 'activeChallengePassed', 'receipt']) {
    assert.equal(Object.prototype.hasOwnProperty.call(accepted.body.data, forbidden), false);
  }

  const injected = await request(app)
    .post('/api/v1/attendance/uat/in-process-face-engine/probe')
    .field('verificationAccepted', 'true')
    .attach('photo', jpeg(), { filename: 'probe.jpg', contentType: 'image/jpeg' });
  assert.equal(injected.status, 400);
});

test('face-engine UAT service runs the production provider path and always zeroes the uploaded buffer', async () => {
  const observed = [];
  const provider = {
    async evaluate(input) {
      observed.push({
        providerSessionRef: input.providerSessionRef,
        activeChallenge: input.activeChallenge,
        frameCount: input.challengeFrameBytes.length,
        sameLiveReferenceBuffer: input.livePhotoBytes === input.referencePhotoBytes,
        sameChallengeBuffers: input.challengeFrameBytes.every((buffer) => buffer === input.livePhotoBytes)
      });
      return {
        activeChallengePassed: false,
        faceMatchPassed: false,
        resultCode: 'ACTIVE_CHALLENGE_FAILED',
        similarity: 0.999,
        embedding: [1, 2, 3]
      };
    }
  };
  const ticks = [1_000_000n, 4_600_000n];
  const service = createAttendanceFaceEngineUatService({
    environment: { FACE_VERIFICATION_IN_PROCESS_ENABLED: 'true' },
    provider,
    randomUUID: () => 'probe-ref',
    nowNs: () => ticks.shift()
  });
  const buffer = jpeg(0x66);
  const result = await service.probe({ photoFile: { buffer, mimetype: 'image/jpeg' } });

  assert.deepEqual(observed, [{
    providerSessionRef: 'uat-probe-ref',
    activeChallenge: { version: 'ACTIVE_FACE_CHALLENGE_V1', code: 'TURN_LEFT', frameCount: 4 },
    frameCount: 4,
    sameLiveReferenceBuffer: true,
    sameChallengeBuffers: true
  }]);
  assert.deepEqual(result, {
    uatOnly: true,
    engineReady: true,
    inferenceCompleted: true,
    staticChallengeRejected: true,
    resultCode: 'ACTIVE_CHALLENGE_FAILED',
    elapsedMs: 4
  });
  assert.equal(buffer.every((value) => value === 0), true);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'similarity'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'embedding'), false);
});
