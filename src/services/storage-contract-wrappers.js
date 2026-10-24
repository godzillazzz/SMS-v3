'use strict';

const HttpError = require('../utils/http-error');
const crypto = require('node:crypto');
const { createS3ObjectStorage } = require('./object-storage-provider');

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
function createS3ContractWrappers({ environment = process.env, backend = createS3ObjectStorage({ environment }), prisma = null, audit = null, clock = () => new Date() } = {}) {
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
    async put({ employeeId, captureId, selfie: file }) {
      const secret = String(environment.SELFIE_PATH_SECRET || '');
      const identity = secret ? crypto.createHmac('sha256', secret).update(String(employeeId)).digest('hex') : String(employeeId);
      return put('selfie', `attendance-selfie/${identity}/${captureId}`, file);
    },
    async remove({ objectKey }) { return remove('selfie', objectKey); },
    async listObjects() { if (typeof store.listObjects !== 'function') fail('STORAGE_LIST_UNAVAILABLE', 'Object storage listing is unavailable.'); return store.listObjects(buckets.selfie, 'attendance-selfie/'); },
    async reconcileOrphans() { fail('STORAGE_RECONCILE_UNAVAILABLE', 'Object storage reconciliation is unavailable.'); },
    async purgeExpiredSelfies() { fail('STORAGE_PURGE_UNAVAILABLE', 'Object storage retention purge is unavailable.'); }
  });
  const evidence = Object.freeze({
    provider: 's3', storesBytes: true,
    async store({ employeeId, sessionId, livePhotoBytes, mimeType = 'image/jpeg' }) { const objectKey = `attendance-face-evidence/${employeeId}/${sessionId}`; const checksum = crypto.createHash('sha256').update(livePhotoBytes).digest('hex'); const stored = await put('evidence', objectKey, { buffer: livePhotoBytes, mimetype: mimeType }); if (stored.sha256 !== checksum) fail('STORAGE_CHECKSUM_UNCONFIRMED', 'Object storage checksum could not be confirmed.'); return { storageStatus: 'STORED', stored: true, storageProvider: stored.provider || 's3', storageBucket: buckets.evidence, storageObjectKey: objectKey, checksum }; },
    async remove({ objectKey }) { return remove('evidence', objectKey); },
    async view({ id, actor, storageObjectKey }) { if (!actor?.sub || !id) throw new HttpError(403, 'Attendance evidence authorization is required.', { code: 'ATTENDANCE_EVIDENCE_FORBIDDEN' }); return { id, url: await sign('evidence', storageObjectKey, 60), storageProvider: 's3' }; },
    async purgeExpired() { fail('STORAGE_PURGE_UNAVAILABLE', 'Object storage retention purge is unavailable.'); }
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
  if ((environment.NODE_ENV === 'production' || environment.VERCEL_ENV === 'production') && environment.STORAGE_S3_PRODUCTION_APPROVED !== 'true') fail('S3_PRODUCTION_NOT_APPROVED', 'S3 storage is not approved for Production.');
  const wrappers = createS3ContractWrappers({ environment, backend });
  if (!wrappers[contract]) fail('STORAGE_CONTRACT_INVALID', 'Storage contract is unavailable.');
  return wrappers[contract];
}
module.exports = { createS3ContractWrappers, selectContractStorage };
