'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { assertBucket, assertObjectKey, createS3ObjectStorage } = require('./object-storage-provider');

function supabaseBucketAllowlist(environment = process.env) {
  const configured = [
    environment.SUPABASE_ALLOWED_BUCKETS,
    environment.SUPABASE_STORAGE_BUCKET,
    environment.SUPABASE_BUCKET,
    environment.ATTENDANCE_DEVICE_SELFIE_BUCKET,
    environment.ATTENDANCE_FACE_EVIDENCE_BUCKET,
    environment.EMPLOYEE_REFERENCE_PHOTOS_BUCKET,
    environment.LICENSE_DOCUMENTS_BUCKET
  ].filter(Boolean).join(',');
  return new Set(configured.split(',').map((value) => String(value).trim()).filter(Boolean));
}
function assertSupabaseBucket(bucket, environment = process.env) {
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(bucket) || !supabaseBucketAllowlist(environment).has(bucket)) {
    throw new HttpError(400, 'Storage bucket is not allowed.', { code: 'STORAGE_BUCKET_NOT_ALLOWED' });
  }
  return bucket;
}
const PROVIDERS = new Set(['supabase', 's3']);
const MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
function detectedMimeType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 5 && bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
  return null;
}
function fail(code, message, status = 503) { throw new HttpError(status, message, { code }); }
function locationOf(row, environment = process.env) {
  const provider = String(row?.storageProvider || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) fail('STORAGE_PROVIDER_INVALID', 'Stored object provider is invalid.', 400);
  const bucket = String(row?.storageBucket || '').trim(); const key = row?.storageObjectKey;
  if (!bucket) fail('STORAGE_BUCKET_NOT_CONFIGURED', 'Stored object bucket is missing.', 400);
  if (!key) fail('STORAGE_OBJECT_KEY_INVALID', 'Stored object key is missing.', 400);
  (provider === 's3' ? assertBucket : assertSupabaseBucket)(bucket, environment);
  assertObjectKey(key); return { provider, bucket, key };
}
function verify(bytes, row) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail('STORAGE_READ_FAILED', 'Stored object could not be read.', 502);
  if ((row.sizeBytes != null && Number(row.sizeBytes) !== bytes.length) || (row.fileSize != null && Number(row.fileSize) !== bytes.length)) fail('STORAGE_SIZE_MISMATCH', 'Stored object size does not match metadata.', 502);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  if (row.checksum && String(row.checksum).toLowerCase() !== checksum) fail('STORAGE_CHECKSUM_MISMATCH', 'Stored object checksum does not match metadata.', 502);
  const declaredMime = row.mimeType ? String(row.mimeType) : null;
  if (declaredMime && !MIME.has(declaredMime)) fail('STORAGE_MIME_INVALID', 'Stored object MIME type is invalid.', 502);
  const actualMime = detectedMimeType(bytes);
  if (declaredMime && actualMime !== declaredMime) fail('STORAGE_MIME_MISMATCH', 'Stored object MIME type does not match its bytes.', 502);
  return { bytes, checksum, sizeBytes: bytes.length, mimeType: declaredMime || actualMime || 'application/octet-stream' };
}
function createSupabaseReader({ environment, fetchImpl = globalThis.fetch } = {}) {
  return { async getBytes(key, bucket) {
    const base = String(environment.SUPABASE_URL || '').replace(/\/$/, ''); const secret = String(environment.SUPABASE_SERVICE_ROLE_KEY || '');
    if (!base || !secret || typeof fetchImpl !== 'function') fail('STORAGE_ADAPTER_UNAVAILABLE', 'Legacy storage adapter is unavailable.');
    const response = await fetchImpl(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`, { headers: { authorization: `Bearer ${secret}`, apikey: secret } });
    if (!response.ok) fail('STORAGE_READ_FAILED', 'Stored object could not be read.', 502);
    return Buffer.from(await response.arrayBuffer());
  } };
}
function createStorageReadResolver({ environment = process.env, adapters = {}, s3Backend, fetchImpl } = {}) {
  let s3;
  function adapterFor(location) {
    if (adapters[location.provider]) return adapters[location.provider];
    if (location.provider === 's3') { s3 ||= s3Backend || createS3ObjectStorage({ environment }); return { getBytes: (bucket, key) => s3.get(bucket, key) }; }
    return createSupabaseReader({ environment, fetchImpl });
  }
  async function read(row) { const location = locationOf(row, environment); const adapter = adapterFor(location); const bytes = location.provider === 's3' ? await adapter.getBytes(location.bucket, location.key) : await adapter.getBytes(location.key, location.bucket); return verify(bytes, row); }
  return Object.freeze({ locationOf: (row) => locationOf(row, environment), read });
}
module.exports = { createStorageReadResolver, locationOf, verify, detectedMimeType };
