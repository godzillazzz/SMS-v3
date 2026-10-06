'use strict';

process.env.NODE_ENV = 'test';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { sortRoster, loadCalendarRoster } = require('../src/services/schedule-roster.service');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('legacy snapshot table may remain for rollback but runtime schedule code no longer reads or writes it', () => {
  const schema = read('prisma/schema.prisma');
  const migration = read('prisma/migrations/202609250001_add_schedule_roster_order/migration.sql');
  const runtime = [
    read('src/services/schedule-roster.service.js'),
    read('src/services/schedule.service.js'),
    read('src/services/auto-schedule.service.js'),
    read('src/routes/operations.routes.js')
  ].join('\n');

  assert.match(schema, /model ScheduleRosterSnapshot \{/);
  assert.match(migration, /MIGRATION_BACKFILL/);
  assert.doesNotMatch(runtime, /scheduleRosterSnapshot|ensureMonthlyRosterSnapshot|rosterSnapshotLocked/);
});

test('employee code sorts numerically and ignores legacy order fields', () => {
  const employees = [
    { id: 'a', employeeCode: 'ST-10', scheduleOrder: 10, rosterOrder: 10 },
    { id: 'b', employeeCode: 'ST-2', scheduleOrder: 900, rosterOrder: 900 },
    { id: 'c', employeeCode: 'ST-1', scheduleOrder: 200, rosterOrder: 200 }
  ];
  assert.deepEqual(employees.slice().sort(sortRoster).map(({ employeeCode }) => employeeCode), ['ST-1', 'ST-2', 'ST-10']);
});

test('monthly roster is live from Employee master plus assigned employees and never consults snapshot storage', async () => {
  let snapshotAccesses = 0;
  const employees = [
    { id: 'a', employeeCode: 'ST-10', firstName: 'A', lastName: '', displayName: 'A', department: 'D', jobTitle: 'Guard', isActive: true, deletedAt: null, scheduleOrder: 1 },
    { id: 'b', employeeCode: 'ST-2', firstName: 'B', lastName: '', displayName: 'B', department: 'D', jobTitle: 'Guard', isActive: true, deletedAt: null, scheduleOrder: 999 },
    { id: 'c', employeeCode: 'ST-1', firstName: 'C', lastName: '', displayName: 'C', department: 'D', jobTitle: 'Guard', isActive: false, deletedAt: null, scheduleOrder: 500 }
  ];
  const client = {
    scheduleRosterSnapshot: {
      count: async () => { snapshotAccesses += 1; throw new Error('snapshot runtime access forbidden'); },
      findMany: async () => { snapshotAccesses += 1; throw new Error('snapshot runtime access forbidden'); }
    },
    shiftAssignment: {
      findMany: async () => [{ employeeId: 'c' }]
    },
    employee: {
      findMany: async () => employees
    },
    employeeLifecycleEvent: {
      findMany: async () => []
    }
  };

  const roster = await loadCalendarRoster(client, '2026-10');
  assert.equal(snapshotAccesses, 0);
  assert.equal(Object.hasOwn(roster, 'snapshotLocked'), false);
  assert.deepEqual(roster.employees.map((row) => row.employeeCode), ['ST-1', 'ST-2', 'ST-10']);
});

test('calendar, print and approved Excel export use department then employee code without roster snapshots or custom positions', () => {
  const service = read('src/services/schedule-roster.service.js');
  const operations = read('src/routes/operations.routes.js');
  const exportSource = read('src/services/schedule-export.service.js');
  const main = read('frontend/src/main.tsx');

  assert.match(service, /employees\.sort\(sortRoster\)/);
  assert.match(operations, /employeeCodeSnapshot: codeByEmployee\.get/);
  assert.doesNotMatch(operations, /scheduleRosterSnapshot|snapshotCodeByEmployee|rosterSnapshotLocked/);
  assert.doesNotMatch(operations.slice(operations.indexOf("router.post('/schedule/export.xlsx'")), /rosterOrderByEmployee/);
  assert.match(exportSource, /sort\(compareScheduleEmployeesByDepartment\)/);
  assert.doesNotMatch(exportSource, /first\.rosterOrder|second\.rosterOrder/);
  assert.equal((main.match(/sortScheduleEmployeesByDepartment\(rawCalendarEmployees\)/g) || []).length, 2);
});

test('manual reorder controls and runtime roster snapshot plumbing are removed', () => {
  const routes = read('src/routes/schedules.routes.js');
  const rosterService = read('src/services/schedule-roster.service.js');
  const main = read('frontend/src/main.tsx');

  assert.doesNotMatch(routes, /roster-order|reorderMonthlyRoster|reorderDepartmentRoster/);
  assert.doesNotMatch(rosterService, /ensureMonthlyRosterSnapshot|scheduleRosterSnapshot|function reorderMonthlyRoster|function reorderDepartmentRoster/);
  assert.doesNotMatch(main, /จัดลำดับพนักงาน|rosterOrderDepartment|ScheduleRosterOrderModal|getScheduleRosterOrder|updateScheduleRosterOrder/);
  assert.equal(fs.existsSync(path.join(root, 'frontend/src/components/ScheduleRosterOrderModal.tsx')), false);
  assert.equal(fs.existsSync(path.join(root, 'frontend/src/schedule-roster-client.ts')), false);
});
