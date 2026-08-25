'use strict';

const crypto = require('node:crypto');

const EVIDENCE_STORAGE_STATUS = Object.freeze({
  NOT_STORED: 'NOT_STORED',
  STORED: 'STORED',
  PURGED: 'PURGED'
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeEvidenceMetadata({ livePhotoBytes, mimeType = 'image/jpeg', capturedAt = new Date(), verificationPassed = false } = {}) {
  const bytes = Buffer.isBuffer(livePhotoBytes) ? livePhotoBytes : Buffer.alloc(0);
  return Object.freeze({
    storageStatus: EVIDENCE_STORAGE_STATUS.NOT_STORED,
    storageProvider: 'none',
    objectRef: null,
    mimeType,
    sizeBytes: bytes.length,
    checksum: bytes.length ? sha256(bytes) : null,
    capturedAt: capturedAt instanceof Date ? capturedAt : new Date(capturedAt),
    retentionUntil: null,
    purgedAt: null,
    verificationPassed: verificationPassed === true
  });
}

function createNoopAttendanceFaceEvidenceStorage() {
  return Object.freeze({
    provider: 'none',
    storesBytes: false,
    async store(input) {
      return safeEvidenceMetadata(input);
    },
    async remove() {
      return Object.freeze({ storageStatus: EVIDENCE_STORAGE_STATUS.NOT_STORED, purgedAt: null });
    }
  });
}

function assertAttendanceFaceEvidenceStorage(storage) {
  if (!storage || typeof storage.store !== 'function' || typeof storage.remove !== 'function') {
    throw new TypeError('Attendance face evidence storage adapter must implement store() and remove().');
  }
  return storage;
}

module.exports = {
  EVIDENCE_STORAGE_STATUS,
  safeEvidenceMetadata,
  createNoopAttendanceFaceEvidenceStorage,
  assertAttendanceFaceEvidenceStorage
};
