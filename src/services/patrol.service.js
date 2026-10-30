'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { detectedType } = require('./attachment-optimizer.service');

const PATROL_QR_PREFIX = 'SMSPATROL1:';
const MAX_PHOTO_BYTES = 1024 * 1024;
const MAX_REPORT_DAYS = 62;
const REPORT_SCAN_LIMIT = 5000;
const MIME_BY_TYPE = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png' });
const REPORT_ROLES = new Set(['ADMIN', 'MANAGER', 'SUPERVISOR']);
// Owner design (30 Oct 2026): one patrol day = 07:00–07:00 Asia/Bangkok, 8 rounds x 3 hours.
const ROUNDS_PER_DAY = 8;
const ROUND_HOURS = 3;
const DAY_START_HOUR = 7;
const BANGKOK_OFFSET_MS = 7 * 3600000;
const HOUR_MS = 3600000;

function http(statusCode, code, message) { return new HttpError(statusCode, message, { code }); }

function bangkokWorkDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function parseDate(value, code = 'PATROL_DATE_INVALID') {
  const text = String(value || '');
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw http(400, code, 'Patrol date is invalid.');
  return date;
}

function dateRange(from, to) {
  const start = parseDate(from); const end = parseDate(to);
  if (start > end) throw http(400, 'PATROL_RANGE_INVALID', 'Patrol report start date must not be after end date.');
  const days = Math.round((end - start) / 86400000) + 1;
  if (days > MAX_REPORT_DAYS) throw http(400, 'PATROL_RANGE_TOO_LARGE', `Patrol report range must not exceed ${MAX_REPORT_DAYS} days.`);
  return { start, end, dates: Array.from({ length: days }, (_, index) => new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10)) };
}

function requireAdmin(actor) {
  if (String(actor?.role || '').toUpperCase() !== 'ADMIN') throw http(403, 'PATROL_ADMIN_REQUIRED', 'Only ADMIN may manage patrol checkpoints.');
}

function requireReporter(actor) {
  if (!REPORT_ROLES.has(String(actor?.role || '').toUpperCase())) throw http(403, 'PATROL_REPORT_FORBIDDEN', 'Patrol reports require ADMIN, MANAGER or SUPERVISOR.');
}

function text(value, max, field, { required = true } = {}) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) { if (required) throw http(400, 'PATROL_FIELD_REQUIRED', `${field} is required.`); return null; }
  if (normalized.length > max) throw http(400, 'PATROL_FIELD_TOO_LONG', `${field} is too long.`);
  return normalized;
}

function employeeName(employee) {
  if (!employee) return null;
  return employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || employee.employeeCode || null;
}

function safeCheckpoint(row, { includeQr = false } = {}) {
  const output = {
    id: row.id,
    code: row.code,
    name: row.name,
    department: row.department,
    locationNote: row.locationNote ?? null,
    sortOrder: row.sortOrder ?? 0,
    isActive: row.isActive !== false,
    qrVersion: row.qrVersion ?? 1,
    qrRotatedAt: row.qrRotatedAt ?? null,
    updatedAt: row.updatedAt ?? null
  };
  if (includeQr) output.qrPayload = `${PATROL_QR_PREFIX}${row.qrToken}`;
  return output;
}

function safeScan(row) {
  const workDate = row.workDate instanceof Date ? row.workDate.toISOString().slice(0, 10) : String(row.workDate).slice(0, 10);
  return {
    id: row.id,
    checkpointId: row.checkpointId,
    checkpointCode: row.checkpoint?.code ?? null,
    checkpointName: row.checkpoint?.name ?? null,
    checkpointDepartment: row.checkpointDepartment,
    employeeId: row.employeeId,
    employeeCode: row.employee?.employeeCode ?? null,
    employeeName: employeeName(row.employee),
    employeeDepartment: row.employeeDepartment ?? null,
    scannedAt: row.scannedAt instanceof Date ? row.scannedAt.toISOString() : row.scannedAt,
    workDate,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    accuracyMeters: row.accuracyMeters ?? null,
    note: row.note ?? null,
    photoUrl: `/api/v1/patrol/scans/${row.id}/photo`
  };
}

