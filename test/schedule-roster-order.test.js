'use strict';

process.env.NODE_ENV = 'test';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { sortRoster, loadCalendarRoster } = require('../src/services/schedule-roster.service');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('preserves historical snapshot schema and existing migrations without modifying database data', () => {
  const schema = read('prisma/schema.prisma');
  const migration = read('prisma/migrations/202609250001_add_schedule_roster_order/migration.sql');
  assert.match(schema, /model ScheduleRosterSnapshot \{/);
  assert.match(schema, /@@unique\(\[month, employeeId\]\)/);
  assert.match(migration, /MIGRATION_BACKFILL/);
});

test('employee code sorts numerically and ignores both legacy roster-order fields', () => {
  const employees = [
    { id: 'a', employeeCode: 'ST-10', scheduleOrder: 10, rosterOrder: 10 },
    { id: 'b', employeeCode: 'ST-2', scheduleOrder: 900, rosterOrder: 900 },
    { id: 'c', employeeCode: 'ST-1', scheduleOrder: 200, rosterOrder: 200 }
  ];
  assert.deepEqual(employees.slice().sort(sortRoster).map(({ employeeCode }) => employeeCode), ['ST-1', 'ST-2', 'ST-10']);
  assert.deepEqual(
    [{ employeeId: 'a', employeeCodeSnapshot: 'ST-10', rosterOrder: 1 },
      { employeeId: 'b', employeeCodeSnapshot: 'ST-2', rosterOrder: 99 }].sort(sortRoster).map(({ employeeCodeSnapshot }) => employeeCodeSnapshot),
    ['ST-2', 'ST-10']
  );
});

test('historical monthly roster uses stored employee codes, not stored custom positions', async () => {
  const rows = [
    { employeeId: 'a', employeeCodeSnapshot: 'ST-10', employeeNameSnapshot: 'A', departmentSnapshot: 'D', jobTitleSnapshot: null, rosterOrder: 1, employee: { firstName: 'A', lastName: '', isActive: true, deletedAt: null, scheduleOrder: 1 } },
    { employeeId: 'b', employeeCodeSnapshot: 'ST-2', employeeNameSnapshot: 'B', departmentSnapshot: 'D', jobTitleSnapshot: null, rosterOrder: 100, employee: { firstName: 'B', lastName: '', isActive: true, deletedAt: null, scheduleOrder: 100 } }
  ];
  const calls = [];
  const client = { scheduleRosterSnapshot: {
    count: async () => rows.length,
    findMany: async (query) => { calls.push(query); return rows; }
  } };
  const roster = await loadCalendarRoster(client, '2025-04');
  assert.equal(roster.snapshotLocked, true);
  assert.deepEqual(roster.employees.map((row) => row.employeeCode), ['ST-2', 'ST-10']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.month.toISOString().slice(0, 7), '2025-04');
  assert.deepEqual(rows.map((row) => row.rosterOrder), [1, 100]);
});

test('calendar, print and approved Excel export use employee code instead of custom roster positions', () => {
  const service = read('src/services/schedule-roster.service.js');
  const operations = read('src/routes/operations.routes.js');
  const exportSource = read('src/services/schedule-export.service.js');
  const main = read('frontend/src/main.tsx');
  assert.match(service, /employees: visibleRows\.map[\s\S]*?\)\)\.sort\(sortRoster\)/);
  assert.match(service, /employees\.sort\(sortRoster\)/);
  assert.match(operations, /employeeCodeSnapshot: snapshotCodeByEmployee\.get/);
  assert.doesNotMatch(operations.slice(operations.indexOf("router.post('/schedule/export.xlsx'")), /rosterOrderByEmployee/);
  assert.match(exportSource, /numeric: true, sensitivity: 'base'/);
  assert.doesNotMatch(exportSource, /first\.rosterOrder|second\.rosterOrder/);
  assert.equal((main.match(/sortScheduleEmployeesByCode\(rawCalendarEmployees\)/g) || []).length, 2);
});

test('the manual reorder UI and API are removed, retaining immutable snapshots', () => {
  const routes = read('src/routes/schedules.routes.js');
  const rosterService = read('src/services/schedule-roster.service.js');
  const main = read('frontend/src/main.tsx');
  assert.doesNotMatch(routes, /roster-order|reorderMonthlyRoster|reorderDepartmentRoster/);
  assert.doesNotMatch(rosterService, /function reorderMonthlyRoster|function reorderDepartmentRoster/);
  assert.doesNotMatch(main, /จัดลำดับพนักงาน|rosterOrderDepartment|ScheduleRosterOrderModal|getScheduleRosterOrder|updateScheduleRosterOrder/);
  assert.equal(fs.existsSync(path.join(root, 'frontend/src/components/ScheduleRosterOrderModal.tsx')), false);
  assert.equal(fs.existsSync(path.join(root, 'frontend/src/schedule-roster-client.ts')), false);
  assert.match(rosterService, /async function ensureMonthlyRosterSnapshot/);
});