'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { scopeForActor } = require('./attendance-supervisor.service');

const EVIDENCE_STORAGE_STATUS = Object.freeze({ STORED: 'STORED', NOT_STORED: 'NOT_STORED', PURGED: 'PURGED' });
const ATTENDANCE_EVIDENCE_RETENTION_DAYS = 365;
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);

function http(statusCode, code, message) { return new HttpError(statusCode, message, { code }); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function safeErrorCode(error) { return String(error?.details?.code || error?.code || error?.name || 'ATTENDANCE_EVIDENCE_STORAGE_FAILED').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80); }
function retentionUntil(capturedAt) { return new Date(capturedAt.getTime() + ATTENDANCE_EVIDENCE_RETENTION_DAYS * 86400000); }
function safeEvidenceMetadata(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id || null,
    storageStatus: row.purgedAt ? EVIDENCE_STORAGE_STATUS.PURGED : (row.storageProvider ? EVIDENCE_STORAGE_STATUS.STORED : EVIDENCE_STORAGE_STATUS.NOT_STORED),
    stored: Boolean(row.storageProvider && !row.purgedAt),
    mimeType: row.mimeType || null,
    sizeBytes: Number(row.sizeBytes || 0),
    capturedAt: row.capturedAt || null,
    retentionUntil: row.retentionUntil || null,
    purgedAt: row.purgedAt || null
  });
}

function createNoopAttendanceFaceEvidenceStorage() {
  return Object.freeze({
    provider: 'none',
    storesBytes: false,
    async store() { return Object.freeze({ storageStatus: EVIDENCE_STORAGE_STATUS.NOT_STORED, stored: false }); },
    async remove() { return Object.freeze({ storageStatus: EVIDENCE_STORAGE_STATUS.NOT_STORED, purgedAt: null }); },
    async view() { throw http(503, 'ATTENDANCE_EVIDENCE_STORAGE_NOT_CONFIGURED', 'Attendance evidence storage is not configured.'); },
    async purgeExpired() { return { inspected: 0, purged: 0, failed: 0 }; }
  });
}

function assertAttendanceFaceEvidenceStorage(storage) {
  if (!storage || typeof storage.store !== 'function' || typeof storage.remove !== 'function') {
    throw new TypeError('Attendance face evidence storage adapter must implement store() and remove().');
  }
  return storage;
}

function storageConfig(environment = process.env) {
  const rawUrl = String(environment.SUPABASE_URL || '').trim();
  const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = String(environment.ATTENDANCE_FACE_EVIDENCE_BUCKET || '').trim();
  let url;
  try { url = new URL(rawUrl).origin; } catch { url = ''; }
  if (!url || !serviceKey || !/^[A-Za-z0-9._-]{1,100}$/.test(bucket)) {
    throw http(503, 'ATTENDANCE_EVIDENCE_STORAGE_NOT_CONFIGURED', 'Private Attendance evidence storage is not configured.');
  }
  return { url, serviceKey, bucket };
}

