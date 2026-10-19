'use strict';

const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { detectedType } = require('./attachment-optimizer.service');

const MAX_BYTES = 1024 * 1024;
const RETENTION_DAYS = 365;
const MIME_BY_TYPE = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png' });
const SELFIE_PATH_SECRET_ENV = 'SELFIE_PATH_SECRET';
const MAX_PURGE_LIMIT = 500;

function http(status, code, message) { return new HttpError(status, message, { code }); }
function config(environment = process.env) {
  const urlRaw = String(environment.SUPABASE_URL || '').trim();
  const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = String(environment.ATTENDANCE_DEVICE_SELFIE_BUCKET || '').trim();
  let url = '';
  try { url = new URL(urlRaw).origin; } catch {}
  const pathSecret = String(environment[SELFIE_PATH_SECRET_ENV] || '').trim();
  if (!url || !serviceKey || !/^[A-Za-z0-9._-]{1,255}$/.test(bucket) || !pathSecret) {
    throw http(503, 'ATTENDANCE_SELFIE_STORAGE_NOT_CONFIGURED', 'Attendance device selfie storage is not configured.');
  }
  return { url, serviceKey, bucket, pathSecret };
}

function selfiePathHash(employeeId, pathSecret) {
  return crypto.createHmac('sha256', pathSecret).update(String(employeeId), 'utf8').digest('hex');
}

function objectPath(url, bucket, objectKey) {
  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${String(objectKey).split('/').map(encodeURIComponent).join('/')}`;
}

function safeLog(logger, event, metadata) {
  try { (logger || console).warn(event, metadata); } catch {}
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
function createSupabaseAttendanceDeviceSelfieStorage({ environment = process.env, fetchImpl = globalThis.fetch, prisma = null, audit = null, logger = console, clock = () => new Date() } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Attendance selfie storage requires fetch().');
  let privateChecked = false;
  async function assertPrivate() {
    if (privateChecked) return;
    const { url, serviceKey, bucket } = config(environment);
    const response = await fetchImpl(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.public !== false) throw http(503, 'ATTENDANCE_SELFIE_BUCKET_NOT_PRIVATE', 'Attendance selfie storage bucket must be private.');
    privateChecked = true;
  }
  async function remove({ objectKey }) {
    const { url, serviceKey, bucket } = config(environment);
    const response = await fetchImpl(objectPath(url, bucket, objectKey), { method: 'DELETE', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
    if (!response.ok && response.status !== 404) throw http(502, 'ATTENDANCE_SELFIE_STORAGE_DELETE_FAILED', 'Attendance selfie cleanup failed.');
  }
  async function put({ employeeId, captureId, selfie }) {
    await assertPrivate();
    const { url, serviceKey, bucket, pathSecret } = config(environment);
    const file = normalizeSelfie(selfie);
    const random = crypto.randomBytes(4).toString('hex');
    const objectKey = `attendance-selfie/${selfiePathHash(employeeId, pathSecret)}/${captureId}-${random}.${file.type === 'png' ? 'png' : 'jpg'}`;
    const response = await fetchImpl(objectPath(url, bucket, objectKey), { method: 'POST', headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': file.mimeType, 'x-upsert': 'false' }, body: file.buffer });
    if (!response.ok) throw http(502, 'ATTENDANCE_SELFIE_STORAGE_UPLOAD_FAILED', 'Attendance selfie upload failed.');
    return { ...file, provider: 'supabase', bucket, objectKey };
  }
  async function purgeExpiredSelfies({ now = clock(), limit = 100 } = {}) {
    if (!prisma?.attendanceDeviceSelfie) return { inspected: 0, purged: 0, failed: 0 };
    const rows = await prisma.attendanceDeviceSelfie.findMany({ where: { retentionUntil: { lt: now }, purgedAt: null }, orderBy: [{ retentionUntil: 'asc' }, { id: 'asc' }], take: Math.max(1, Math.min(Number(limit) || 100, MAX_PURGE_LIMIT)) });
    let purged = 0; let failed = 0;
    for (const row of rows) {
      try { await remove({ objectKey: row.storageObjectKey }); await prisma.attendanceDeviceSelfie.update({ where: { id: row.id }, data: { purgedAt: now } }); purged += 1; await audit?.log({ actorUserId: null, action: 'DELETE', entityType: 'AttendanceDeviceSelfie', entityId: row.id, metadata: { event: 'ATTENDANCE_SELFIE_PURGED', employeeId: row.employeeId, reason: 'RETENTION_EXPIRED' } }); }
      catch (error) { failed += 1; safeLog(logger, 'ATTENDANCE_SELFIE_ORPHAN_CLEANUP', { objectKey: row.storageObjectKey, success: false, errorCode: error?.details?.code || error?.code || 'UNKNOWN' }); }
    }
    return { inspected: rows.length, purged, failed };
  }
  return { put, remove, purgeExpiredSelfies, assertPrivate };
}

module.exports = { MAX_BYTES, RETENTION_DAYS, config, normalizeSelfie, selfiePathHash, createSupabaseAttendanceDeviceSelfieStorage };
