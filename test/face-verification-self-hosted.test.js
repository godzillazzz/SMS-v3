'use strict';

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSelfHostedFaceVerificationService } = require('../src/services/face-verification-self-hosted.service');
const { createNoopAttendanceFaceEvidenceStorage } = require('../src/services/attendance-face-evidence-storage.service');

function jpeg(size = 256, fill = 7) {
  const buffer = Buffer.alloc(size, fill);
  buffer[0] = 0xff; buffer[1] = 0xd8; buffer[2] = 0xff;
  return buffer;
}
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function context({ providerFails = false, faceMatchPassed = true, evidenceStorage = null } = {}) {
  const referenceBytes = jpeg(320, 9);
  const liveBytes = jpeg(256, 5);
  const referenceChecksum = sha256(referenceBytes);
  const calls = [];
  const prisma = {
    faceVerificationSession: {
      async findUnique() {
        return {
          id: 'session-1', userId: 'user-1', employeeId: 'employee-1', referencePhotoId: 'reference-1',
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
    async recordTrustedFaceMatchOnlyResult(input) { calls.push(['record', input]); return { session: { id: input.sessionId, status: input.faceMatchPassed ? 'VERIFIED' : 'FAILED' }, receipt: input.faceMatchPassed ? 'opaque-receipt' : null, receiptExpiresAt: input.faceMatchPassed ? new Date('2099-01-01T00:00:00Z') : null }; },
    async failSession(sessionId, code) { calls.push(['fail', { sessionId, code }]); }
  };
  const provider = {
    async evaluate(input) {
      calls.push(['provider', { providerSessionRef: input.providerSessionRef, liveLength: input.livePhotoBytes.length, referenceLength: input.referencePhotoBytes.length }]);
      if (providerFails) { const error = new Error('upstream failed'); error.details = { code: 'VERIFICATION_PROVIDER_UNAVAILABLE' }; throw error; }
      return { faceMatchPassed, resultCode: faceMatchPassed ? 'MATCH' : 'NO_MATCH', policyProfileId: 'FACE_MATCH_ONLY_V1', engineVersion: 'self-hosted-test-1' };
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
  return { service, liveBytes, referenceBytes, calls };
}

test('self-hosted orchestration binds FACE_MATCH_ONLY, stores no live image by default and accepts only server provider result', async () => {
  const c = context();
  const result = await c.service.verifyFaceMatch({
    actor: { sub: 'user-1', role: 'VIEWER' },
    sessionId: 'session-1',
    livePhotoFile: { buffer: c.liveBytes, mimetype: 'image/jpeg' }
  });
  assert.equal(result.verificationMode, 'FACE_MATCH_ONLY');
  assert.equal(result.faceMatchPassed, true);
  assert.equal(result.evidence.storageStatus, 'NOT_STORED');
  assert.equal(result.evidence.stored, false);
  assert.equal(result.receipt, 'opaque-receipt');
  const bind = c.calls.find(([name]) => name === 'bind')[1];
  assert.equal(bind.provider, 'SELF_HOSTED_FACE_MATCH_V1');
  assert.equal(bind.verificationMode, 'FACE_MATCH_ONLY');
  const record = c.calls.find(([name]) => name === 'record')[1];
  assert.equal(record.faceMatchPassed, true);
  assert.equal('padPassed' in record, false);
  assert.ok(c.liveBytes.every((value) => value === 0), 'live image buffer must be purged from request memory after processing');
  assert.ok(c.referenceBytes.every((value) => value === 0), 'reference image buffer copy must be purged from process memory after processing');
});

test('non-matching faces are never sent to the future evidence storage hook', async () => {
  let storeCalls = 0;
  const c = context({
    faceMatchPassed: false,
    evidenceStorage: {
      async store() { storeCalls += 1; return { storageStatus: 'STORED' }; },
      async remove() {}
    }
  });
  const result = await c.service.verifyFaceMatch({
    actor: { sub: 'user-1', role: 'VIEWER' },
    sessionId: 'session-1',
    livePhotoFile: { buffer: c.liveBytes, mimetype: 'image/jpeg' }
  });
  assert.equal(result.faceMatchPassed, false);
  assert.equal(result.receipt, null);
  assert.equal(result.evidence.storageStatus, 'NOT_STORED');
  assert.equal(storeCalls, 0);
});

test('provider failure fails the verification session and still purges transient image buffers', async () => {
  const c = context({ providerFails: true });
  await assert.rejects(() => c.service.verifyFaceMatch({
    actor: { sub: 'user-1', role: 'VIEWER' },
    sessionId: 'session-1',
    livePhotoFile: { buffer: c.liveBytes, mimetype: 'image/jpeg' }
  }));
  const failed = c.calls.find(([name]) => name === 'fail');
  assert.deepEqual(failed[1], { sessionId: 'session-1', code: 'VERIFICATION_PROVIDER_UNAVAILABLE' });
  assert.ok(c.liveBytes.every((value) => value === 0));
  assert.ok(c.referenceBytes.every((value) => value === 0));
});
