const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDutyService } = require('../src/services/duty.service');
const { validateAttendanceSystemSetting, ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES, ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS } = require('../src/services/attendance-policy.service');

const root = path.join(__dirname, '..');
const attendanceRoutes = fs.readFileSync(path.join(root, 'src/routes/attendance-foundation.routes.js'), 'utf8');
const shiftRoutes = fs.readFileSync(path.join(root, 'src/routes/shifts.routes.js'), 'utf8');

test('Attendance configuration routes are Admin-only mutations and contain no destructive Site or Duty delete path', () => {
  assert.match(attendanceRoutes, /router\.get\('\/sites', authorize\('ADMIN'\)/);
  assert.match(attendanceRoutes, /router\.post\('\/sites', authorize\('ADMIN'\)/);
  assert.match(attendanceRoutes, /router\.put\('\/sites\/:id', authorize\('ADMIN'\)/);
  assert.match(attendanceRoutes, /router\.get\('\/duties', authorize\('ADMIN'\)/);
  assert.match(attendanceRoutes, /router\.post\('\/duties', authorize\('ADMIN'\)/);
  assert.match(attendanceRoutes, /router\.put\('\/duties\/:id', authorize\('ADMIN'\)/);
  assert.doesNotMatch(attendanceRoutes, /router\.delete\('\/(sites|duties)/);
  assert.match(shiftRoutes, /router\.post\('\/', authorize\('ADMIN'\)/);
  assert.match(shiftRoutes, /router\.put\('\/:id', authorize\('ADMIN'\)/);
});

test('Duty creation and deactivation are audited without deleting historical identity', async () => {
  const audits = [];
  let stored;
  const dutyModel = {
    findMany: async ({ where }) => { assert.deepEqual(where, { isActive: true }); return [{ id: 'duty-1', code: 'REGULAR', isActive: true }]; },
    findUnique: async () => stored || null,
    create: async ({ data }) => { stored = { id: 'duty-1', ...data }; return stored; },
    update: async ({ data }) => { stored = { ...stored, ...data }; return stored; }
  };
  const service = createDutyService({ prismaClient: { duty: dutyModel, $transaction: async (work) => work({ duty: dutyModel }) }, auditService: { log: async (entry) => audits.push(entry) } });
  assert.equal((await service.list()).length, 1);
  await service.create({ code: 'REGULAR', name: 'Regular duty', isActive: true }, 'admin-1');
  await service.update('duty-1', { isActive: false }, 'admin-1');
  assert.equal(stored.isActive, false);
  assert.deepEqual(audits.map((entry) => entry.action), ['CREATE', 'UPDATE']);
  assert.equal(audits.every((entry) => entry.entityType === 'Duty'), true);
});

test('Attendance policies stay bounded and overnight shifts require an explicit setting', () => {
  assert.equal(validateAttendanceSystemSetting(ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES, '1440'), '1440');
  assert.equal(validateAttendanceSystemSetting(ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS, '7'), '7');
  assert.throws(() => validateAttendanceSystemSetting(ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES, '10081'));
  assert.match(shiftRoutes, /Overnight must be enabled/);
  assert.match(shiftRoutes, /Overnight shifts require start and end times/);
});
