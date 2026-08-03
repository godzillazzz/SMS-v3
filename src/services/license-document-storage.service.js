const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MIME_BY_SIGNATURE = new Map([
  ['pdf', 'application/pdf'], ['jpeg', 'image/jpeg'], ['png', 'image/png']
]);

function detectedType(buffer) {
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

function validateUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw new HttpError(400, 'License document is required.');
  if (file.size > MAX_FILE_SIZE) throw new HttpError(400, 'ไฟล์ต้องมีขนาดไม่เกิน 2 MB');
  const type = detectedType(file.buffer);
  if (!type || file.mimetype !== MIME_BY_SIGNATURE.get(type)) throw new HttpError(415, 'License document must be a valid PDF, JPEG, or PNG.');
  return { mimeType: MIME_BY_SIGNATURE.get(type), checksum: crypto.createHash('sha256').update(file.buffer).digest('hex') };
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

module.exports = { MAX_FILE_SIZE, validateUpload, safeName, storageConfig, createSupabaseLicenseDocumentStorage };
