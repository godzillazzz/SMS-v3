process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createS3ContractWrappers } = require('../src/services/storage-contract-wrappers');

function harness({ removeError = null } = {}) {
  const calls = []; const backend = {
    async put(bucket, key, file) { calls.push(['put', bucket, key, file]); return { provider: 's3', bucket, objectKey: key, sha256: require('node:crypto').createHash('sha256').update(file.buffer).digest('hex') }; },
    async remove(bucket, key) { calls.push(['remove', bucket, key]); if (removeError) throw removeError; },
    async get(bucket, key) { calls.push(['get', bucket, key]); return Buffer.from('bytes'); },
    async createSignedUrl(bucket, key, seconds) { calls.push(['sign', bucket, key, seconds]); return `signed://${bucket}/${key}`; }
  };
  const environment = { ATTENDANCE_DEVICE_SELFIE_BUCKET: 'selfie', ATTENDANCE_FACE_EVIDENCE_BUCKET: 'evidence', EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'reference', LICENSE_DOCUMENTS_BUCKET: 'license' };
  const now = new Date('2026-01-01T00:00:00Z');
  const row = { id: 'evidence-1', employeeId: 'e1', storageObjectKey: 'attendance-face-evidence/e1/2026-01/s1.jpg', mimeType: 'image/jpeg', capturedAt: now, retentionUntil: new Date('2027-01-01T00:00:00Z'), purgedAt: null, purgeRequestedAt: null, employee: { department: 'ops' } };
  const prisma = { attendanceEvidence: { create: async ({ data }) => ({ ...row, ...data, id: 'evidence-1' }), findUnique: async () => row, findMany: async () => [], update: async () => row }, attendanceDeviceSelfie: { findMany: async () => [], update: async () => ({}) } };
  const audit = { log: async () => {} };
  return { calls, wrappers: createS3ContractWrappers({ environment, backend, prisma, audit, clock: () => now }) };
}

test('all four wrappers map to explicit private buckets and provider metadata', async () => {
  const { calls, wrappers } = harness();
  assert.equal(wrappers.storageProvider, 's3');
  const selfieBuffer = Buffer.from('x');
  await wrappers.selfie.put({ employeeId: 'e1', captureId: 'c1', selfie: { buffer: selfieBuffer, mimetype: 'image/jpeg', checksum: require('node:crypto').createHash('sha256').update(selfieBuffer).digest('hex') } });
  const evidence = await wrappers.evidence.store({ employeeId: 'e1', sessionId: 's1', referencePhotoId: 'r1', livePhotoBytes: Buffer.alloc(64, 1), verificationPassed: true });
  assert.equal(evidence.storageProvider, 's3');
  await wrappers.reference.put('reference/e1/a.jpg', { buffer: Buffer.from('x'), mimetype: 'image/jpeg' });
  await wrappers.license.put('license/e1/a.pdf', { buffer: Buffer.from('x'), mimetype: 'application/pdf' });
  assert.deepEqual(calls.map((call) => call[1]), ['selfie', 'evidence', 'reference', 'license']);
});

test('evidence authorization is checked before signed URL', async () => {
  const { calls, wrappers } = harness();
  await assert.rejects(wrappers.evidence.view({ id: 'e1' }), /authorization/);
  assert.equal(calls.length, 0);
  const result = await wrappers.evidence.view({ id: 'evidence-1', actor: { sub: 'user', role: 'ADMIN' } });
  assert.equal(result.url, '/api/storage-proxy/evidence/evidence-1');
  assert.equal(calls.length, 0);
});

test('missing bucket configuration fails closed before backend creation', () => {
  assert.throws(() => createS3ContractWrappers({ environment: {}, backend: {} }), /bucket/);
});

test('selfie cleanup executes bounded lifecycle operations', async () => {
  const { wrappers } = harness();
  assert.deepEqual(await wrappers.selfie.purgeExpiredSelfies(), { inspected: 0, purged: 0, failed: 0 });
});

test('S3 selfie put returns the Supabase-compatible shape used for AttendanceDeviceSelfie rows', async () => {
  const { calls, wrappers } = harness();
  const buffer = Buffer.from('jpeg-bytes');
  const checksum = require('node:crypto').createHash('sha256').update(buffer).digest('hex');
  const stored = await wrappers.selfie.put({ employeeId: 'e1', captureId: 'c1', selfie: { buffer, mimeType: 'image/jpeg', sizeBytes: buffer.length, checksum } });
  // The attendance service writes these into required AttendanceDeviceSelfie columns.
  for (const field of ['provider', 'bucket', 'objectKey', 'mimeType', 'sizeBytes', 'checksum']) assert.ok(stored[field] !== undefined && stored[field] !== null, field);
  assert.equal(stored.checksum, checksum);
  assert.equal(stored.mimeType, 'image/jpeg');
  assert.equal(stored.sizeBytes, buffer.length);
  // normalizeSelfie() uses camelCase mimeType; the S3 backend must still receive a content type.
  assert.equal(calls[0][3].mimetype, 'image/jpeg');
});

test('S3 selfie put rejects an upload whose stored checksum differs from the signed selfie', async () => {
  const { calls, wrappers } = harness();
  const file = { buffer: Buffer.from('a'), mimeType: 'image/jpeg', checksum: '0'.repeat(64) };
  await assert.rejects(
    wrappers.selfie.put({ employeeId: 'e1', captureId: 'c1', selfie: file }),
    (error) => error?.details?.code === 'STORAGE_CHECKSUM_UNCONFIRMED'
  );
  assert.deepEqual(calls.filter((call) => call[0] === 'remove'), [['remove', 'selfie', 'attendance-selfie/e1/c1']]);
});

test('S3 selfie put fails closed and removes the uploaded object when the signed checksum is missing', async () => {
  const { calls, wrappers } = harness();
  await assert.rejects(
    wrappers.selfie.put({ employeeId: 'e1', captureId: 'c-missing', selfie: { buffer: Buffer.from('a'), mimeType: 'image/jpeg' } }),
    (error) => error?.details?.code === 'STORAGE_CHECKSUM_UNCONFIRMED'
  );
  assert.deepEqual(calls.filter((call) => call[0] === 'remove'), [['remove', 'selfie', 'attendance-selfie/e1/c-missing']]);
});

test('S3 selfie checksum failure remains fail-closed when best-effort cleanup rejects', async () => {
  const { calls, wrappers } = harness({ removeError: new Error('cleanup failure') });
  await assert.rejects(
    wrappers.selfie.put({ employeeId: 'e1', captureId: 'c-cleanup-fails', selfie: { buffer: Buffer.from('a'), mimeType: 'image/jpeg', checksum: '0'.repeat(64) } }),
    (error) => error?.details?.code === 'STORAGE_CHECKSUM_UNCONFIRMED'
      && error.message === 'Object storage checksum could not be confirmed.'
  );
  assert.deepEqual(calls.filter((call) => call[0] === 'remove'), [['remove', 'selfie', 'attendance-selfie/e1/c-cleanup-fails']]);
});

test('S3 selfie getBytes reads only from the selfie bucket', async () => {
  const { calls, wrappers } = harness();
  const result = await wrappers.selfie.getBytes({ objectKey: 'attendance-selfie/a/b.jpg' });
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.deepEqual(calls.at(-1), ['get', 'selfie', 'attendance-selfie/a/b.jpg']);
});
