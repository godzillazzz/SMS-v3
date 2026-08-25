'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_ATTENDANCE_LIVE_PHOTO_SIZE,
  safeDeviceProof,
  safeFaceVerification,
  createAttendanceFaceVerificationService
} = require('../src/services/attendance-face-verification.service');

const actor = { sub: '11111111-1111-4111-8111-111111111111', role: 'VIEWER' };
const sessionId = '22222222-2222-4222-8222-222222222222';

test('Attendance face adapter keeps the browser-facing contract provider-neutral', () => {
  assert.equal(MAX_ATTENDANCE_LIVE_PHOTO_SIZE, 2 * 1024 * 1024);
  assert.deepEqual(safeDeviceProof({ status: 'DEVICE_PROOF_VERIFIED', provider: 'secret' }, sessionId), {
    verificationReady: true,
    sessionId,
    status: 'DEVICE_PROOF_VERIFIED'
  });
  assert.deepEqual(safeFaceVerification({
    faceMatchPassed: true,
    receipt: 'opaque-receipt',
    receiptExpiresAt: 'soon',
    provider: 'secret-provider',
    evidence: { storageStatus: 'NOT_STORED', stored: false }
  }), {
    verificationAccepted: true,
    receipt: 'opaque-receipt',
    receiptExpiresAt: 'soon',
    evidence: { storageStatus: 'NOT_STORED', stored: false }
  });
});

test('Attendance face adapter never issues a browser receipt when trusted match did not pass', () => {
  assert.deepEqual(safeFaceVerification({
    faceMatchPassed: false,
    receipt: 'must-not-leak',
    evidence: { storageStatus: 'NOT_STORED' }
  }), {
    verificationAccepted: false,
    receipt: null,
    receiptExpiresAt: null,
    evidence: { storageStatus: 'NOT_STORED', stored: false }
  });
});

test('Attendance face adapter delegates device proof and live image only to trusted server services', async () => {
  const calls = [];
  const service = createAttendanceFaceVerificationService({
    sessionService: {
      verifyDeviceProof: async (input) => {
        calls.push(['device', input]);
        return { status: 'DEVICE_PROOF_VERIFIED', faceMatchPassed: true };
      }
    },
    faceVerificationService: {
      verifyFaceMatch: async (input) => {
        calls.push(['face', input]);
        return {
          faceMatchPassed: true,
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
  const face = await service.verifyLiveFace({ actor, sessionId, livePhotoFile });

  assert.equal(device.verificationReady, true);
  assert.equal(face.verificationAccepted, true);
  assert.equal(face.receipt, 'server-issued-receipt');
  assert.equal(Object.prototype.hasOwnProperty.call(face, 'faceMatchPassed'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(face, 'provider'), false);
  assert.deepEqual(calls[0], ['device', { actor, sessionId, challengeId: 'c', challenge: 'challenge', signatureBase64: 'sig' }]);
  assert.equal(calls[1][0], 'face');
  assert.equal(calls[1][1].livePhotoFile, livePhotoFile);
});
