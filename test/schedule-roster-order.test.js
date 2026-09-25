'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('schema separates employee master order from immutable monthly roster snapshots', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /scheduleOrder\s+Int\?\s+@map\("schedule_order"\)/);
  assert.match(schema, /model ScheduleRosterSnapshot \{/);
  assert.match(schema, /@@unique\(\[month, employeeId\]\)/);
  assert.match(schema, /@@index\(\[month, departmentSnapshot, rosterOrder\]\)/);
});

test('migration preserves legacy historical ordering and seeds active master ordering', () => {
  const migration = read('prisma/migrations/202609250001_add_schedule_roster_order/migration.sql');
  assert.match(migration, /WHERE is_active = TRUE AND deleted_at IS NULL/);
  assert.match(migration, /ORDER BY employee_code ASC, id ASC/);
  assert.match(migration, /MIGRATION_BACKFILL/);
  assert.match(migration, /PARTITION BY month, COALESCE\(department_snapshot, ''\)/);
});

test('calendar uses roster service instead of employee-code sorting and exposes snapshot state', () => {
  const operations = read('src/routes/operations.routes.js');
  assert.match(operations, /loadCalendarRoster\(prisma, monthStart/);
  assert.match(operations, /rosterSnapshotLocked: roster\.snapshotLocked/);
  const route = operations.slice(operations.indexOf("router.get('/schedule-calendar'"), operations.indexOf("router.post('/schedule/auto-preview'"));
  assert.doesNotMatch(route, /orderBy:\s*\[\{ employeeCode: 'asc' \}\]/);
});

test('every schedule write path snapshots roster before changing the month', () => {
  const schedules = read('src/services/schedule.service.js');
  const auto = read('src/services/auto-schedule.service.js');
  const operations = read('src/routes/operations.routes.js');
  assert.match(schedules, /ensureMonthlyRosterSnapshot\(tx, monthKey, \{ extraEmployeeIds: \[\.\.\.ids\]/);
  assert.match(auto, /source: 'AUTO_SCHEDULE'/);
  assert.match(auto, /source: 'AUTO_SCHEDULE_EMPLOYEE'/);
  assert.match(operations, /source: 'DIRECT_SHIFT'/);
  assert.match(operations, /source: 'DIRECT_SHIFT_UPDATE'/);
});

test('roster ordering is department-scoped for non-admin managers and supervisors', () => {
  const service = read('src/services/schedule-roster.service.js');
  const routes = read('src/routes/schedules.routes.js');
  assert.match(service, /actorUser\?\.role === 'ADMIN'/);
  assert.match(service, /\['MANAGER', 'SUPERVISOR'\]\.includes\(user\.role\)/);
  assert.match(service, /ROSTER_DEPARTMENT_SCOPE_REQUIRED/);
  assert.match(routes, /listDepartmentRoster\(prisma, department, req\.user\)/);
  assert.match(routes, /reorderDepartmentRoster\(prisma, \{ department, employeeIds, actorUser: req\.user \}\)/);
});

test('department transfer or active-state change frees the employee master roster position', () => {
  const lifecycle = read('src/services/employee-lifecycle.service.js');
  assert.match(lifecycle, /departmentWillChange/);
  assert.match(lifecycle, /activeWillChange/);
  assert.match(lifecycle, /data\.scheduleOrder = null/);
});

test('approved Excel export follows roster snapshot order instead of alphabetical employee name', () => {
  const operations = read('src/routes/operations.routes.js');
  const exporter = read('src/services/schedule-export.service.js');
  assert.match(operations, /scheduleRosterSnapshot\.findMany\(\{ where: \{ month: start \}/);
  assert.match(operations, /rosterOrderByEmployee/);
  assert.match(exporter, /rosterOrder: Number\(shift\.rosterOrder/);
  assert.match(exporter, /Number\(first\.rosterOrder\) - Number\(second\.rosterOrder\)/);
});

test('schedule UI preserves server order and provides reorder plus snapshot status controls', () => {
  const main = read('frontend/src/main.tsx');
  const modal = read('frontend/src/components/ScheduleRosterOrderModal.tsx');
  const rosterClient = read('frontend/src/schedule-roster-client.ts');
  assert.match(main, /const allCalendarEmployees = rawCalendarEmployees;/);
  assert.doesNotMatch(main, /allCalendarEmployees = \[\.\.\.rawCalendarEmployees\]\.sort\(\(a, b\) => \(String\(a\.employeeCode/);
  assert.match(main, /จัดลำดับพนักงาน/);
  assert.match(main, /rosterSnapshotLocked/);
  assert.match(modal, /draggable=\{!busy\}/);
  assert.match(modal, /บันทึกลำดับพนักงาน/);
  assert.match(rosterClient, /getScheduleRosterOrder/);
  assert.match(rosterClient, /updateScheduleRosterOrder/);
});