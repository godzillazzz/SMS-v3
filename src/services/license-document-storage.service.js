'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { ATTACHMENT_PROFILES, detectedType, hasPdfEof, MIME_BY_TYPE } = require('./attachment-optimizer.service');

const MAX_FILE_SIZE = ATTACHMENT_PROFILES.DOCUMENT.pdfHardLimitBytes;
const MAX_IMAGE_FILE_SIZE = ATTACHMENT_PROFILES.DOCUMENT.imageHardLimitBytes;

function validateUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new HttpError(400, 'License document is required.');
  const type = detectedType(file.buffer);
  const mimeType = type ? MIME_BY_TYPE[type] : null;
  if (!type || !ATTACHMENT_PROFILES.DOCUMENT.allowedTypes.includes(type) || file.mimetype !== mimeType || (type === 'pdf' && !hasPdfEof(file.buffer))) {
    throw new HttpError(415, 'License document must be a valid PDF, JPEG, or PNG.');
  }
  const hardLimit = type === 'pdf' ? MAX_FILE_SIZE : MAX_IMAGE_FILE_SIZE;
  if (file.buffer.length > hardLimit) {
    throw new HttpError(400, type === 'pdf' ? 'ไฟล์ PDF ต้องมีขนาดไม่เกิน 1 MB' : 'รูปเอกสารต้องมีขนาดไม่เกิน 500 KB');
  }
  return { type, mimeType, checksum: crypto.createHash('sha256').update(file.buffer).digest('hex') };
}

function safeName(name) {
  const normalized = String(name || 'license-document').replace(/[\\/\0<>:"|?*]/g, '_').replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 255) || 'license-document';
}

function storageConfig(environment = process.env) {
  const url = environment.SUPABASE_URL;
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = environment.LICENSE_DOCUMENTS_BUCKET;
  if (!url || !serviceKey || !bucket) throw new HttpError(503, 'License document storage is not configured.');
  return { url: url.replace(/\/$/, ''), serviceKey, bucket };
}

function createSupabaseLicenseDocumentStorage({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = () => storageConfig(environment);
  return {
    async put(objectKey, file) {
      const { url, serviceKey, bucket } = config();
      const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': file.mimetype, 'x-upsert': 'false' }, body: file.buffer });
      if (!response.ok) throw new HttpError(502, 'License document upload failed.');
      return { provider: 'supabase', bucket };
    },
    async remove(objectKey) {
      const { url, serviceKey, bucket } = config();
      const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
      if (!response.ok) throw new HttpError(502, 'License document cleanup failed.');
    },
    async createSignedUrl(objectKey, expiresIn = 600) {
      const { url, serviceKey, bucket } = config();
      const response = await fetchImpl(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn }) });
      if (!response.ok) throw new HttpError(502, 'License document viewer is temporarily unavailable.');
      const body = await response.json();
      if (!body?.signedURL) throw new HttpError(502, 'License document viewer is temporarily unavailable.');
      return `${url}/storage/v1${body.signedURL}`;
    }
  };
}

module.exports = { MAX_FILE_SIZE, MAX_IMAGE_FILE_SIZE, validateUpload, safeName, storageConfig, createSupabaseLicenseDocumentStorage };
