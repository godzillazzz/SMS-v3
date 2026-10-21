'use strict';

const HttpError = require('../utils/http-error');

function fail(code, message) { throw new HttpError(503, message, { code }); }
function requireBackend(backend) {
  if (!backend || typeof backend.put !== 'function' || typeof backend.remove !== 'function' || typeof backend.get !== 'function' || typeof backend.createSignedUrl !== 'function') fail('STORAGE_PROVIDER_UNAVAILABLE', 'Object storage provider is unavailable.');
  return backend;
}
function bucket(environment, name) {
  const value = String(environment[name] || '').trim();
  if (!value) fail('STORAGE_BUCKET_NOT_CONFIGURED', 'Object storage bucket is not configured.');
  return value;
}
function createS3ContractWrappers({ environment = process.env, backend, prisma = null, audit = null, clock = () => new Date() } = {}) {
  const buckets = {
    selfie: bucket(environment, 'ATTENDANCE_DEVICE_SELFIE_BUCKET'),
    evidence: bucket(environment, 'ATTENDANCE_FACE_EVIDENCE_BUCKET'),
    reference: bucket(environment, 'EMPLOYEE_REFERENCE_PHOTOS_BUCKET'),
    license: bucket(environment, 'LICENSE_DOCUMENTS_BUCKET')
  };
  const store = requireBackend(backend);
  const put = async (kind, key, file) => store.put(buckets[kind], key, file);
  const remove = async (kind, key) => store.remove(buckets[kind], key);
  const sign = async (kind, key, expiresIn) => store.createSignedUrl(buckets[kind], key, expiresIn);
  const selfie = Object.freeze({
    provider: 's3',
    async put({ employeeId, captureId, selfie: file }) { return put('selfie', `attendance-selfie/${employeeId}/${captureId}`, file); },
    async remove({ objectKey }) { return remove('selfie', objectKey); },
    async listObjects() { return []; },
    async reconcileOrphans() { return { scanned: 0, deleted: 0, kept: 0, failed: 0, skippedRecent: 0, skippedUnknown: 0, truncated: false, limitReached: null }; },
    async purgeExpiredSelfies() { return { inspected: 0, purged: 0, failed: 0 }; }
  });
  const evidence = Object.freeze({
    provider: 's3', storesBytes: true,
    async store({ employeeId, sessionId, livePhotoBytes, mimeType = 'image/jpeg' }) { const objectKey = `attendance-face-evidence/${employeeId}/${sessionId}`; const stored = await put('evidence', objectKey, { buffer: livePhotoBytes, mimetype: mimeType }); return { storageStatus: 'STORED', stored: true, storageProvider: stored.provider || 's3', storageBucket: buckets.evidence, storageObjectKey: objectKey, checksum: require('node:crypto').createHash('sha256').update(livePhotoBytes).digest('hex') }; },
    async remove({ objectKey }) { return remove('evidence', objectKey); },
    async view({ id, actor, storageObjectKey }) { if (!actor?.sub || !id) throw new HttpError(403, 'Attendance evidence authorization is required.', { code: 'ATTENDANCE_EVIDENCE_FORBIDDEN' }); return { id, url: await sign('evidence', storageObjectKey, 60), storageProvider: 's3' }; },
    async purgeExpired() { return { inspected: 0, purged: 0, failed: 0 }; }
  });
  const reference = Object.freeze({
    provider: 's3',
    async put(objectKey, file) { return put('reference', objectKey, file); },
    async remove(objectKey) { return remove('reference', objectKey); },
    async getBytes(objectKey) { return store.get(buckets.reference, objectKey); },
    async createSignedUrl(objectKey, expiresIn = 60) { return sign('reference', objectKey, expiresIn); }
  });
  const license = Object.freeze({
    provider: 's3',
    async put(objectKey, file) { return put('license', objectKey, file); },
    async remove(objectKey) { return remove('license', objectKey); },
    async createSignedUrl(objectKey, expiresIn = 600) { return sign('license', objectKey, expiresIn); }
  });
  return Object.freeze({ selfie, evidence, reference, license, buckets, storageProvider: 's3' });
}
function selectContractStorage({ environment = process.env, supabaseFactory, backend, contract } = {}) {
  const provider = String(environment.STORAGE_PROVIDER || 'supabase').toLowerCase();
  if (provider === 'supabase') return supabaseFactory();
  if (provider !== 's3') fail('STORAGE_PROVIDER_INVALID', 'Object storage provider is unavailable.');
  if (environment.NODE_ENV !== 'test') fail('STORAGE_PROVIDER_NOT_WIRED', 'S3 storage is not wired into application services; WIRE-02 is required.');
  const wrappers = createS3ContractWrappers({ environment, backend });
  if (!wrappers[contract]) fail('STORAGE_CONTRACT_INVALID', 'Storage contract is unavailable.');
  return wrappers[contract];
}
module.exports = { createS3ContractWrappers, selectContractStorage };
