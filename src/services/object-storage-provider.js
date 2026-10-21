'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');

const PROVIDERS = Object.freeze({ SUPABASE: 'supabase', S3: 's3' });
const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/;
function bucketAllowlist(environment = process.env) {
  return new Set(String(environment.S3_ALLOWED_BUCKETS || [environment.ATTENDANCE_DEVICE_SELFIE_BUCKET, environment.ATTENDANCE_FACE_EVIDENCE_BUCKET, environment.EMPLOYEE_REFERENCE_PHOTOS_BUCKET, environment.LICENSE_DOCUMENTS_BUCKET].filter(Boolean).join(',')).split(',').map((value) => value.trim()).filter(Boolean));
}
function assertBucket(bucket, environment = process.env) {
  if (!bucket || !/^[A-Za-z0-9._-]{1,255}$/.test(bucket) || !bucketAllowlist(environment).has(bucket)) throw new HttpError(400, 'Storage bucket is not allowed.', { code: 'STORAGE_BUCKET_NOT_ALLOWED' });
  return bucket;
}
function providerConfig(environment = process.env) {
  const provider = String(environment.STORAGE_PROVIDER || PROVIDERS.SUPABASE).trim().toLowerCase();
  if (!Object.values(PROVIDERS).includes(provider)) throw new Error('STORAGE_PROVIDER must be supabase or s3.');
  if (provider === PROVIDERS.S3) {
    const endpoint = String(environment.S3_ENDPOINT || '').trim();
    const region = String(environment.S3_REGION || 'us-east-1').trim();
    const accessKeyId = String(environment.S3_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = String(environment.S3_SECRET_ACCESS_KEY || '').trim();
    if (!endpoint || !/^https:\/\//i.test(endpoint) && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(endpoint) || !region || !accessKeyId || !secretAccessKey) {
      throw new HttpError(503, 'Object storage provider is unavailable.', { code: 'S3_STORAGE_NOT_CONFIGURED' });
    }
    return { provider, endpoint: new URL(endpoint).origin, region, accessKeyId, secretAccessKey, forcePathStyle: String(environment.S3_FORCE_PATH_STYLE || 'true') === 'true' };
  }
  return { provider };
}
function assertObjectKey(key) {
  if (typeof key !== 'string' || !KEY.test(key) || key.includes('..') || key.includes('//') || key.split('/').some((part) => !part || part === '.' || part === '..')) throw new HttpError(400, 'Object key is invalid.', { code: 'STORAGE_OBJECT_KEY_INVALID' });
  return key;
}
function s3Client({ config, client } = {}) {
  if (client) {
    class PutObjectCommand { constructor(input) { this.input = input; } }
    class DeleteObjectCommand { constructor(input) { this.input = input; } }
    class GetObjectCommand { constructor(input) { this.input = input; } }
    return { client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand };
  }
  let S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand;
  try {
    ({ S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'));
  } catch {
    throw new HttpError(503, 'Object storage provider is unavailable.', { code: 'S3_SDK_NOT_INSTALLED' });
  }
  return { client: new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }), PutObjectCommand, DeleteObjectCommand, GetObjectCommand };
}
function createS3ObjectStorage({ environment = process.env, client } = {}) {
  const config = providerConfig(environment);
  if (config.provider !== PROVIDERS.S3) throw new Error('S3 object storage requires STORAGE_PROVIDER=s3.');
  const sdk = s3Client({ config, client });
  const send = (command) => sdk.client.send(command);
  return Object.freeze({
    provider: PROVIDERS.S3,
    async put(bucket, key, file) { assertObjectKey(key); assertBucket(bucket, environment); await send(new sdk.PutObjectCommand({ Bucket: bucket, Key: key, Body: file.buffer, ContentType: file.mimetype, ContentLength: file.buffer.length, Metadata: { sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') } })); return { provider: PROVIDERS.S3, bucket, objectKey: key }; },
    async remove(bucket, key) { assertObjectKey(key); assertBucket(bucket, environment); await send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key })); },
    async get(bucket, key) { assertObjectKey(key); assertBucket(bucket, environment); const result = await send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key })); if (!result?.Body?.transformToByteArray) throw new HttpError(502, 'Object storage read failed.', { code: 'S3_STORAGE_READ_FAILED' }); return Buffer.from(await result.Body.transformToByteArray()); },
    async createSignedUrl(bucket, key, expiresIn = 300) {
      assertObjectKey(key);
      assertBucket(bucket, environment);
      const seconds = Number(expiresIn);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new HttpError(400, 'Signed URL expiry is invalid.', { code: 'STORAGE_SIGNED_URL_EXPIRY_INVALID' });
      let getSignedUrl;
      try {
        ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
      } catch {
        throw new HttpError(503, 'Object storage provider is unavailable.', { code: 'S3_SIGNER_NOT_INSTALLED' });
      }
      return getSignedUrl(sdk.client, new sdk.GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: seconds });
    }
  });
}
module.exports = { PROVIDERS, providerConfig, bucketAllowlist, assertBucket, assertObjectKey, createS3ObjectStorage };
