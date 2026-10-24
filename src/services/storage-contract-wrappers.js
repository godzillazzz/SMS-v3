'use strict';

const HttpError = require('../utils/http-error');
const crypto = require('node:crypto');
const { createS3ObjectStorage } = require('./object-storage-provider');
const { scopeForActor } = require('./attendance-supervisor.service');

const MAX_EVIDENCE_BYTES = 1024 * 1024;
const EVIDENCE_RETENTION_DAYS = 365;
const ALLOWED_EVIDENCE_MIME = new Set(['image/jpeg', 'image/png']);
function fail(code, message) { throw new HttpError(503, message, { code }); }
function http(status, code, message) { throw new HttpError(status, message, { code }); }
function errorCode(error) { return String(error?.details?.code || error?.code || error?.name || 'STORAGE_OPERATION_FAILED').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80); }
function boundedLimit(value, fallback, maximum) { return Math.max(1, Math.min(Number(value) || fallback, maximum)); }
function requireBackend(backend) {
  if (!backend || typeof backend.put !== 'function' || typeof backend.remove !== 'function' || typeof backend.get !== 'function' || typeof backend.createSignedUrl !== 'function') fail('STORAGE_PROVIDER_UNAVAILABLE', 'Object storage provider is unavailable.');
  return backend;
}
function bucket(environment, name) {
  const value = String(environment[name] || '').trim();
  if (!value) fail('STORAGE_BUCKET_NOT_CONFIGURED', 'Object storage bucket is not configured.');
  return value;
}
function createS3ContractWrappers({ environment = process.env, backend = createS3ObjectStorage({ environment }), prisma = null, audit = null, clock = () => new Date() } = {}) {
  const buckets = {
    selfie: bucket(environment, 'ATTENDANCE_DEVICE_SELFIE_BUCKET'),
    evidence: bucket(environment, 'ATTENDANCE_FACE_EVIDENCE_BUCKET'),
    reference: bucket(environment, 'EMPLOYEE_REFERENCE_PHOTOS_BUCKET'),
    license: bucket(environment, 'LICENSE_DOCUMENTS_BUCKET')
  };
  const store = requireBackend(backend);
  const put = async (kind, key, file) => store.put(buckets[kind], key, file);
  const remove = async (kind, key) => store.remove(buckets[kind], key);
  const sign = async (kind, key, expiresIn) => store.createSignedUrl(buckets[kind], key, expiresIn);
  const selfie = Object.freeze({
    provider: 's3',
    async put({ employeeId, captureId, selfie: file }) {
      const secret = String(environment.SELFIE_PATH_SECRET || '');
      const identity = secret ? crypto.createHmac('sha256', secret).update(String(employeeId)).digest('hex') : String(employeeId);
      return put('selfie', `attendance-selfie/${identity}/${captureId}`, file);
    },
    async remove({ objectKey }) { return remove('selfie', objectKey); },
    async listObjects() { if (typeof store.listObjects !== 'function') fail('STORAGE_LIST_UNAVAILABLE', 'Object storage listing is unavailable.'); return store.listObjects(buckets.selfie, 'attendance-selfie/'); },
    async reconcileOrphans({ olderThanMs = 60 * 60 * 1000, limit = 1000, now = clock() } = {}) {
      if (!prisma?.attendanceDeviceSelfie?.findMany) fail('STORAGE_RECONCILE_UNAVAILABLE', 'Attendance selfie reconciliation is unavailable.');
      const listing = await selfie.listObjects(); const objects = (listing.objects || []).slice(0, boundedLimit(limit, 1000, 1000));
      const threshold = now.getTime() - Math.max(60 * 1000, Number(olderThanMs) || 0);
      const candidates = objects.filter((item) => item.updatedAt && Date.parse(item.updatedAt) <= threshold);
      const rows = await prisma.attendanceDeviceSelfie.findMany({ where: { storageObjectKey: { in: candidates.map((item) => item.objectKey || item.key) } }, select: { storageObjectKey: true } });
      const known = new Set(rows.map((row) => row.storageObjectKey)); let deleted = 0; let failed = 0;
      for (const item of candidates) { const key = item.objectKey || item.key; if (known.has(key)) continue; try { await remove('selfie', key); deleted += 1; } catch (error) { failed += 1; await audit?.log?.({ actorUserId: null, action: 'DELETE', entityType: 'AttendanceDeviceSelfie', entityId: null, metadata: { event: 'ATTENDANCE_SELFIE_ORPHAN_PURGE_FAILED', objectKey: key, errorCode: errorCode(error) } }).catch(() => undefined); } }
      const result = { scanned: objects.length, deleted, failed, truncated: Boolean(listing.truncated) || (listing.objects || []).length > objects.length };
      await audit?.log?.({ actorUserId: null, action: 'DELETE', entityType: 'AttendanceDeviceSelfie', entityId: null, metadata: { event: 'ATTENDANCE_SELFIE_ORPHAN_RECONCILED', ...result } }).catch(() => undefined); return result;
    },
    async purgeExpiredSelfies({ now = clock(), limit = 100 } = {}) {
      if (!prisma?.attendanceDeviceSelfie?.findMany) return { inspected: 0, purged: 0, failed: 0 };
      const rows = await prisma.attendanceDeviceSelfie.findMany({ where: { retentionUntil: { lt: now }, purgedAt: null }, orderBy: [{ retentionUntil: 'asc' }, { id: 'asc' }], take: boundedLimit(limit, 100, 500) }); let purged = 0; let failed = 0;
      for (const row of rows) { try { await remove('selfie', row.storageObjectKey); await prisma.attendanceDeviceSelfie.update({ where: { id: row.id }, data: { purgedAt: now } }); purged += 1; await audit?.log?.({ actorUserId: null, action: 'DELETE', entityType: 'AttendanceDeviceSelfie', entityId: row.id, metadata: { event: 'ATTENDANCE_SELFIE_PURGED', reason: 'RETENTION_EXPIRED' } }).catch(() => undefined); } catch (error) { failed += 1; await audit?.log?.({ actorUserId: null, action: 'UPDATE', entityType: 'AttendanceDeviceSelfie', entityId: row.id, metadata: { event: 'ATTENDANCE_SELFIE_PURGE_RETRY_REQUIRED', errorCode: errorCode(error) } }).catch(() => undefined); } }
      return { inspected: rows.length, purged, failed };
    }
  });
  const evidence = Object.freeze({
    provider: 's3', storesBytes: true,
    async store({ employeeId, sessionId, referencePhotoId, livePhotoBytes, mimeType = 'image/jpeg', capturedAt = clock(), verificationPassed = false }) {
      if (verificationPassed !== true) http(409, 'ATTENDANCE_EVIDENCE_VERIFICATION_REQUIRED', 'Attendance evidence may be stored only after successful face verification.');
      if (!Buffer.isBuffer(livePhotoBytes) || livePhotoBytes.length < 64 || livePhotoBytes.length > MAX_EVIDENCE_BYTES || !ALLOWED_EVIDENCE_MIME.has(mimeType)) http(400, 'ATTENDANCE_EVIDENCE_INVALID', 'Attendance evidence image is invalid.');
      const captured = new Date(capturedAt); if (Number.isNaN(captured.getTime())) http(400, 'ATTENDANCE_EVIDENCE_CAPTURED_AT_INVALID', 'Attendance evidence capture time is invalid.');
      const retentionUntil = new Date(captured.getTime() + EVIDENCE_RETENTION_DAYS * 86400000); const objectKey = `attendance-face-evidence/${employeeId}/${captured.toISOString().slice(0, 7)}/${sessionId}.${mimeType === 'image/png' ? 'png' : 'jpg'}`; const checksum = crypto.createHash('sha256').update(livePhotoBytes).digest('hex');
      const stored = await put('evidence', objectKey, { buffer: livePhotoBytes, mimetype: mimeType }); if (stored.sha256 !== checksum) fail('STORAGE_CHECKSUM_UNCONFIRMED', 'Object storage checksum could not be confirmed.');
      const row = prisma?.attendanceEvidence?.create ? await prisma.attendanceEvidence.create({ data: { faceVerificationSessionId: sessionId, employeeId, referencePhotoId, storageProvider: stored.provider || 's3', storageBucket: buckets.evidence, storageObjectKey: objectKey, mimeType, sizeBytes: livePhotoBytes.length, checksum, capturedAt: captured, retentionUntil } }) : null;
      await audit?.log?.({ actorUserId: null, action: 'CREATE', entityType: 'AttendanceEvidence', entityId: row?.id || null, metadata: { event: 'PRIVATE_EVIDENCE_STORED', employeeId, sessionId, retentionUntil } }).catch(() => undefined);
      return { storageStatus: 'STORED', stored: true, storageProvider: stored.provider || 's3', storageBucket: buckets.evidence, storageObjectKey: objectKey, checksum, mimeType, sizeBytes: livePhotoBytes.length, capturedAt: captured, retentionUntil, id: row?.id || null };
    },
    async remove({ evidenceId, objectKey }) { if (evidenceId && prisma?.attendanceEvidence?.findUnique) { const row = await prisma.attendanceEvidence.findUnique({ where: { id: evidenceId } }); if (!row) return { missing: true }; objectKey = row.storageObjectKey; } return remove('evidence', objectKey); },
    async view({ id, actor }) {
      if (!actor?.sub || !id || !prisma?.attendanceEvidence?.findUnique) throw new HttpError(403, 'Attendance evidence authorization is required.', { code: 'ATTENDANCE_EVIDENCE_FORBIDDEN' });
      const row = await prisma.attendanceEvidence.findUnique({ where: { id }, include: { employee: { select: { id: true, department: true } } } }); if (!row) http(404, 'ATTENDANCE_EVIDENCE_NOT_FOUND', 'Attendance evidence was not found.');
      const scope = scopeForActor(actor, {});
      if (scope.role === 'VIEWER' && row.employeeId !== actor.employeeAuthority?.id) http(403, 'ATTENDANCE_EVIDENCE_FORBIDDEN', 'Attendance evidence is outside the actor scope.');
      if (['MANAGER', 'SUPERVISOR'].includes(scope.role)) {
        const department = actor.department || actor.employeeAuthority?.department;
        if (!department || row.employee?.department !== department) http(403, 'ATTENDANCE_EVIDENCE_FORBIDDEN', 'Attendance evidence is outside the actor scope.');
      }
      const now = clock(); if (row.purgedAt || row.purgeRequestedAt || !row.retentionUntil || new Date(row.retentionUntil) <= now) http(410, 'ATTENDANCE_EVIDENCE_NOT_VIEWABLE', 'Attendance evidence has expired or is no longer viewable.');
      await audit?.log?.({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'AttendanceEvidence', entityId: row.id, metadata: { event: 'PRIVATE_EVIDENCE_VIEW', employeeId: row.employeeId } }).catch(() => undefined);
      return { id: row.id, url: await sign('evidence', row.storageObjectKey, 60), storageProvider: 's3', mimeType: row.mimeType, capturedAt: row.capturedAt, retentionUntil: row.retentionUntil };
    },
    async purgeExpired({ limit = 100, actorUserId = null } = {}) {
      if (!prisma?.attendanceEvidence?.findMany) return { inspected: 0, purged: 0, failed: 0 };
      const now = clock(); const rows = await prisma.attendanceEvidence.findMany({ where: { retentionUntil: { lte: now }, purgedAt: null }, orderBy: [{ retentionUntil: 'asc' }, { id: 'asc' }], take: boundedLimit(limit, 100, 500) }); let purged = 0; let failed = 0;
      for (const row of rows) { try { await remove('evidence', row.storageObjectKey); await prisma.attendanceEvidence.update({ where: { id: row.id }, data: { purgedAt: now, purgeAttempts: { increment: 1 }, purgeLastErrorAt: null, purgeLastErrorCode: null } }); purged += 1; await audit?.log?.({ actorUserId, action: 'DELETE', entityType: 'AttendanceEvidence', entityId: row.id, metadata: { event: 'PRIVATE_EVIDENCE_PURGED', reason: 'RETENTION_EXPIRED' } }).catch(() => undefined); } catch (error) { failed += 1; await prisma.attendanceEvidence.update?.({ where: { id: row.id }, data: { purgeAttempts: { increment: 1 }, purgeLastErrorAt: now, purgeLastErrorCode: errorCode(error) } }).catch(() => undefined); } }
      return { inspected: rows.length, purged, failed, retentionDays: EVIDENCE_RETENTION_DAYS };
    }
  });
  const reference = Object.freeze({
    provider: 's3',
    async put(objectKey, file) { return put('reference', objectKey, file); },
    async remove(objectKey) { return remove('reference', objectKey); },
    async getBytes(objectKey) { return store.get(buckets.reference, objectKey); },
    async createSignedUrl(objectKey, expiresIn = 60) { return sign('reference', objectKey, expiresIn); }
  });
  const license = Object.freeze({
    provider: 's3',
    async put(objectKey, file) { return put('license', objectKey, file); },
    async remove(objectKey) { return remove('license', objectKey); },
    async createSignedUrl(objectKey, expiresIn = 600) { return sign('license', objectKey, expiresIn); }
  });
  return Object.freeze({ selfie, evidence, reference, license, buckets, storageProvider: 's3' });
}
function selectContractStorage({ environment = process.env, supabaseFactory, backend, contract } = {}) {
  const provider = String(environment.STORAGE_PROVIDER || 'supabase').toLowerCase();
  if (provider === 'supabase') return supabaseFactory();
  if (provider !== 's3') fail('STORAGE_PROVIDER_INVALID', 'Object storage provider is unavailable.');
  if ((environment.NODE_ENV === 'production' || environment.VERCEL_ENV === 'production') && environment.STORAGE_S3_PRODUCTION_APPROVED !== 'true') fail('S3_PRODUCTION_NOT_APPROVED', 'S3 storage is not approved for Production.');
  const wrappers = createS3ContractWrappers({ environment, backend });
  if (!wrappers[contract]) fail('STORAGE_CONTRACT_INVALID', 'Storage contract is unavailable.');
  return wrappers[contract];
}
module.exports = { createS3ContractWrappers, selectContractStorage };
