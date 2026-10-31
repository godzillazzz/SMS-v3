'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { migrateLicenseDocuments, TARGET_BUCKET, TARGET_PROVIDER } = require('../scripts/storage/migrate-license-documents-to-minio');

test('migrateLicenseDocuments constants and behavior', async () => {
  assert.equal(TARGET_BUCKET, 'smsv3-license-documents');
  assert.equal(TARGET_PROVIDER, 's3');
});

test('migrateLicenseDocuments dry-run does not write database or S3', async () => {
  const fakeBytes = Buffer.from('PDF_CONTENT_TEST');
  const fakeRow = {
    id: 'doc-1',
    storageProvider: 'supabase',
    storageBucket: 'sms-v3-license-documents',
    storageObjectKey: 'licenses/emp-1/file-1.pdf',
    fileSize: fakeBytes.length,
    storageDeletedAt: null
  };

  let updateCalled = false;
  const mockPrisma = {
    employeeLicenseDocument: {
      findMany: async () => [fakeRow],
      update: async () => { updateCalled = true; }
    }
  };

  const fakeResolver = {
    read: async () => ({
      bytes: fakeBytes,
      mimeType: 'application/pdf',
      sizeBytes: fakeBytes.length
    })
  };

  // Run dry run
  const summary = await migrateLicenseDocuments({
    prisma: mockPrisma,
    dryRun: true,
    readResolverClient: fakeResolver
  });

  assert.equal(updateCalled, false);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.total, 1);
  assert.equal(summary.verified, 1);
  assert.equal(summary.failed, 0);
});

test('migrateLicenseDocuments fails and aborts row update when checksum fails', async () => {
  const fakeBytes = Buffer.from('PDF_CONTENT_TEST');
  const fakeRow = {
    id: 'doc-1',
    storageProvider: 'supabase',
    storageBucket: 'sms-v3-license-documents',
    storageObjectKey: 'licenses/emp-1/file-1.pdf',
    fileSize: fakeBytes.length,
    storageDeletedAt: null
  };

  let updateCalled = false;
  const mockPrisma = {
    employeeLicenseDocument: {
      findMany: async () => [fakeRow],
      update: async () => { updateCalled = true; }
    }
  };

  const mockS3 = {
    put: async () => {}
  };

  let readCount = 0;
  const corruptedResolver = {
    read: async () => {
      readCount += 1;
      return {
        bytes: readCount === 1 ? fakeBytes : Buffer.from('CORRUPTED_BYTES'),
        mimeType: 'application/pdf',
        sizeBytes: fakeBytes.length
      };
    }
  };

  const summary = await migrateLicenseDocuments({
    prisma: mockPrisma,
    dryRun: false,
    s3Client: mockS3,
    readResolverClient: corruptedResolver
  });

  assert.equal(updateCalled, false);
  assert.equal(summary.failed, 1);
  assert.equal(summary.failures[0].error, 'S3_SHA256_MISMATCH');
});
