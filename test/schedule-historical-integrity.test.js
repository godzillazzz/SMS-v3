const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSchedulePersonnelResolver, enrichScheduleAssignments } = require('../src/services/schedule-personnel-history.service');

function employee(id, displayName) {
  const [firstName, ...rest] = displayName.split(' ');
  return { id, employeeCode: id, firstName, lastName: rest.join(' '), displayName, department: 'หน่วยงานใหม่', jobTitle: 'เจ้าหน้าที่ใหม่', isActive: true, deletedAt: null };
}

function transferEvent(employeeId, displayName) {
  return {
    employeeId, effectiveDate: new Date('2026-09-01T00:00:00.000Z'), sequence: 1,
    oldValue: { employee: { firstName: displayName.split(' ')[0], lastName: displayName.split(' ').slice(1).join(' '), displayName, department: 'หน่วยงานเดิม', jobTitle: 'เจ้าหน้าที่เดิม', isActive: true } },
    newValue: { employee: { firstName: displayName.split(' ')[0], lastName: displayName.split(' ').slice(1).join(' '), displayName, department: 'หน่วยงานใหม่', jobTitle: 'เจ้าหน้าที่ใหม่', isActive: true } }
  };
}

test('SCH-HIST-01 keeps 31 Aug on old department and applies transfer from 1 Sep for real regression cases', async () => {
  const employees = [employee('emp-apisak', 'อภิศักดิ์ ภิญโญยิ่งทรัพย์'), employee('emp-kittisak', 'เกรียติศักดิ์ ฉิมจีน')];
  const events = employees.map((row) => transferEvent(row.id, row.displayName));
  const client = { employeeLifecycleEvent: { findMany: async () => events } };
  const resolve = await createSchedulePersonnelResolver(client, employees);
  for (const row of employees) {
    assert.equal(resolve(row.id, new Date('2026-08-31T00:00:00.000Z')).department, 'หน่วยงานเดิม');
    assert.equal(resolve(row.id, new Date('2026-08-31T00:00:00.000Z')).jobTitle, 'เจ้าหน้าที่เดิม');
    assert.equal(resolve(row.id, new Date('2026-09-01T00:00:00.000Z')).department, 'หน่วยงานใหม่');
    assert.equal(resolve(row.id, new Date('2026-09-01T00:00:00.000Z')).jobTitle, 'เจ้าหน้าที่ใหม่');
  }
});

test('historical assignment enrichment repairs stale current snapshots without mutating stored rows', async () => {
  const row = employee('emp-apisak', 'อภิศักดิ์ ภิญโญยิ่งทรัพย์');
  const event = transferEvent(row.id, row.displayName);
  const client = { employeeLifecycleEvent: { findMany: async () => [event] } };
  const stored = { employeeId: row.id, workDate: new Date('2026-08-15T00:00:00.000Z'), employeeNameSnapshot: row.displayName, departmentSnapshot: 'หน่วยงานใหม่' };
  const [view] = await enrichScheduleAssignments(client, [stored], [row]);
  assert.equal(stored.departmentSnapshot, 'หน่วยงานใหม่');
  assert.equal(view.departmentSnapshot, 'หน่วยงานเดิม');
  assert.equal(view.positionSnapshot, 'เจ้าหน้าที่เดิม');
});

test('schedule calendar and approved export resolve historical personnel instead of filtering on current Employee.department', () => {
  const operations = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'operations.routes.js'), 'utf8').replace(/\r\n/g, '\n');
  const calendarStart = operations.indexOf("router.get('/schedule-calendar'");
  const calendarEnd = operations.indexOf("router.post('/schedule/auto-preview'", calendarStart);
  const calendar = operations.slice(calendarStart, calendarEnd);
  assert.match(calendar, /createSchedulePersonnelResolver/);
  assert.doesNotMatch(calendar, /filters\.department && \{ department: filters\.department \}/);
  assert.match(calendar, /historicalEmployees/);
  const exportStart = operations.indexOf("router.post('/schedule/export.xlsx'");
  const exportEnd = operations.indexOf("router.post('/schedule/approve-month'", exportStart);
  const exportBlock = operations.slice(exportStart, exportEnd);
  assert.match(exportBlock, /enrichScheduleAssignments/);
  assert.match(exportBlock, /historicalShifts/);
});

test('schedule writes snapshot personnel state for each work date, not current Employee master values', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'schedule.service.js'), 'utf8');
  assert.match(source, /resolvePersonnel\(ass\.employeeId, parsedDate\)/);
  assert.match(source, /employeeNameSnapshot: personnelState\.displayName/);
  assert.match(source, /departmentSnapshot: personnelState\.department/);
});