function normalizePhoto(photo) {
  if (!photo || !Buffer.isBuffer(photo.buffer) || photo.buffer.length === 0) throw http(400, 'PATROL_PHOTO_REQUIRED', 'A checkpoint photo is required for every patrol scan.');
  if (photo.buffer.length > MAX_PHOTO_BYTES) throw http(413, 'PATROL_PHOTO_TOO_LARGE', 'Patrol photo must not exceed 1 MB.');
  const type = detectedType(photo.buffer);
  const mimeType = MIME_BY_TYPE[type];
  if (!mimeType || (photo.mimetype && String(photo.mimetype).toLowerCase() !== mimeType)) throw http(415, 'PATROL_PHOTO_INVALID', 'Patrol photo must be a valid JPEG or PNG image.');
  return { buffer: photo.buffer, mimeType, extension: type === 'png' ? 'png' : 'jpg', checksum: crypto.createHash('sha256').update(photo.buffer).digest('hex') };
}

function parseQrPayload(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith(PATROL_QR_PREFIX)) throw http(404, 'PATROL_QR_UNKNOWN', 'This QR is not a patrol checkpoint.');
  const token = raw.slice(PATROL_QR_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw http(404, 'PATROL_QR_UNKNOWN', 'This QR is not a patrol checkpoint.');
  return token;
}

function optionalNumber(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

function patrolDayStartMs(day) {
  return Date.parse(`${day}T00:00:00.000Z`) + DAY_START_HOUR * HOUR_MS - BANGKOK_OFFSET_MS;
}

function patrolRoundOf(instant) {
  const time = instant instanceof Date ? instant.getTime() : Date.parse(instant);
  const day = new Date(time + BANGKOK_OFFSET_MS - DAY_START_HOUR * HOUR_MS).toISOString().slice(0, 10);
  return { day, round: Math.floor((time - patrolDayStartMs(day)) / (ROUND_HOURS * HOUR_MS)) + 1 };
}

function buildRounds({ scans, dates }) {
  const wanted = new Set(dates);
  const byCheckpoint = {};
  for (const scan of scans) {
    const { day, round } = patrolRoundOf(scan.scannedAt);
    if (!wanted.has(day)) continue;
    const days = (byCheckpoint[scan.checkpointId] ||= {});
    const rounds = (days[day] ||= []);
    if (!rounds.includes(round)) rounds.push(round);
  }
  for (const days of Object.values(byCheckpoint)) for (const rounds of Object.values(days)) rounds.sort((a, b) => a - b);
  return { config: { perDay: ROUNDS_PER_DAY, hours: ROUND_HOURS, startHour: DAY_START_HOUR, timeZone: 'Asia/Bangkok' }, byCheckpoint };
}

function buildCoverage({ checkpoints, scans, dates }) {
  const byCheckpoint = new Map();
  for (const scan of scans) {
    const day = scan.workDate instanceof Date ? scan.workDate.toISOString().slice(0, 10) : String(scan.workDate).slice(0, 10);
    const key = `${scan.checkpointId}|${day}`;
    const at = scan.scannedAt instanceof Date ? scan.scannedAt : new Date(scan.scannedAt);
    const current = byCheckpoint.get(key) || { count: 0, lastScanAt: null, lastEmployeeName: null, lastEmployeeCode: null };
    current.count += 1;
    if (!current.lastScanAt || at > new Date(current.lastScanAt)) {
      current.lastScanAt = at.toISOString();
      current.lastEmployeeName = employeeName(scan.employee);
      current.lastEmployeeCode = scan.employee?.employeeCode ?? null;
    }
    byCheckpoint.set(key, current);
  }
  const departments = new Map();
  let scannedCells = 0;
  for (const checkpoint of [...checkpoints].sort((a, b) => String(a.department).localeCompare(String(b.department)) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.code).localeCompare(String(b.code)))) {
    const days = {};
    let scannedDays = 0;
    for (const day of dates) {
      const cell = byCheckpoint.get(`${checkpoint.id}|${day}`) || { count: 0, lastScanAt: null, lastEmployeeName: null, lastEmployeeCode: null };
      days[day] = cell;
      if (cell.count > 0) scannedDays += 1;
    }
    scannedCells += scannedDays;
    const group = departments.get(checkpoint.department) || { department: checkpoint.department, checkpoints: [], total: 0, scanned: 0 };
    group.checkpoints.push({ id: checkpoint.id, code: checkpoint.code, name: checkpoint.name, locationNote: checkpoint.locationNote ?? null, days, scannedDays });
    group.total += dates.length;
    group.scanned += scannedDays;
    departments.set(checkpoint.department, group);
  }
  const totalCells = checkpoints.length * dates.length;
  return {
    dates,
    departments: [...departments.values()],
    summary: {
      checkpoints: checkpoints.length,
      scanned: scannedCells,
      pending: totalCells - scannedCells,
      scans: scans.length,
      percent: totalCells ? Math.round((scannedCells / totalCells) * 100) : 0
    }
  };
}

