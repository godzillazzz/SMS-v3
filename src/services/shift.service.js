const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { setAttendanceShiftActive, shiftActivationMap } = require('./attendance-shift-runtime.service');

const auditFields = ['code', 'name', 'startTime', 'endTime', 'hours', 'color'];
const CORE_SHIFT_CODES = new Set(['D', 'N', 'OFF', 'AL']);
const safeRecord = (record, isActive = true) => ({ ...Object.fromEntries(auditFields.map((field) => [field, record[field]])), isActive });

async function withActivation(rows, client = prisma) {
  const list = Array.isArray(rows) ? rows : [rows];
  const activation = await shiftActivationMap(list.filter(Boolean).map((row) => row.id), client);
  const mapped = list.filter(Boolean).map((row) => ({ ...row, isActive: activation.get(row.id) !== false }));
  return Array.isArray(rows) ? mapped : mapped[0] || null;
}

async function list({ includeInactive = false } = {}) {
  const rows = await withActivation(await prisma.shiftType.findMany({ orderBy: { code: 'asc' } }));
  return includeInactive ? rows : rows.filter((row) => row.isActive !== false);
}

async function getById(id) {
  const shift = await prisma.shiftType.findUnique({ where: { id } });
  if (!shift) throw new HttpError(404, 'Shift type not found.');
  return withActivation(shift);
}

function assertCoreActivation(existing, nextActive) {
  if (CORE_SHIFT_CODES.has(String(existing.code || '').toUpperCase()) && nextActive === false) {
    throw new HttpError(409, `Core shift ${existing.code} must remain active for schedule invariants.`, { code: 'CORE_SHIFT_DEACTIVATION_BLOCKED' });
  }
}

async function create(data, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { code: data.code } });
    if (existing) throw new HttpError(400, 'Shift code already exists.');
    const { isActive = true, ...shiftData } = data;
    const created = await tx.shiftType.create({ data: shiftData });
    await setAttendanceShiftActive({ shiftTypeId: created.id, isActive }, tx);
    await audit.log({ actorUserId, action: 'CREATE', entityType: 'ShiftType', entityId: created.id, metadata: { after: safeRecord(created, Boolean(isActive)) } }, tx);
    return { ...created, isActive: Boolean(isActive) };
  });
}

async function update(id, data, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Shift type not found.');
    const beforeMap = await shiftActivationMap([id], tx);
    const beforeActive = beforeMap.get(id) !== false;
    const { isActive, ...shiftData } = data;
    if (isActive !== undefined) assertCoreActivation(existing, Boolean(isActive));
    const updated = Object.keys(shiftData).length ? await tx.shiftType.update({ where: { id }, data: shiftData }) : existing;
    const nextActive = isActive === undefined ? beforeActive : await setAttendanceShiftActive({ shiftTypeId: id, isActive }, tx);
    await audit.log({ actorUserId, action: 'UPDATE', entityType: 'ShiftType', entityId: id, metadata: { before: safeRecord(existing, beforeActive), after: safeRecord(updated, nextActive) } }, tx);
    return { ...updated, isActive: nextActive };
  });
}

async function remove(id, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Shift type not found.');
    assertCoreActivation(existing, false);
    const beforeMap = await shiftActivationMap([id], tx);
    const beforeActive = beforeMap.get(id) !== false;
    await setAttendanceShiftActive({ shiftTypeId: id, isActive: false }, tx);
    await audit.log({ actorUserId, action: 'UPDATE', entityType: 'ShiftType', entityId: id, metadata: { transition: 'DEACTIVATE', before: safeRecord(existing, beforeActive), after: safeRecord(existing, false) } }, tx);
    return { ...existing, isActive: false };
  });
}

module.exports = { list, getById, create, update, remove, CORE_SHIFT_CODES };
