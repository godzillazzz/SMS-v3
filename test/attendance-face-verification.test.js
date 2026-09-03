'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_ATTENDANCE_LIVE_PHOTO_SIZE,
  safeDeviceProof,
  safeFaceVerification,
  safeRetryHint,
  createAttendanceFaceVerificationService
} = require('../src/services/attendance-face-verification.service');

const actor = { sub: '11111111-1111-4111-8111-111111111111', role: 'VIEWER' };
const sessionId = '22222222-2222-4222-8222-222222222222';

test('Attendance face adapter keeps the browser-facing contract provider-neutral', () => {
  assert.equal(MAX_ATTENDANCE_LIVE_PHOTO_SIZE, 1024 * 1024);
  assert.deepEqual(safeDeviceProof({ status: 'DEVICE_PROOF_VERIFIED', provider: 'secret' }, sessionId), {
    verificationReady: true,
    sessionId,
    status: 'DEVICE_PROOF_VERIFIED'
  });
  assert.deepEqual(safeFaceVerification({
    verificationAccepted: true,
    receipt: 'opaque-receipt',
    receiptExpiresAt: 'soon',
    provider: 'secret-provider',
    evidence: { storageStatus: 'NOT_STORED', stored: false }
  }), {
    verificationAccepted: true,
    receipt: 'opaque-receipt',
    receiptExpiresAt: 'soon',
    retryHint: null,
    evidence: { storageStatus: 'NOT_STORED', stored: false }
  });
  assert.equal(safeRetryHint('MOVE_MORE'), 'MOVE_MORE');
  assert.equal(safeRetryHint('UNTRUSTED_VALUE'), null);
});

test('Attendance face adapter never issues a browser receipt when trusted service did not accept challenge + face verification', () => {
  assert.deepEqual(safeFaceVerification({
    verificationAccepted: false,
    receipt: 'must-not-leak',
    retryHint: 'KEEP_FACE_VISIBLE',
    evidence: { storageStatus: 'NOT_STORED' },
    session: { failureCode: 'ACTIVE_CHALLENGE_FAILED' }
  }), {
    verificationAccepted: false,
    receipt: null,
    receiptExpiresAt: null,
    retryHint: 'KEEP_FACE_VISIBLE',
    evidence: { storageStatus: 'NOT_STORED', stored: false }
  });
});

test('Attendance face adapter delegates device proof, live image and challenge frames only to trusted server services', async () => {
  const calls = [];
  const service = createAttendanceFaceVerificationService({
    sessionService: {
      verifyDeviceProof: async (input) => {
        calls.push(['device', input]);
        return { status: 'DEVICE_PROOF_VERIFIED', provider: 'must-not-escape' };
      }
    },
    faceVerificationService: {
      verifyFaceMatch: async (input) => {
        calls.push(['face', input]);
        return {
          verificationAccepted: true,
          receipt: 'server-issued-receipt',
          receiptExpiresAt: '2026-08-25T02:00:00.000Z',
          evidence: { storageStatus: 'NOT_STORED', stored: false },
          provider: 'internal-only'
        };
      }
    }
  });
  const device = await service.verifyDeviceProof({ actor, sessionId, challengeId: 'c', challenge: 'challenge', signatureBase64: 'sig' });
  const livePhotoFile = { buffer: Buffer.from('temporary-live-photo'), mimetype: 'image/jpeg' };
  const challengeFrameFiles = [1, 2, 3, 4].map((value) => ({ buffer: Buffer.from(`frame-${value}`), mimetype: 'image/jpeg' }));
  const face = await service.verifyLiveFace({ actor, sessionId, livePhotoFile, challengeFrameFiles });

  assert.equal(device.verificationReady, true);
  assert.equal(face.verificationAccepted, true);
  assert.equal(face.receipt, 'server-issued-receipt');
  assert.equal(Object.prototype.hasOwnProperty.call(face, 'faceMatchPassed'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(face, 'activeChallengePassed'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(face, 'provider'), false);
  assert.deepEqual(calls[0], ['device', { actor, sessionId, challengeId: 'c', challenge: 'challenge', signatureBase64: 'sig' }]);
  assert.equal(calls[1][0], 'face');
  assert.equal(calls[1][1].livePhotoFile, livePhotoFile);
  assert.equal(calls[1][1].challengeFrameFiles, challengeFrameFiles);
});
