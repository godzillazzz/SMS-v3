'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MIN_DIMENSION = 256;
const MAX_DIMENSION = 4096;
const MIME_BY_TYPE = new Map([['jpeg', 'image/jpeg'], ['png', 'image/png']]);

function detectedType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

function imageDimensions(buffer, type) {
  if (type === 'png') {
    if (buffer.length < 24) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (type === 'jpeg') {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      let marker = buffer[offset + 1];
      while (marker === 0xff) { offset += 1; marker = buffer[offset + 1]; }
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      if (offset + 4 > buffer.length) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) break;
      const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (sof && length >= 7) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      offset += 2 + length;
    }
  }
  return null;
}

function validateReferencePhoto(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new HttpError(400, 'Reference photo is required.', { code: 'REFERENCE_PHOTO_REQUIRED' });
  if (file.size > MAX_FILE_SIZE) throw new HttpError(400, 'รูปอ้างอิงต้องมีขนาดไม่เกิน 4 MB', { code: 'REFERENCE_PHOTO_TOO_LARGE' });
  const type = detectedType(file.buffer);
  if (!type || file.mimetype !== MIME_BY_TYPE.get(type)) throw new HttpError(415, 'Reference photo must be a valid JPEG or PNG image.', { code: 'REFERENCE_PHOTO_TYPE_INVALID' });
  const dimensions = imageDimensions(file.buffer, type);
  if (!dimensions) throw new HttpError(415, 'Reference photo dimensions could not be read.', { code: 'REFERENCE_PHOTO_DIMENSIONS_INVALID' });
  const { width, height } = dimensions;
  const ratio = width / height;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION || ratio < 0.5 || ratio > 2) throw new HttpError(400, 'รูปอ้างอิงต้องมีขนาดอย่างน้อย 256x256 และไม่เกิน 4096x4096 พิกเซล', { code: 'REFERENCE_PHOTO_DIMENSIONS_INVALID' });
  return { type, mimeType: MIME_BY_TYPE.get(type), width, height, checksum: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}

function safeName(name) {
  const normalized = String(name || 'reference-photo').replace(/[\\/\0<>:"|?*]/g, '_').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 255) || 'reference-photo';
}

function storageConfig(environment = process.env) {
  const url = environment.SUPABASE_URL;
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = environment.EMPLOYEE_REFERENCE_PHOTOS_BUCKET;
  if (!url || !serviceKey || !bucket) throw new HttpError(503, 'Employee reference photo storage is not configured.', { code: 'REFERENCE_PHOTO_STORAGE_NOT_CONFIGURED' });
  let storageOrigin;
  try { storageOrigin = new URL(url).origin; } catch { throw new HttpError(503, 'Employee reference photo storage is not configured.', { code: 'REFERENCE_PHOTO_STORAGE_NOT_CONFIGURED' }); }
  if (!/^https?:\/\//i.test(storageOrigin)) throw new HttpError(503, 'Employee reference photo storage is not configured.', { code: 'REFERENCE_PHOTO_STORAGE_NOT_CONFIGURED' });
  return { url: storageOrigin, serviceKey, bucket };
}

function createSupabaseEmployeeReferencePhotoStorage({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = () => storageConfig(environment);
  return {
    async put(objectKey, file) {
      const { url, serviceKey, bucket } = config();
      const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': file.mimetype, 'x-upsert': 'false' }, body: file.buffer });
      if (!response.ok) throw new HttpError(502, 'Reference photo upload failed.', { code: 'REFERENCE_PHOTO_STORAGE_UPLOAD_FAILED' });
      return { provider: 'supabase', bucket };
    },
    async remove(objectKey) {
      const { url, serviceKey, bucket } = config();
      const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
      if (response.status === 404) return;
      if (!response.ok) throw new HttpError(502, 'Reference photo cleanup failed.', { code: 'REFERENCE_PHOTO_STORAGE_DELETE_FAILED' });
    },
    async getBytes(objectKey) {
      const { url, serviceKey, bucket } = config();
      const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, { method: 'GET', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
      if (!response.ok) throw new HttpError(502, 'Reference photo read failed.', { code: 'REFERENCE_PHOTO_STORAGE_READ_FAILED' });
      const declaredSize = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_SIZE) throw new HttpError(502, 'Reference photo read failed.', { code: 'REFERENCE_PHOTO_STORAGE_READ_FAILED' });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_FILE_SIZE || !detectedType(buffer)) throw new HttpError(502, 'Reference photo read failed.', { code: 'REFERENCE_PHOTO_STORAGE_READ_FAILED' });
      return buffer;
    },
    async createSignedUrl(objectKey, expiresIn = 300) {
      const { url, serviceKey, bucket } = config();
      const response = await fetchImpl(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn }) });
      if (!response.ok) throw new HttpError(502, 'Reference photo viewer is temporarily unavailable.', { code: 'REFERENCE_PHOTO_SIGNED_URL_FAILED' });
      const body = await response.json();
      if (!body?.signedURL) throw new HttpError(502, 'Reference photo viewer is temporarily unavailable.', { code: 'REFERENCE_PHOTO_SIGNED_URL_FAILED' });
      return `${url}/storage/v1${body.signedURL}`;
    }
  };
}

module.exports = { MAX_FILE_SIZE, MIN_DIMENSION, MAX_DIMENSION, detectedType, imageDimensions, validateReferencePhoto, safeName, storageConfig, createSupabaseEmployeeReferencePhotoStorage };
