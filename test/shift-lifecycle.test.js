const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const prisma = require('../src/config/prisma');
const shiftService = require('../src/services/shift.service');

const code = () => `G07_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

async function cleanupShift(id) {
  if (!id) return;
  await prisma.systemSetting.deleteMany({ where: { key: `${shiftService.SHIFT_ACTIVE_SETTING_PREFIX}${id}` } });
  await prisma.auditLog.deleteMany({ where: { entityType: 'ShiftType', entityId: id } });
  await prisma.shiftType.deleteMany({ where: { id } });
}

test('G07 shift lifecycle is historical-safe and blocks new inactive assignments', async (t) => {
  let shiftId;
  t.after(async () => cleanupShift(shiftId));

  const created = await shiftService.create({
    code: code(),
    name: 'G07 Lifecycle Test',
    startTime: '08:00',
    endTime: '20:00',
    hours: 12,
    color: '#2F80FF'
  }, null);
  shiftId = created.id;
  assert.equal(created.isActive, true);

  await t.test('deactivate preserves ShiftType row instead of hard deleting it', async () => {
    const deactivated = await shiftService.remove(shiftId, null);
    assert.equal(deactivated.isActive, false);

    const persisted = await prisma.shiftType.findUnique({ where: { id: shiftId } });
    assert.ok(persisted, 'ShiftType must remain for historical references');

    const fetched = await shiftService.getById(shiftId);
    assert.equal(fetched.isActive, false);
  });

  await t.test('inactive shift is rejected for a new schedule assignment', async () => {
    await assert.rejects(
      () => shiftService.assertAssignableShiftTypes([{ shiftTypeId: shiftId }]),
      (error) => error?.statusCode === 409 && error?.details?.code === 'SHIFT_TYPE_INACTIVE'
    );
  });

  await t.test('reactivated shift becomes assignable again', async () => {
    const reactivated = await shiftService.update(shiftId, { isActive: true }, null);
    assert.equal(reactivated.isActive, true);
    await assert.doesNotReject(() => shiftService.assertAssignableShiftTypes([{ shiftTypeId: shiftId }]));
  });
});

test('G07 core OFF/AL pseudo shifts cannot be deactivated', async () => {
  const core = await prisma.shiftType.findFirst({ where: { code: { in: ['OFF', 'AL'] } }, orderBy: { code: 'asc' } });
  assert.ok(core, 'Seed must provide OFF or AL core shift');

  await assert.rejects(
    () => shiftService.update(core.id, { isActive: false }, null),
    (error) => error?.statusCode === 409 && error?.details?.code === 'CORE_SHIFT_MUST_REMAIN_ACTIVE'
  );

  const fetched = await shiftService.getById(core.id);
  assert.equal(fetched.isActive, true);
});