function createSupabaseAttendanceFaceEvidenceStorage({
  environment = process.env,
  prisma = prismaDefault,
  audit = auditDefault,
  fetchImpl = globalThis.fetch,
  clock = () => new Date(),
  randomUUID = crypto.randomUUID
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('Attendance evidence storage requires fetch().');
  const config = () => storageConfig(environment);

  async function storagePut(objectKey, bytes, mimeType) {
    const { url, serviceKey, bucket } = config();
    const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': mimeType, 'x-upsert': 'false' },
      body: bytes
    });
    if (!response.ok) throw http(502, 'ATTENDANCE_EVIDENCE_STORAGE_UPLOAD_FAILED', 'Attendance evidence upload failed.');
    return { provider: 'supabase', bucket };
  }

  async function storageRemove(objectKey) {
    const { url, serviceKey, bucket } = config();
    const response = await fetchImpl(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey }
    });
    if (!response.ok && response.status !== 404) throw http(502, 'ATTENDANCE_EVIDENCE_STORAGE_DELETE_FAILED', 'Attendance evidence cleanup failed.');
  }

  async function signedUrl(objectKey, expiresIn = 60) {
    const { url, serviceKey, bucket } = config();
    const response = await fetchImpl(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn })
    });
    if (!response.ok) throw http(502, 'ATTENDANCE_EVIDENCE_SIGNED_URL_FAILED', 'Attendance evidence viewer is temporarily unavailable.');
    const body = await response.json().catch(() => null);
    if (!body?.signedURL) throw http(502, 'ATTENDANCE_EVIDENCE_SIGNED_URL_FAILED', 'Attendance evidence viewer is temporarily unavailable.');
    return `${url}/storage/v1${body.signedURL}`;
  }

  async function store({ sessionId, employeeId, referencePhotoId, livePhotoBytes, mimeType = 'image/jpeg', capturedAt = clock(), verificationPassed = false } = {}) {
    if (verificationPassed !== true) throw http(409, 'ATTENDANCE_EVIDENCE_VERIFICATION_REQUIRED', 'Attendance evidence may be stored only after successful face verification.');
    if (!Buffer.isBuffer(livePhotoBytes) || livePhotoBytes.length < 64 || livePhotoBytes.length > MAX_EVIDENCE_BYTES || !ALLOWED_MIME.has(mimeType)) {
      throw http(400, 'ATTENDANCE_EVIDENCE_INVALID', 'Attendance evidence image is invalid.');
    }
    const captured = capturedAt instanceof Date ? new Date(capturedAt) : new Date(capturedAt);
    if (Number.isNaN(captured.getTime())) throw http(400, 'ATTENDANCE_EVIDENCE_CAPTURED_AT_INVALID', 'Attendance evidence capture time is invalid.');

    const expiry = retentionUntil(captured);
    const checksum = sha256(livePhotoBytes);
    const extension = mimeType === 'image/png' ? 'png' : 'jpg';
    const objectKey = `attendance-face-evidence/${employeeId}/${captured.toISOString().slice(0, 7)}/${sessionId}-${randomUUID()}.${extension}`;
    const stored = await storagePut(objectKey, livePhotoBytes, mimeType);

    let row;
    try {
      row = await prisma.attendanceEvidence.create({
        data: {
          faceVerificationSessionId: sessionId,
          employeeId,
          referencePhotoId,
          storageProvider: stored.provider,
          storageBucket: stored.bucket,
          storageObjectKey: objectKey,
          mimeType,
          sizeBytes: livePhotoBytes.length,
          checksum,
          capturedAt: captured,
          retentionUntil: expiry
        }
      });
      await audit.log({
        actorUserId: null,
        action: 'CREATE',
        entityType: 'AttendanceEvidence',
        entityId: row.id,
        metadata: { event: 'PRIVATE_EVIDENCE_STORED', employeeId, faceVerificationSessionId: sessionId, sizeBytes: livePhotoBytes.length, retentionUntil: expiry }
      });
    } catch (error) {
      await storageRemove(objectKey).catch(() => undefined);
      throw error?.code === 'P2002'
        ? http(409, 'ATTENDANCE_EVIDENCE_STATE_CONFLICT', 'Attendance evidence already exists for this verification session.')
        : error;
    }
    return safeEvidenceMetadata(row);
  }

  async function purgeRow(row, { actorUserId = null, reason = 'RETENTION_EXPIRED' } = {}) {
    if (!row || row.purgedAt) return { purged: Boolean(row?.purgedAt), failed: false, evidence: safeEvidenceMetadata(row) };
    const now = clock();
    await prisma.attendanceEvidence.update({ where: { id: row.id }, data: { purgeRequestedAt: row.purgeRequestedAt || now } }).catch(() => undefined);
    try {
      await storageRemove(row.storageObjectKey);
      const updated = await prisma.attendanceEvidence.update({
        where: { id: row.id },
        data: { purgedAt: now, purgeAttempts: { increment: 1 }, purgeLastErrorAt: null, purgeLastErrorCode: null }
      });
      await audit.log({
        actorUserId,
        action: 'DELETE',
        entityType: 'AttendanceEvidence',
        entityId: row.id,
        metadata: { event: 'PRIVATE_EVIDENCE_PURGED', employeeId: row.employeeId, faceVerificationSessionId: row.faceVerificationSessionId, reason }
      });
      return { purged: true, failed: false, evidence: safeEvidenceMetadata(updated) };
    } catch (error) {
      await prisma.attendanceEvidence.update({
        where: { id: row.id },
        data: { purgeAttempts: { increment: 1 }, purgeLastErrorAt: now, purgeLastErrorCode: safeErrorCode(error) }
      }).catch(() => undefined);
      await audit.log({
        actorUserId,
        action: 'UPDATE',
        entityType: 'AttendanceEvidence',
        entityId: row.id,
        metadata: { event: 'PRIVATE_EVIDENCE_PURGE_RETRY_REQUIRED', employeeId: row.employeeId, reason, errorCode: safeErrorCode(error) }
      }).catch(() => undefined);
      return { purged: false, failed: true, evidence: safeEvidenceMetadata(row) };
    }
  }

  async function remove({ evidenceId = null, faceVerificationSessionId = null, reason = 'COMPENSATING_DELETE', actorUserId = null } = {}) {
    const where = evidenceId ? { id: evidenceId } : faceVerificationSessionId ? { faceVerificationSessionId } : null;
    if (!where) throw new TypeError('Attendance evidence remove() requires evidenceId or faceVerificationSessionId.');
    const row = await prisma.attendanceEvidence.findUnique({ where });
    if (!row) return { purged: false, failed: false, missing: true };
    return purgeRow(row, { actorUserId, reason });
  }

  async function view({ id, actor } = {}) {
    const scope = scopeForActor(actor, {});
    const row = await prisma.attendanceEvidence.findUnique({
      where: { id },
      include: { employee: { select: { id: true, department: true } } }
    });
    if (!row) throw http(404, 'ATTENDANCE_EVIDENCE_NOT_FOUND', 'Attendance evidence was not found.');
    if (scope.role === 'MANAGER' && row.employee?.department !== scope.department) {
      throw http(403, 'ATTENDANCE_SUPERVISOR_SCOPE_FORBIDDEN', 'Manager cannot access another Department Attendance scope.');
    }
    const now = clock();
    if (row.purgedAt || row.purgeRequestedAt || row.retentionUntil <= now) {
      throw http(410, 'ATTENDANCE_EVIDENCE_NOT_VIEWABLE', 'Attendance evidence has expired or is no longer viewable.');
    }
    await audit.log({
      actorUserId: actor?.sub || null,
      action: 'UPDATE',
      entityType: 'AttendanceEvidence',
      entityId: row.id,
      metadata: { event: 'PRIVATE_EVIDENCE_VIEW', employeeId: row.employeeId, faceVerificationSessionId: row.faceVerificationSessionId }
    });
    return { id: row.id, url: await signedUrl(row.storageObjectKey, 60), mimeType: row.mimeType, capturedAt: row.capturedAt, retentionUntil: row.retentionUntil };
  }

  async function purgeExpired({ limit = 100, actorUserId = null } = {}) {
    const now = clock();
    const rows = await prisma.attendanceEvidence.findMany({
      where: { retentionUntil: { lte: now }, purgedAt: null },
      orderBy: [{ retentionUntil: 'asc' }, { id: 'asc' }],
      take: Math.max(1, Math.min(Number(limit) || 100, 500))
    });
    let purged = 0; let failed = 0;
    for (const row of rows) {
      const result = await purgeRow(row, { actorUserId, reason: 'RETENTION_EXPIRED' });
      if (result.purged) purged += 1;
      if (result.failed) failed += 1;
    }
    return { inspected: rows.length, purged, failed, retentionDays: ATTENDANCE_EVIDENCE_RETENTION_DAYS };
  }

  return Object.freeze({ provider: 'supabase', storesBytes: true, store, remove, view, purgeExpired });
}

module.exports = {
  EVIDENCE_STORAGE_STATUS,
  ATTENDANCE_EVIDENCE_RETENTION_DAYS,
  MAX_EVIDENCE_BYTES,
  safeEvidenceMetadata,
  storageConfig,
  createNoopAttendanceFaceEvidenceStorage,
  createSupabaseAttendanceFaceEvidenceStorage,
  assertAttendanceFaceEvidenceStorage
};
