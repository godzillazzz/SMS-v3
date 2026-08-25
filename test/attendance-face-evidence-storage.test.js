'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EVIDENCE_STORAGE_STATUS,
  createNoopAttendanceFaceEvidenceStorage,
  assertAttendanceFaceEvidenceStorage
} = require('../src/services/attendance-face-evidence-storage.service');

test('default Attendance face evidence storage is an explicit no-op and keeps no object reference', async () => {
  const storage = createNoopAttendanceFaceEvidenceStorage();
  const bytes = Buffer.from('transient-live-photo-bytes');
  const before = Buffer.from(bytes);
  const result = await storage.store({
    livePhotoBytes: bytes,
    mimeType: 'image/jpeg',
    capturedAt: new Date('2026-08-25T00:00:00.000Z'),
    verificationPassed: true
  });
  assert.equal(storage.provider, 'none');
  assert.equal(storage.storesBytes, false);
  assert.equal(result.storageStatus, EVIDENCE_STORAGE_STATUS.NOT_STORED);
  assert.equal(result.storageProvider, 'none');
  assert.equal(result.objectRef, null);
  assert.equal(result.retentionUntil, null);
  assert.equal(result.purgedAt, null);
  assert.equal(result.verificationPassed, true);
  assert.equal(result.checksum.length, 64);
  assert.deepEqual(bytes, before, 'no-op adapter must not mutate the caller buffer');
});

test('storage abstraction requires only store/remove so a future private-server adapter can be swapped in', () => {
  const adapter = { async store() {}, async remove() {} };
  assert.equal(assertAttendanceFaceEvidenceStorage(adapter), adapter);
  assert.throws(() => assertAttendanceFaceEvidenceStorage({ async store() {} }), /store\(\) and remove\(\)/);
});
