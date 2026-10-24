process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createS3ContractWrappers } = require('../src/services/storage-contract-wrappers');

function harness() {
  const calls = []; const backend = {
    async put(bucket, key, file) { calls.push(['put', bucket, key, file]); return { provider: 's3', bucket, objectKey: key, sha256: require('node:crypto').createHash('sha256').update(file.buffer).digest('hex') }; },
    async remove(bucket, key) { calls.push(['remove', bucket, key]); },
    async get(bucket, key) { calls.push(['get', bucket, key]); return Buffer.from('bytes'); },
    async createSignedUrl(bucket, key, seconds) { calls.push(['sign', bucket, key, seconds]); return `signed://${bucket}/${key}`; }
  };
  const environment = { ATTENDANCE_DEVICE_SELFIE_BUCKET: 'selfie', ATTENDANCE_FACE_EVIDENCE_BUCKET: 'evidence', EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'reference', LICENSE_DOCUMENTS_BUCKET: 'license' };
  return { calls, wrappers: createS3ContractWrappers({ environment, backend }) };
}

test('all four wrappers map to explicit private buckets and provider metadata', async () => {
  const { calls, wrappers } = harness();
  assert.equal(wrappers.storageProvider, 's3');
  await wrappers.selfie.put({ employeeId: 'e1', captureId: 'c1', selfie: { buffer: Buffer.from('x'), mimetype: 'image/jpeg' } });
  const evidence = await wrappers.evidence.store({ employeeId: 'e1', sessionId: 's1', livePhotoBytes: Buffer.from('x') });
  assert.equal(evidence.storageProvider, 's3');
  await wrappers.reference.put('reference/e1/a.jpg', { buffer: Buffer.from('x'), mimetype: 'image/jpeg' });
  await wrappers.license.put('license/e1/a.pdf', { buffer: Buffer.from('x'), mimetype: 'application/pdf' });
  assert.deepEqual(calls.map((call) => call[1]), ['selfie', 'evidence', 'reference', 'license']);
});

test('evidence authorization is checked before signed URL', async () => {
  const { calls, wrappers } = harness();
  await assert.rejects(wrappers.evidence.view({ id: 'e1', storageObjectKey: 'evidence/e1' }), /authorization/);
  assert.equal(calls.length, 0);
  await wrappers.evidence.view({ id: 'e1', actor: { sub: 'user' }, storageObjectKey: 'evidence/e1' });
  assert.equal(calls.at(-1)[0], 'sign');
});

test('missing bucket configuration fails closed before backend creation', () => {
  assert.throws(() => createS3ContractWrappers({ environment: {}, backend: {} }), /bucket/);
});

test('selfie cleanup does not silently claim success when unsupported', async () => {
  const { wrappers } = harness();
  await assert.rejects(wrappers.selfie.reconcileOrphans(), /unavailable/);
  await assert.rejects(wrappers.selfie.purgeExpiredSelfies(), /unavailable/);
});
