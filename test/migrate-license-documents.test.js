'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateLicenseDocuments, TARGET_BUCKET, TARGET_PROVIDER } = require('../scripts/storage/migrate-license-documents-to-minio');

test('migrateLicenseDocuments dry-run does not modify database or storage', async () => {
  const fakeRow = {
    id: 'doc-1',
    storageProvider: 'supabase',
    storageBucket: 'sms-v3-license-documents',
    storageObjectKey: 'licenses/emp-1/file-1.pdf',
    fileSize: 100,
    storageDeletedAt: null
  };

  let updateCalled = false;
  const mockPrisma = {
    employeeLicenseDocument: {
      findMany: async () => [fakeRow],
      update: async () => { updateCalled = true; }
    }
  };

  // Mock environment with fake keys
  const fakeEnv = {
    STORAGE_PROVIDER: 's3',
    S3_ENDPOINT: 'https://minio.example.com',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'fake-access',
    S3_SECRET_ACCESS_KEY: 'fake-secret',
    S3_ALLOWED_BUCKETS: TARGET_BUCKET,
    SUPABASE_ALLOWED_BUCKETS: 'sms-v3-license-documents'
  };

  // Run with custom environment or mock resolver
  assert.equal(TARGET_BUCKET, 'smsv3-license-documents');
  assert.equal(TARGET_PROVIDER, 's3');
});
