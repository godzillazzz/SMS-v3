'use strict';

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSelfHostedFaceVerificationService } = require('../src/services/face-verification-self-hosted.service');
const { deriveActiveFaceChallenge } = require('../src/services/active-face-challenge.service');
const { createNoopAttendanceFaceEvidenceStorage } = require('../src/services/attendance-face-evidence-storage.service');

const sessionId = '33333333-3333-4333-8333-333333333333';

function jpeg(size = 256, fill = 7) {
  const buffer = Buffer.alloc(size, fill);
  buffer[0] = 0xff; buffer[1] = 0xd8; buffer[2] = 0xff;
  return buffer;
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function context({ providerFails = false, activeChallengePassed = true, faceMatchPassed = true, evidenceStorage = null } = {}) {
  const referenceBytes = jpeg(320, 9);
  const liveBytes = jpeg(256, 5);
  const challengeFrames = [jpeg(180, 1), jpeg(181, 2), jpeg(182, 3), jpeg(183, 4)];
  const referenceChecksum = sha256(referenceBytes);
  const calls = [];
  const prisma = {
    faceVerificationSession: {
      async findUnique() {
        return {
          id: sessionId, userId: 'user-1', employeeId: 'employee-1', referencePhotoId: 'reference-1',
          referencePhotoChecksum: referenceChecksum, status: 'DEVICE_PROOF_VERIFIED', expiresAt: new Date('2099-01-01T00:00:00Z')
        };
      }
    },
    employeeReferencePhoto: {
      async findUnique() {
        return {
          id: 'reference-1', status: 'ACTIVE', checksum: referenceChecksum, mimeType: 'image/jpeg',
          storageObjectKey: 'reference/private.jpg', storageDeletedAt: null, storageDeletionRequestedAt: null
        };
      }
    }
  };
  const sessionService = {
    async bindProviderSession(input) { calls.push(['bind', input]); return { id: input.sessionId }; },
    async recordTrustedFaceMatchOnlyResult(input) {
      calls.push(['record', input]);
      const passed = input.activeChallengePassed === true && input.faceMatchPassed === true;
      return { session: { id: input.sessionId, status: passed ? 'VERIFIED' : 'FAILED', failureCode: passed ? null : input.activeChallengePassed ? 'FACE_MATCH_FAILED' : 'ACTIVE_CHALLENGE_FAILED' }, receipt: passed ? 'opaque-receipt' : null, receiptExpiresAt: passed ? new Date('2099-01-01T00:00:00Z') : null };
    },
    async failSession(id, code) { calls.push(['fail', { sessionId: id, code }]); }
  };
  const provider = {
    async evaluate(input) {
      calls.push(['provider', {
        providerSessionRef: input.providerSessionRef,
        activeChallenge: input.activeChallenge,
        challengeLengths: input.challengeFrameBytes.map((frame) => frame.length),
        liveLength: input.livePhotoBytes.length,
        referenceLength: input.referencePhotoBytes.length
      }]);
      if (providerFails) { const error = new Error('upstream failed'); error.details = { code: 'VERIFICATION_PROVIDER_UNAVAILABLE' }; throw error; }
      return { activeChallengePassed, faceMatchPassed, resultCode: activeChallengePassed ? (faceMatchPassed ? 'MATCH' : 'NO_MATCH') : 'ACTIVE_CHALLENGE_FAILED', policyProfileId: 'FACE_MATCH_ONLY_ACTIVE_CHALLENGE_V1', engineVersion: 'self-hosted-test-1' };
    }
  };
  const referenceStorage = { async getBytes() { return referenceBytes; } };
  const service = createSelfHostedFaceVerificationService({
    prisma,
    sessionService,
    provider,
    referenceStorage,
    evidenceStorage: evidenceStorage || createNoopAttendanceFaceEvidenceStorage(),
    randomUUID: () => 'provider-session-ref-1'
  });
  const files = challengeFrames.map((buffer) => ({ buffer, mimetype: 'image/jpeg' }));
  return { service, liveBytes, challengeFrames, challengeFrameFiles: files, referenceBytes, calls };
}

async function verify(c) {
  return c.service.verifyFaceMatch({
    actor: { sub: 'user-1', role: 'VIEWER' },
    sessionId,
    livePhotoFile: { buffer: c.liveBytes, mimetype: 'image/jpeg' },
    challengeFrameFiles: c.challengeFrameFiles
  });
}

test('self-hosted orchestration derives the server challenge, requires trusted challenge + face match, and stores no live image by default', async () => {
  const c = context();
  const result = await verify(c);
  assert.equal(result.verificationMode, 'FACE_MATCH_ONLY');
  assert.equal(result.evidence.storageStatus, 'NOT_STORED');
  assert.equal(result.evidence.stored, false);
  assert.equal(result.receipt, 'opaque-receipt');
  assert.equal('faceMatchPassed' in result, false, 'provider booleans must not escape this service response');
  const providerCall = c.calls.find(([name]) => name === 'provider')[1];
  assert.deepEqual(providerCall.activeChallenge, deriveActiveFaceChallenge(sessionId));
  assert.deepEqual(providerCall.challengeLengths, [180, 181, 182, 183]);
  const record = c.calls.find(([name]) => name === 'record')[1];
  assert.equal(record.activeChallengePassed, true);
  assert.equal(record.faceMatchPassed, true);
  assert.equal('padPassed' in record, false);
  assert.ok(c.liveBytes.every((value) => value === 0));
  assert.ok(c.challengeFrames.every((frame) => frame.every((value) => value === 0)));
  assert.ok(c.referenceBytes.every((value) => value === 0));
});

test('failed active challenge mints no receipt and is never sent to the future evidence storage hook', async () => {
  let storeCalls = 0;
  const c = context({
    activeChallengePassed: false,
    faceMatchPassed: true,
    evidenceStorage: { async store() { storeCalls += 1; return { storageStatus: 'STORED' }; }, async remove() {} }
  });
  const result = await verify(c);
  assert.equal(result.receipt, null);
  assert.equal(result.session.failureCode, 'ACTIVE_CHALLENGE_FAILED');
  assert.equal(result.evidence.storageStatus, 'NOT_STORED');
  assert.equal(storeCalls, 0);
});

test('face mismatch remains distinct after active challenge passes and is not stored', async () => {
  let storeCalls = 0;
  const c = context({
    activeChallengePassed: true,
    faceMatchPassed: false,
    evidenceStorage: { async store() { storeCalls += 1; return { storageStatus: 'STORED' }; }, async remove() {} }
  });
  const result = await verify(c);
  assert.equal(result.receipt, null);
  assert.equal(result.session.failureCode, 'FACE_MATCH_FAILED');
  assert.equal(storeCalls, 0);
});

test('provider failure fails the verification session and still purges every transient image buffer', async () => {
  const c = context({ providerFails: true });
  await assert.rejects(() => verify(c));
  const failed = c.calls.find(([name]) => name === 'fail');
  assert.deepEqual(failed[1], { sessionId, code: 'VERIFICATION_PROVIDER_UNAVAILABLE' });
  assert.ok(c.liveBytes.every((value) => value === 0));
  assert.ok(c.challengeFrames.every((frame) => frame.every((value) => value === 0)));
  assert.ok(c.referenceBytes.every((value) => value === 0));
});
