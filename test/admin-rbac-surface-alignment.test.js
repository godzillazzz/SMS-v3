process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const routeIndex = read('src/routes/index.js');
const schedules = read('src/routes/schedules.routes.js');
const operations = read('src/routes/operations.routes.js');
const shifts = read('src/routes/shifts.routes.js');
const scheduleService = read('src/services/schedule.service.js');
const shiftService = read('src/services/shift.service.js');

test('all mounted monthly schedule approval routes are Admin-only and preserve actor identity', () => {
  assert.match(schedules, /router\.post\('\/approve', authorize\('ADMIN'\),/);
  assert.match(schedules, /approveMonth\(month, note, req\.user\)/);
  assert.doesNotMatch(schedules, /req\.body[^\n]*role/);
  assert.match(operations, /router\.post\('\/schedule\/approve-month', authorize\('ADMIN'\),/);
  assert.match(operations, /router\.put\('\/schedule-approvals\/:id', authorize\('ADMIN'\),/);
  assert.match(operations, /actorUser: req\.user/);
  assert.doesNotMatch(scheduleService, /actorUser: \{ sub: actorUserId, role: 'ADMIN' \}/);
  assert.match(scheduleService, /async function approveMonth\(yearMonth, note, actorUser\)/);
});

test('Shift Type writes are Admin-only on every mounted surface and use one audited service', () => {
  assert.ok(routeIndex.indexOf("router.use('/shift-types', shiftsRoutes);") < routeIndex.indexOf("router.use('/', operationsRoutes);"));
  assert.match(shifts, /router\.post\('\/', authorize\('ADMIN'\),/);
  assert.match(shifts, /router\.put\('\/:id', authorize\('ADMIN'\),/);
  assert.match(shifts, /router\.delete\('\/:id', authorize\('ADMIN'\),/);
  assert.match(operations, /router\.post\('\/shift-types', authorize\('ADMIN'\),/);
  assert.match(operations, /router\.delete\('\/shift-types\/:id', authorize\('ADMIN'\),/);
  assert.match(operations, /shiftService\.create\(input, req\.user\.sub\)/);
  assert.match(operations, /shiftService\.remove\(id, req\.user\.sub\)/);
  assert.match(shiftService, /return prisma\.\$transaction\(async \(tx\)/);
  for (const action of ['CREATE', 'UPDATE', 'DELETE']) {
    assert.match(shiftService, new RegExp(`action: '${action}'`));
  }
  assert.match(shiftService, /entityType: 'ShiftType'/g);
});

test('approval service records the real non-Admin role on a denied direct call', async () => {
  let rejection;
  const fakeTx = { auditLog: { create: async ({ data }) => { rejection = data; } } };
  const { approveMonthlySchedule } = require('../src/services/schedule.service');

  await assert.rejects(
    () => approveMonthlySchedule(fakeTx, {
      month: new Date(Date.UTC(2026, 7, 1)),
      actorUser: { sub: 'manager-1', role: 'MANAGER' }
    }),
    (error) => error.statusCode === 403
  );

  assert.equal(rejection.actorUserId, 'manager-1');
  assert.equal(rejection.metadata.role, 'MANAGER');
  assert.equal(rejection.metadata.reason, 'UNAUTHORIZED_APPROVAL_ATTEMPT');
});
