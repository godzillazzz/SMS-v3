'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { assertBucket, assertObjectKey, createS3ObjectStorage } = require('./object-storage-provider');
const PROVIDERS = new Set(['supabase', 's3']);
const MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
function fail(code, message, status = 503) { throw new HttpError(status, message, { code }); }
function locationOf(row, environment = process.env) {
  const provider = String(row?.storageProvider || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) fail('STORAGE_PROVIDER_INVALID', 'Stored object provider is invalid.', 400);
  const bucket = String(row?.storageBucket || '').trim(); const key = row?.storageObjectKey;
  if (!bucket) fail('STORAGE_BUCKET_NOT_CONFIGURED', 'Stored object bucket is missing.', 400);
  if (!key) fail('STORAGE_OBJECT_KEY_INVALID', 'Stored object key is missing.', 400);
  assertBucket(bucket, environment); assertObjectKey(key); return { provider, bucket, key };
}
function verify(bytes, row) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail('STORAGE_READ_FAILED', 'Stored object could not be read.', 502);
  if ((row.sizeBytes != null && Number(row.sizeBytes) !== bytes.length) || (row.fileSize != null && Number(row.fileSize) !== bytes.length)) fail('STORAGE_SIZE_MISMATCH', 'Stored object size does not match metadata.', 502);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  if (row.checksum && String(row.checksum).toLowerCase() !== checksum) fail('STORAGE_CHECKSUM_MISMATCH', 'Stored object checksum does not match metadata.', 502);
  if (row.mimeType && !MIME.has(String(row.mimeType))) fail('STORAGE_MIME_INVALID', 'Stored object MIME type is invalid.', 502);
  return { bytes, checksum, sizeBytes: bytes.length, mimeType: row.mimeType || 'application/octet-stream' };
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
module.exports = { createStorageReadResolver, locationOf, verify };
