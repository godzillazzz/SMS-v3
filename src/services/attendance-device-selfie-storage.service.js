'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { detectedType } = require('./attachment-optimizer.service');

const MAX_BYTES = 1024 * 1024;
const RETENTION_DAYS = 365;
const MIME_BY_TYPE = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png' });

function http(status, code, message) { return new HttpError(status, message, { code }); }
function config(environment = process.env) {
  const urlRaw = String(environment.SUPABASE_URL || '').trim();
  const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = String(environment.ATTENDANCE_DEVICE_SELFIE_BUCKET || '').trim();
  let url = '';
  try { url = new URL(urlRaw).origin; } catch {}
  if (!url || !serviceKey || !/^[A-Za-z0-9._-]{1,255}$/.test(bucket)) {
    throw http(503, 'ATTENDANCE_SELFIE_STORAGE_NOT_CONFIGURED', 'Attendance device selfie storage is not configured.');
  }
  return { url, serviceKey, bucket };
}
function normalizeSelfie(selfie) {
  if (!selfie) return null;
  const mimeType = String(selfie.mimeType || selfie.mimetype || '').toLowerCase();
  let buffer = selfie.buffer;
  if (!Buffer.isBuffer(buffer) && typeof selfie.base64 === 'string') {
    try { buffer = Buffer.from(selfie.base64.replace(/^data:[^;]+;base64,/, ''), 'base64'); } catch {}
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw http(415, 'ATTENDANCE_SELFIE_TYPE_INVALID', 'Attendance selfie must be a JPEG or PNG image.');
  if (buffer.length > MAX_BYTES) throw http(413, 'ATTENDANCE_SELFIE_TOO_LARGE', 'Attendance selfie must not exceed 1 MB.');
  const type = detectedType(buffer);
  const detectedMime = MIME_BY_TYPE[type];
  if (!detectedMime || (mimeType && mimeType !== detectedMime)) throw http(415, 'ATTENDANCE_SELFIE_TYPE_INVALID', 'Attendance selfie must be a valid JPEG or PNG image.');
  return { buffer, mimeType: detectedMime, type, sizeBytes: buffer.length, checksum: crypto.createHash('sha256').update(buffer).digest('hex') };
}
function createSupabaseAttendanceDeviceSelfieStorage({ environment = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Attendance selfie storage requires fetch().');
  return {
    async put({ employeeId, captureId, selfie }) {
      const { url, serviceKey, bucket } = config(environment);
      const file = normalizeSelfie(selfie);
      const objectKey = `attendance-selfie/${employeeId}/${captureId}.${file.type === 'png' ? 'png' : 'jpg'}`;
      const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': file.mimeType, 'x-upsert': 'false' }, body: file.buffer
      });
      if (!response.ok) throw http(502, 'ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED', 'Attendance selfie upload failed.');
      return { ...file, provider: 'supabase', bucket, objectKey };
    },
    async remove({ objectKey }) {
      const { url, serviceKey, bucket } = config(environment);
      const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${String(objectKey).split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
      if (!response.ok && response.status !== 404) throw http(502, 'ATTENDANCE_SELFIE_STORAGE_DELETE_FAILED', 'Attendance selfie cleanup failed.');
    }
  };
}

module.exports = { MAX_BYTES, RETENTION_DAYS, config, normalizeSelfie, createSupabaseAttendanceDeviceSelfieStorage };
