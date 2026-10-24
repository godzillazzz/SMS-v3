'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createStorageReadResolver, locationOf } = require('../src/services/storage-read-resolver');
const env = { SUPABASE_ALLOWED_BUCKETS: 'legacy-supabase', S3_ALLOWED_BUCKETS: 'private-s3', EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'private-s3' };
const bytes = Buffer.from('deterministic object');
const checksum = crypto.createHash('sha256').update(bytes).digest('hex');

test('mixed Supabase and S3 records resolve from record metadata', async () => {
  const calls = [];
  const resolver = createStorageReadResolver({ environment: env, adapters: {
    supabase: { getBytes: async (key, bucket) => { calls.push(['supabase', key, bucket]); return bytes; } },
    s3: { getBytes: async (bucket, key) => { calls.push(['s3', bucket, key]); return bytes; } }
  } });
  await resolver.read({ storageProvider: 'supabase', storageBucket: 'legacy-supabase', storageObjectKey: 'photos/a.jpg', mimeType: 'image/jpeg', fileSize: bytes.length, checksum });
  await resolver.read({ storageProvider: 's3', storageBucket: 'private-s3', storageObjectKey: 'photos/b.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length, checksum });
  assert.deepEqual(calls, [['supabase', 'photos/a.jpg', 'legacy-supabase'], ['s3', 'private-s3', 'photos/b.jpg']]);
});

test('resolver fails closed for malformed provider, bucket, key, checksum, MIME and size', async () => {
  assert.throws(() => locationOf({ storageProvider: 'minio', storageBucket: 'private-s3', storageObjectKey: 'x' }, env), /provider/i);
  assert.throws(() => locationOf({ storageProvider: 's3', storageBucket: 'other', storageObjectKey: 'x' }, env), /bucket/i);
  const resolver = createStorageReadResolver({ environment: env, adapters: { s3: { getBytes: async () => bytes } } });
  await assert.rejects(resolver.read({ storageProvider: 's3', storageBucket: 'private-s3', storageObjectKey: 'x', checksum: '0'.repeat(64) }), /checksum/i);
  await assert.rejects(resolver.read({ storageProvider: 's3', storageBucket: 'private-s3', storageObjectKey: 'x', sizeBytes: 99 }), /size/i);
  await assert.rejects(resolver.read({ storageProvider: 's3', storageBucket: 'private-s3', storageObjectKey: 'x', mimeType: 'text/plain' }), /MIME/i);
});
