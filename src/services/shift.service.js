const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { normalizeScheduleTime } = require('../utils/schedule-time');

const auditFields = ['code', 'name', 'startTime', 'endTime', 'hours', 'color'];
const safeRecord = (record) => Object.fromEntries(auditFields.map((field) => [field, record[field]]));
const canonicalizeTimes = (data) => {
  const next = { ...data };
  for (const field of ['startTime', 'endTime']) {
    if (!Object.hasOwn(next, field) || next[field] === null || next[field] === undefined) continue;
    const normalized = normalizeScheduleTime(next[field]);
    if (!normalized) throw new HttpError(400, 'Shift time must use HH:mm.');
    next[field] = normalized;
  }
  return next;
};

async function list() {
  return prisma.shiftType.findMany({
    orderBy: { code: 'asc' }
  });
}

async function getById(id) {
  const shift = await prisma.shiftType.findUnique({ where: { id } });
  if (!shift) throw new HttpError(404, 'Shift type not found.');
  return shift;
}

async function create(data, actorUserId) {
  const canonical = canonicalizeTimes(data);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { code: canonical.code } });
    if (existing) throw new HttpError(400, 'Shift code already exists.');
    const created = await tx.shiftType.create({ data: canonical });
    await audit.log({ actorUserId, action: 'CREATE', entityType: 'ShiftType', entityId: created.id, metadata: { after: safeRecord(created) } }, tx);
    return created;
  });
}

async function update(id, data, actorUserId) {
  const canonical = canonicalizeTimes(data);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Shift type not found.');
    const existingCode = String(existing.code || '').toUpperCase();
    const nextCode = canonical.code === undefined ? existingCode : String(canonical.code || '').toUpperCase();
    if (['D', 'N', 'OFF', 'AL'].includes(existingCode) && nextCode !== existingCode) throw new HttpError(400, `Core shift ${existingCode} code cannot be changed.`);
    const updated = await tx.shiftType.update({ where: { id }, data: canonical });
    await audit.log({ actorUserId, action: 'UPDATE', entityType: 'ShiftType', entityId: id, metadata: { before: safeRecord(existing), after: safeRecord(updated) } }, tx);
    return updated;
  });
}

async function remove(id, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Shift type not found.');
    if (['D', 'N', 'OFF', 'AL'].includes(existing.code.toUpperCase())) throw new HttpError(400, `Core shift ${existing.code} cannot be deleted.`);
    const deleted = await tx.shiftType.delete({ where: { id } });
    await audit.log({ actorUserId, action: 'DELETE', entityType: 'ShiftType', entityId: id, metadata: { before: safeRecord(existing) } }, tx);
    return deleted;
  });
}

module.exports = { list, getById, create, update, remove };
