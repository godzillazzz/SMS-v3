const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');

const SHIFT_ACTIVE_SETTING_PREFIX = 'shift_type_active:';
const CORE_PSEUDO_SHIFT_CODES = new Set(['OFF', 'AL']);
const auditFields = ['code', 'name', 'startTime', 'endTime', 'hours', 'color', 'isActive'];

const lifecycleKey = (id) => `${SHIFT_ACTIVE_SETTING_PREFIX}${id}`;
const settingValueToBoolean = (value) => String(value ?? 'true').trim().toLowerCase() !== 'false';
const safeRecord = (record) => Object.fromEntries(auditFields.map((field) => [field, record[field]]));

async function lifecycleMap(client, ids) {
  if (!ids.length) return new Map();
  const settings = await client.systemSetting.findMany({
    where: { key: { in: ids.map(lifecycleKey) } },
    select: { key: true, value: true }
  });
  return new Map(settings.map((setting) => [setting.key.slice(SHIFT_ACTIVE_SETTING_PREFIX.length), settingValueToBoolean(setting.value)]));
}

async function attachLifecycle(client, shifts) {
  const states = await lifecycleMap(client, shifts.map((shift) => shift.id));
  return shifts.map((shift) => ({ ...shift, isActive: states.get(shift.id) ?? true }));
}

async function list() {
  const shifts = await prisma.shiftType.findMany({
    orderBy: { code: 'asc' }
  });
  return attachLifecycle(prisma, shifts);
}

async function getById(id) {
  const shift = await prisma.shiftType.findUnique({ where: { id } });
  if (!shift) throw new HttpError(404, 'Shift type not found.');
  return (await attachLifecycle(prisma, [shift]))[0];
}

async function create(data, actorUserId) {
  const { isActive: requestedIsActive, ...shiftData } = data;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { code: shiftData.code } });
    if (existing) throw new HttpError(400, 'Shift code already exists.');
    const created = await tx.shiftType.create({ data: shiftData });
    const isActive = requestedIsActive === undefined ? true : Boolean(requestedIsActive);
    if (!isActive) {
      await tx.systemSetting.upsert({
        where: { key: lifecycleKey(created.id) },
        update: { value: 'false', description: `Lifecycle state for shift ${created.code}` },
        create: { key: lifecycleKey(created.id), value: 'false', description: `Lifecycle state for shift ${created.code}` }
      });
    }
    const result = { ...created, isActive };
    await audit.log({ actorUserId, action: 'CREATE', entityType: 'ShiftType', entityId: created.id, metadata: { after: safeRecord(result) } }, tx);
    return result;
  });
}

async function update(id, data, actorUserId) {
  const hasLifecycleChange = Object.prototype.hasOwnProperty.call(data, 'isActive');
  const { isActive: requestedIsActive, ...shiftData } = data;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.shiftType.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Shift type not found.');

    const [existingWithLifecycle] = await attachLifecycle(tx, [existing]);
    const nextIsActive = hasLifecycleChange ? Boolean(requestedIsActive) : existingWithLifecycle.isActive;
    const effectiveCode = String(shiftData.code || existing.code).toUpperCase();
    if (!nextIsActive && CORE_PSEUDO_SHIFT_CODES.has(effectiveCode)) {
      throw new HttpError(409, `Core pseudo shift ${effectiveCode} must remain active.`, { code: 'CORE_SHIFT_MUST_REMAIN_ACTIVE' });
    }

    const updated = Object.keys(shiftData).length
      ? await tx.shiftType.update({ where: { id }, data: shiftData })
      : existing;

    if (hasLifecycleChange) {
      await tx.systemSetting.upsert({
        where: { key: lifecycleKey(id) },
        update: { value: nextIsActive ? 'true' : 'false', description: `Lifecycle state for shift ${updated.code}` },
        create: { key: lifecycleKey(id), value: nextIsActive ? 'true' : 'false', description: `Lifecycle state for shift ${updated.code}` }
      });
    }

    const result = { ...updated, isActive: nextIsActive };
    await audit.log({ actorUserId, action: 'UPDATE', entityType: 'ShiftType', entityId: id, metadata: { before: safeRecord(existingWithLifecycle), after: safeRecord(result) } }, tx);
    return result;
  });
}

async function remove(id, actorUserId) {
  return update(id, { isActive: false }, actorUserId);
}

async function assertAssignableShiftTypes(assignments, client = prisma) {
  const ids = [...new Set((assignments || []).map((assignment) => assignment?.shiftTypeId).filter(Boolean))];
  if (!ids.length) return;

  const shifts = await client.shiftType.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true }
  });
  if (shifts.length !== ids.length) {
    throw new HttpError(400, 'Shift type not found for schedule assignment.', { code: 'SHIFT_TYPE_NOT_FOUND' });
  }

  const states = await lifecycleMap(client, ids);
  const inactive = shifts.find((shift) => (states.get(shift.id) ?? true) === false);
  if (inactive) {
    throw new HttpError(409, `Shift ${inactive.code} is inactive and cannot be assigned to a new schedule change.`, { code: 'SHIFT_TYPE_INACTIVE' });
  }
}

module.exports = {
  SHIFT_ACTIVE_SETTING_PREFIX,
  list,
  getById,
  create,
  update,
  remove,
  assertAssignableShiftTypes
};