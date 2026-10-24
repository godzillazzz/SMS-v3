process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { providerConfig, assertBucket, assertObjectKey, createS3ObjectStorage } = require('../src/services/object-storage-provider');

test('Supabase remains the default and S3 config is explicit', () => {
  assert.equal(providerConfig({}).provider, 'supabase');
  assert.equal(providerConfig({ STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://127.0.0.1:9000', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret' }).provider, 's3');
  assert.throws(() => providerConfig({ STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://example.invalid', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret' }), /Object storage provider is unavailable/);
  assert.throws(() => assertBucket('unknown', { S3_ALLOWED_BUCKETS: 'allowed' }));
  assert.equal(assertBucket('allowed', { S3_ALLOWED_BUCKETS: 'allowed' }), 'allowed');
  assert.throws(() => assertBucket('allowed', { S3_ALLOWED_BUCKETS: '' }));
});

test('object keys reject traversal, empty segments, and unsafe names', () => {
  for (const key of ['../secret', 'a/../b', 'a//b', '/leading', 'a\\b', 'a/%2e%2e/b']) assert.throws(() => assertObjectKey(key));
  assert.equal(assertObjectKey('attendance-face-evidence/employee/object.jpg'), 'attendance-face-evidence/employee/object.jpg');
});

test('S3 adapter uploads with checksum metadata, reads, and deletes through injected client', async () => {
  const calls = [];
  const checksum = require('node:crypto').createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex');
  const client = { send: async (command) => { calls.push(command); if (command.constructor.name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) }, Metadata: { sha256: checksum } }; if (command.constructor.name === 'HeadObjectCommand') return { Metadata: { sha256: checksum }, ContentType: 'image/jpeg', ContentLength: 3 }; return {}; } };
  const storage = createS3ObjectStorage({ environment: { STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://127.0.0.1:9000', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret', S3_ALLOWED_BUCKETS: 'bucket' }, client });
  const stored = await storage.put('bucket', 'attendance-selfie/a.jpg', { buffer: Buffer.from([1, 2, 3]), mimetype: 'image/jpeg' });
  assert.equal(stored.provider, 's3');
  assert.deepEqual(await storage.get('bucket', 'attendance-selfie/a.jpg'), Buffer.from([1, 2, 3]));
  await storage.remove('bucket', 'attendance-selfie/a.jpg');
  assert.equal(calls.length, 4);
  assert.match(calls[0].input.Metadata.sha256, /^[a-f0-9]{64}$/);
});

test('S3 adapter rejects missing or mismatched checksums on read and head', async () => {
  const client = { send: async (command) => {
    if (command.constructor.name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => Buffer.from('bad') } };
    return { Metadata: {} };
  } };
  const storage = createS3ObjectStorage({ environment: { STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://127.0.0.1:9000', S3_ACCESS_KEY_ID: 'key', S3_SECRET_ACCESS_KEY: 'secret', S3_ALLOWED_BUCKETS: 'bucket' }, client });
  await assert.rejects(storage.get('bucket', 'attendance-selfie/a.jpg'), /checksum/i);
  await assert.rejects(storage.head('bucket', 'attendance-selfie/a.jpg'), /checksum/i);
});
