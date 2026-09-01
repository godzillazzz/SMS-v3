const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');
const { normalizeScheduleTime } = require('../utils/schedule-time');

const CORE_SHIFT_CODES = Object.freeze(['D', 'N', 'OFF', 'AL']);
const auditFields = ['code', 'name', 'startTime', 'endTime', 'hours', 'color', 'isActive'];
const safeRecord = (record) => Object.fromEntries(auditFields.map((field) => [field, record[field]]));

const canonicalize = (data) => {
  const next = { ...data };
  if (Object.hasOwn(next, 'code') && next.code !== undefined && next.code !== null) {
    next.code = String(next.code).trim().toUpperCase();
  }
  if (Object.hasOwn(next, 'color') && next.color !== undefined && next.color !== null) {
    next.color = String(next.color).trim().toUpperCase();
  }
  for (const field of ['startTime', 'endTime']) {
    if (!Object.hasOwn(next, field) || next[field] === null || next[field] === undefined) continue;
    const normalized = normalizeScheduleTime(next[field]);
    if (!normalized) throw new HttpError(400, 'Shift time must use HH:mm.');
    next[field] = normalized;
  }
  return next;
};

const validateDefinition = (record) => {
  const hours = Number(record.hours || 0);
  if (hours > 0 && (!record.startTime || !record.endTime)) {
    throw new HttpError(400, 'Working shifts require start and end times.');
  }
  if (CORE_SHIFT_CODES.includes(String(record.code || '').toUpperCase()) && record.isActive === false) {
    throw new HttpError(400, `Core shift ${String(record.code).toUpperCase()} cannot be deactivated.`);
  }
};

async function list({ includeInactive = false } = {}) {
  return prisma.shiftType.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { code: 'asc' }
  });
}

async function getById(id) {
  const shift = await prisma.shiftType.findUnique({ where: { id } });
  if (!shift) throw new HttpError(404, 'Shift type not found.');
  return shift;
}

async function create(data, actorUserId) {
  const canonical = canonicalize({ ...data, isActive: data.isActive !== false });
  validateDefinition(canonical);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { code: canonical.code } });
    if (existing) throw new HttpError(400, 'Shift code already exists.');
    const created = await tx.shiftType.create({ data: canonical });
    await audit.log({ actorUserId, action: 'CREATE', entityType: 'ShiftType', entityId: created.id, metadata: { after: safeRecord(created) } }, tx);
    return created;
  });
}

async function impact(id, client = prisma) {
  const existing = await client.shiftType.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Shift type not found.');
  const [assignmentCount, attendanceCount] = await Promise.all([
    client.shiftAssignment.count({ where: { shiftTypeId: id } }),
    client.attendanceSession.count({ where: { expectedShiftTypeId: id } })
  ]);
  return { id, code: existing.code, name: existing.name, isActive: existing.isActive, isCore: CORE_SHIFT_CODES.includes(String(existing.code || '').toUpperCase()), assignmentCount, attendanceCount, totalReferences: assignmentCount + attendanceCount };
}

async function update(id, data, actorUserId) {
  const governance = { reason: String(data.reason || '').trim(), confirmImpact: data.confirmImpact === true };
  const canonical = canonicalize(data);
  delete canonical.reason; delete canonical.confirmImpact;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Shift type not found.');

    const existingCode = String(existing.code || '').toUpperCase();
    if (canonical.code !== undefined && String(canonical.code).toUpperCase() !== existingCode) {
      throw new HttpError(400, CORE_SHIFT_CODES.includes(existingCode)
        ? `Core shift ${existingCode} code cannot be changed.`
        : 'Shift code is immutable after creation.');
    }
    delete canonical.code;

    const next = { ...existing, ...canonical };
    validateDefinition(next);
    let impactSnapshot = null;
    if (existing.isActive !== false && canonical.isActive === false) {
      impactSnapshot = await impact(id, tx);
      if (!governance.confirmImpact || governance.reason.length < 3 || governance.reason.length > 1000) throw new HttpError(409, 'Review Shift Impact Preview, confirm impact, and provide a reason before deactivation.', { code: 'SHIFT_DEACTIVATION_CONFIRM_REQUIRED', impact: impactSnapshot });
    }

    const updated = await tx.shiftType.update({ where: { id }, data: canonical });
    await audit.log({ actorUserId, action: 'UPDATE', entityType: 'ShiftType', entityId: id, metadata: { before: safeRecord(existing), after: safeRecord(updated), ...(impactSnapshot ? { reason: governance.reason, impact: impactSnapshot } : {}) } }, tx);
    return updated;
  });
}

async function remove(id, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Shift type not found.');
    if (['D', 'N', 'OFF', 'AL'].includes(existing.code.toUpperCase())) {
      throw new HttpError(400, `Core shift ${existing.code} cannot be deleted.`);
    }

    const [assignmentCount, attendanceCount] = await Promise.all([
      tx.shiftAssignment.count({ where: { shiftTypeId: id } }),
      tx.attendanceSession.count({ where: { expectedShiftTypeId: id } })
    ]);
    if (assignmentCount > 0 || attendanceCount > 0) {
      throw new HttpError(409, 'Shift type is referenced by historical schedule or attendance records. Deactivate it instead.');
    }

    const deleted = await tx.shiftType.delete({ where: { id } });
    await audit.log({ actorUserId, action: 'DELETE', entityType: 'ShiftType', entityId: id, metadata: { before: safeRecord(existing) } }, tx);
    return deleted;
  });
}

module.exports = { CORE_SHIFT_CODES, list, getById, impact, create, update, remove };