function createPatrolService({ prisma = prismaDefault, storage, audit = auditDefault, clock = () => new Date(), randomBytes = crypto.randomBytes } = {}) {
  const newToken = () => randomBytes(32).toString('base64url');
  const log = async (entry) => { try { await audit?.log?.(entry); } catch { /* audit failure must not hide the primary result */ } };
  const requireStorage = () => {
    if (!storage || typeof storage.put !== 'function' || typeof storage.remove !== 'function') throw http(503, 'PATROL_STORAGE_NOT_CONFIGURED', 'Patrol photo storage is not configured.');
    return storage;
  };

  async function listCheckpoints({ actor, includeInactive = false, includeQr = false } = {}) {
    if (includeQr) requireAdmin(actor); else requireReporter(actor);
    const rows = await prisma.patrolCheckpoint.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ department: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }] });
    return rows.map((row) => safeCheckpoint(row, { includeQr }));
  }

  async function createCheckpoint({ actor, input = {} }) {
    requireAdmin(actor);
    const data = {
      code: text(input.code, 50, 'code').toUpperCase(),
      name: text(input.name, 150, 'name'),
      department: text(input.department, 100, 'department'),
      locationNote: text(input.locationNote, 500, 'locationNote', { required: false }),
      sortOrder: Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
      qrToken: newToken()
    };
    let row;
    try { row = await prisma.patrolCheckpoint.create({ data }); } catch (error) {
      if (error?.code === 'P2002') throw http(409, 'PATROL_CHECKPOINT_CODE_EXISTS', 'Checkpoint code already exists.');
      throw error;
    }
    await log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'PatrolCheckpoint', entityId: row.id, metadata: { event: 'PATROL_CHECKPOINT_CREATED', code: row.code, department: row.department } });
    return safeCheckpoint(row, { includeQr: true });
  }

  async function updateCheckpoint({ actor, checkpointId, input = {} }) {
    requireAdmin(actor);
    const data = {};
    if (input.name !== undefined) data.name = text(input.name, 150, 'name');
    if (input.department !== undefined) data.department = text(input.department, 100, 'department');
    if (input.locationNote !== undefined) data.locationNote = text(input.locationNote, 500, 'locationNote', { required: false });
    if (input.sortOrder !== undefined && Number.isInteger(Number(input.sortOrder))) data.sortOrder = Number(input.sortOrder);
    if (input.isActive !== undefined) data.isActive = input.isActive === true;
    if (!Object.keys(data).length) throw http(400, 'PATROL_UPDATE_EMPTY', 'At least one field is required.');
    let row;
    try { row = await prisma.patrolCheckpoint.update({ where: { id: checkpointId }, data }); } catch (error) {
      if (error?.code === 'P2025') throw http(404, 'PATROL_CHECKPOINT_NOT_FOUND', 'Checkpoint was not found.');
      throw error;
    }
    await log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'PatrolCheckpoint', entityId: row.id, metadata: { event: 'PATROL_CHECKPOINT_UPDATED', fields: Object.keys(data) } });
    return safeCheckpoint(row, { includeQr: true });
  }

  async function rotateQr({ actor, checkpointId }) {
    requireAdmin(actor);
    let row;
    try { row = await prisma.patrolCheckpoint.update({ where: { id: checkpointId }, data: { qrToken: newToken(), qrVersion: { increment: 1 }, qrRotatedAt: clock() } }); } catch (error) {
      if (error?.code === 'P2025') throw http(404, 'PATROL_CHECKPOINT_NOT_FOUND', 'Checkpoint was not found.');
      throw error;
    }
    await log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'PatrolCheckpoint', entityId: row.id, metadata: { event: 'PATROL_CHECKPOINT_QR_ROTATED', qrVersion: row.qrVersion } });
    return safeCheckpoint(row, { includeQr: true });
  }

  function requireScanner(actor) {
    const employeeId = actor?.employeeAuthority?.id;
    if (!actor?.sub || !employeeId || actor.employeeAuthority.isActive === false || actor.employeeAuthority.deletedAt) {
      throw http(403, 'PATROL_EMPLOYEE_REQUIRED', 'Patrol scanning requires an active linked employee account.');
    }
    return employeeId;
  }

  async function resolveQr({ actor, qrPayload }) {
    requireScanner(actor);
    const row = await prisma.patrolCheckpoint.findUnique({ where: { qrToken: parseQrPayload(qrPayload) } });
    if (!row) throw http(404, 'PATROL_QR_UNKNOWN', 'This QR is not a current patrol checkpoint.');
    if (row.isActive === false) throw http(409, 'PATROL_CHECKPOINT_INACTIVE', 'This patrol checkpoint is inactive.');
    return safeCheckpoint(row);
  }

  async function recordScan({ actor, input = {}, photo }) {
    const employeeId = requireScanner(actor);
    const clientScanId = String(input.clientScanId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientScanId)) throw http(400, 'PATROL_CLIENT_SCAN_ID_INVALID', 'clientScanId must be a UUID.');
    const existing = await prisma.patrolScan.findUnique({ where: { clientScanId } });
    if (existing) {
      if (existing.employeeId !== employeeId) throw http(409, 'PATROL_SCAN_CONFLICT', 'This scan id belongs to another employee.');
      return { ...safeScan(existing), replayed: true };
    }
    const file = normalizePhoto(photo);
    const checkpoint = await prisma.patrolCheckpoint.findUnique({ where: { qrToken: parseQrPayload(input.qrPayload) } });
    if (!checkpoint) throw http(404, 'PATROL_QR_UNKNOWN', 'This QR is not a current patrol checkpoint.');
    if (checkpoint.isActive === false) throw http(409, 'PATROL_CHECKPOINT_INACTIVE', 'This patrol checkpoint is inactive.');
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.isActive === false || employee.deletedAt) throw http(403, 'PATROL_EMPLOYEE_REQUIRED', 'Patrol scanning requires an active linked employee account.');

    const now = clock();
    const workDate = bangkokWorkDate(now);
    const store = requireStorage();
    const objectKey = `patrol-scan/${workDate.slice(0, 7)}/${clientScanId}.${file.extension}`;
    const stored = await store.put(objectKey, { buffer: file.buffer, mimetype: file.mimeType });
    if (stored?.sha256 && stored.sha256 !== file.checksum) {
      try { await store.remove(objectKey); } catch { /* best effort */ }
      throw http(502, 'PATROL_PHOTO_CHECKSUM_UNCONFIRMED', 'Patrol photo checksum could not be confirmed.');
    }
    const latitude = optionalNumber(input.latitude, -90, 90);
    const longitude = optionalNumber(input.longitude, -180, 180);
    const accuracy = optionalNumber(input.accuracyMeters, 0, 100000);
    let row;
    try {
      row = await prisma.patrolScan.create({
        data: {
          checkpointId: checkpoint.id,
          employeeId,
          scannedByUserId: actor.sub,
          clientScanId,
          scannedAt: now,
          workDate: new Date(`${workDate}T00:00:00.000Z`),
          checkpointDepartment: checkpoint.department,
          employeeDepartment: employee.department ?? null,
          latitude: latitude !== null && longitude !== null ? latitude : null,
          longitude: latitude !== null && longitude !== null ? longitude : null,
          accuracyMeters: accuracy === null ? null : Math.round(accuracy),
          note: text(input.note, 500, 'note', { required: false }),
          photoStorageProvider: stored?.provider || store.provider || 'unknown',
          photoBucket: stored?.bucket || store.bucket || 'unknown',
          photoObjectKey: objectKey,
          photoMimeType: file.mimeType,
          photoSizeBytes: file.buffer.length,
          photoChecksum: file.checksum
        }
      });
    } catch (error) {
      try { await store.remove(objectKey); } catch { /* best effort cleanup */ }
      if (error?.code === 'P2002') {
        const raced = await prisma.patrolScan.findUnique({ where: { clientScanId } });
        if (raced && raced.employeeId === employeeId) return { ...safeScan(raced), replayed: true };
      }
      throw error;
    }
    await log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'PatrolScan', entityId: row.id, metadata: { event: 'PATROL_SCAN_RECORDED', checkpointId: checkpoint.id, checkpointDepartment: checkpoint.department, employeeId } });
    return { ...safeScan({ ...row, checkpoint, employee }), replayed: false };
  }

  async function report({ actor, from, to, department }) {
    requireReporter(actor);
    const range = dateRange(from, to);
    const dept = department ? text(department, 100, 'department') : null;
    // Rounds after midnight (00:00–07:00) belong to the previous patrol day, so read one extra calendar day.
    const scanEnd = new Date(range.end.getTime() + 86400000);
    const [checkpoints, scans] = await Promise.all([
      prisma.patrolCheckpoint.findMany({ where: { isActive: true, ...(dept ? { department: dept } : {}) }, orderBy: [{ department: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }] }),
      prisma.patrolScan.findMany({
        where: { workDate: { gte: range.start, lte: scanEnd }, ...(dept ? { checkpointDepartment: dept } : {}) },
        orderBy: [{ scannedAt: 'asc' }],
        take: REPORT_SCAN_LIMIT + 1,
        include: {
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true } },
          checkpoint: { select: { id: true, code: true, name: true, department: true } }
        }
      })
    ]);
    if (scans.length > REPORT_SCAN_LIMIT) throw http(422, 'PATROL_REPORT_TOO_LARGE', 'ข้อมูลรายงานมีมากเกินไป โปรดลดช่วงวันหรือเลือกแผนกเพื่อจำกัดข้อมูล');
    const inRange = scans.filter((scan) => {
      const day = scan.workDate instanceof Date ? scan.workDate.toISOString().slice(0, 10) : String(scan.workDate).slice(0, 10);
      return day >= range.dates[0] && day <= range.dates.at(-1);
    });
    const patrolScans = scans.filter((scan) => {
      const { day } = patrolRoundOf(scan.scannedAt);
      return day >= range.dates[0] && day <= range.dates.at(-1);
    });
    return {
      from: range.dates[0],
      to: range.dates.at(-1),
      department: dept,
      generatedAt: clock().toISOString(),
      coverage: buildCoverage({ checkpoints, scans: inRange, dates: range.dates }),
      rounds: buildRounds({ scans, dates: range.dates }),
      scans: inRange.map(safeScan),
      patrolScans: patrolScans.map(safeScan)
    };
  }

  async function progress({ actor, department }) {
    const employeeId = requireScanner(actor);
    const now = clock();
    const { day, round } = patrolRoundOf(now);
    const roundStart = new Date(patrolDayStartMs(day) + (round - 1) * ROUND_HOURS * HOUR_MS);
    const roundEnd = new Date(roundStart.getTime() + ROUND_HOURS * HOUR_MS);
    const active = await prisma.patrolCheckpoint.findMany({ where: { isActive: true }, orderBy: [{ department: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }] });
    const departments = [...new Set(active.map((row) => row.department))];
    let selected = department ? text(department, 100, 'department') : null;
    if (!selected) {
      const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
      const own = String(employee?.department || '').split(',').map((value) => value.trim()).find((value) => departments.includes(value));
      selected = own || departments[0] || null;
    }
    const checkpoints = active.filter((row) => row.department === selected);
    const scans = selected ? await prisma.patrolScan.findMany({
      where: { checkpointDepartment: selected, workDate: { gte: new Date(`${bangkokWorkDate(roundStart)}T00:00:00.000Z`), lte: new Date(`${bangkokWorkDate(roundEnd)}T00:00:00.000Z`) } },
      orderBy: [{ scannedAt: 'asc' }],
      take: 2000
    }) : [];
    const inRound = scans.filter((scan) => {
      const at = scan.scannedAt instanceof Date ? scan.scannedAt : new Date(scan.scannedAt);
      return at >= roundStart && at < roundEnd;
    });
    const label = (date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
    return {
      patrolDay: day,
      round,
      rounds: ROUNDS_PER_DAY,
      roundLabel: `${label(roundStart)}–${label(roundEnd)}`,
      roundStart: roundStart.toISOString(),
      roundEnd: roundEnd.toISOString(),
      department: selected,
      departments,
      checkpoints: checkpoints.map((row) => {
        const mine = inRound.filter((scan) => scan.checkpointId === row.id);
        const last = mine[mine.length - 1];
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          locationNote: row.locationNote ?? null,
          doneThisRound: mine.length > 0,
          lastScanAt: last ? (last.scannedAt instanceof Date ? last.scannedAt.toISOString() : last.scannedAt) : null,
          scannedByMe: mine.some((scan) => scan.employeeId === employeeId)
        };
      })
    };
  }

  async function myScans({ actor, date }) {
    const employeeId = requireScanner(actor);
    const day = parseDate(date || bangkokWorkDate(clock()));
    const rows = await prisma.patrolScan.findMany({
      where: { employeeId, workDate: { gte: day, lte: day } },
      orderBy: [{ scannedAt: 'desc' }],
      take: 200,
      include: { checkpoint: { select: { id: true, code: true, name: true, department: true } } }
    });
    return rows.filter((row) => row.employeeId === employeeId).map(safeScan);
  }

  async function photo({ actor, scanId }) {
    const row = await prisma.patrolScan.findUnique({ where: { id: scanId } });
    if (!row) throw http(404, 'PATROL_SCAN_NOT_FOUND', 'Patrol scan was not found.');
    const role = String(actor?.role || '').toUpperCase();
    const own = actor?.employeeAuthority?.id && String(actor.employeeAuthority.id) === String(row.employeeId);
    if (!REPORT_ROLES.has(role) && !own) throw http(403, 'PATROL_PHOTO_FORBIDDEN', 'Patrol photo is outside the actor scope.');
    const store = requireStorage();
    if (typeof store.get !== 'function') throw http(503, 'PATROL_STORAGE_NOT_CONFIGURED', 'Patrol photo storage is not configured.');
    const bytes = await store.get(row.photoObjectKey);
    if (!Buffer.isBuffer(bytes) || crypto.createHash('sha256').update(bytes).digest('hex') !== row.photoChecksum) throw http(502, 'PATROL_PHOTO_READ_FAILED', 'Patrol photo could not be verified.');
    return { bytes, mimeType: row.photoMimeType };
  }

  return { listCheckpoints, createCheckpoint, updateCheckpoint, rotateQr, resolveQr, recordScan, report, progress, myScans, photo };
}

module.exports = { PATROL_QR_PREFIX, MAX_REPORT_DAYS, ROUNDS_PER_DAY, ROUND_HOURS, DAY_START_HOUR, bangkokWorkDate, patrolRoundOf, buildRounds, buildCoverage, parseQrPayload, createPatrolService };
