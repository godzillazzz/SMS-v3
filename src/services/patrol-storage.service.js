'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { createS3ObjectStorage } = require('./object-storage-provider');

// Patrol photos reuse an already-provisioned private bucket under the dedicated
// `patrol-scan/` prefix so no new bucket or credential is required. Existing selfie
// retention/orphan jobs only list `attendance-selfie/`, so they never touch these objects.
function patrolBucket(environment = process.env) {
  const bucket = String(environment.PATROL_PHOTOS_BUCKET || environment.ATTENDANCE_DEVICE_SELFIE_BUCKET || '').trim();
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(bucket)) throw new HttpError(503, 'Patrol photo storage is not configured.', { code: 'PATROL_STORAGE_NOT_CONFIGURED' });
  return bucket;
}

function assertPatrolKey(key) {
  if (typeof key !== 'string' || !/^patrol-scan\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(?:jpg|png)$/.test(key)) throw new HttpError(400, 'Patrol object key is invalid.', { code: 'PATROL_OBJECT_KEY_INVALID' });
  return key;
}

function createS3PatrolStorage({ environment = process.env, backend, assertKey = assertPatrolKey } = {}) {
  const store = backend || createS3ObjectStorage({ environment });
  const bucket = patrolBucket(environment);
  return Object.freeze({
    provider: 's3',
    bucket,
    async put(key, file) { const stored = await store.put(bucket, assertKey(key), file); return { ...stored, provider: 's3', bucket }; },
    async remove(key) { return store.remove(bucket, assertKey(key)); },
    async get(key) { return store.get(bucket, assertKey(key)); }
  });
}

function createSupabasePatrolStorage({ environment = process.env, fetchImpl = globalThis.fetch, assertKey = assertPatrolKey } = {}) {
  const config = () => {
    let url = '';
    try { url = new URL(String(environment.SUPABASE_URL || '')).origin; } catch { /* handled below */ }
    const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !serviceKey) throw new HttpError(503, 'Patrol photo storage is not configured.', { code: 'PATROL_STORAGE_NOT_CONFIGURED' });
    return { url, serviceKey, bucket: patrolBucket(environment) };
  };
  const objectUrl = ({ url, bucket }, key) => `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${assertKey(key).split('/').map(encodeURIComponent).join('/')}`;
  const headers = ({ serviceKey }, extra = {}) => ({ authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...extra });
  return Object.freeze({
    provider: 'supabase',
    get bucket() { return config().bucket; },
    async put(key, file) {
      const current = config();
      const response = await fetchImpl(objectUrl(current, key), { method: 'POST', headers: headers(current, { 'content-type': file.mimetype, 'x-upsert': 'false' }), body: file.buffer });
      if (!response.ok) throw new HttpError(502, 'Patrol photo upload failed.', { code: 'PATROL_PHOTO_UPLOAD_FAILED' });
      return { provider: 'supabase', bucket: current.bucket, objectKey: key, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') };
    },
    async remove(key) {
      const current = config();
      const response = await fetchImpl(objectUrl(current, key), { method: 'DELETE', headers: headers(current) });
      if (!response.ok && response.status !== 404) throw new HttpError(502, 'Patrol photo cleanup failed.', { code: 'PATROL_PHOTO_DELETE_FAILED' });
    },
    async get(key) {
      const current = config();
      const response = await fetchImpl(objectUrl(current, key), { method: 'GET', headers: headers(current) });
      if (!response.ok) throw new HttpError(502, 'Patrol photo read failed.', { code: 'PATROL_PHOTO_READ_FAILED' });
      return Buffer.from(await response.arrayBuffer());
    }
  });
}

function selectPatrolStorage({ environment = process.env, backend, fetchImpl, assertKey = assertPatrolKey } = {}) {
  const provider = String(environment.STORAGE_PROVIDER || 'supabase').trim().toLowerCase();
  if (provider === 'supabase') return createSupabasePatrolStorage({ environment, fetchImpl, assertKey });
  if (provider !== 's3') throw new HttpError(503, 'Object storage provider is unavailable.', { code: 'STORAGE_PROVIDER_INVALID' });
  if ((environment.NODE_ENV === 'production' || environment.VERCEL_ENV === 'production') && environment.STORAGE_S3_PRODUCTION_APPROVED !== 'true') {
    throw new HttpError(503, 'S3 storage is not approved for Production.', { code: 'S3_PRODUCTION_NOT_APPROVED' });
  }
  return createS3PatrolStorage({ environment, backend, assertKey });
}

// Lazily resolved so a missing storage configuration fails only patrol photo calls,
// never application startup or unrelated routes.
function lazyPatrolStorage(options = {}) {
  let instance;
  const resolve = () => { instance = instance || selectPatrolStorage(options); return instance; };
  return {
    get provider() { return resolve().provider; },
    get bucket() { return resolve().bucket; },
    put: (key, file) => resolve().put(key, file),
    remove: (key) => resolve().remove(key),
    get: (key) => resolve().get(key)
  };
}

module.exports = { patrolBucket, assertPatrolKey, createS3PatrolStorage, createSupabasePatrolStorage, selectPatrolStorage, lazyPatrolStorage };
