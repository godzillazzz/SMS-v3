process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAutoSchedulePlan, buildEmployeeAutoSchedulePlan, monthBounds, suggestedPhase } = require('../src/services/auto-schedule.service');

const shiftTypes = [
  { id: 'shift-d', code: 'D', name: 'Day', startTime: '08:00', endTime: '20:00', hours: 12, color: '#10B981' },
  { id: 'shift-n', code: 'N', name: 'Night', startTime: '20:00', endTime: '08:00', hours: 12, color: '#7C3AED' },
  { id: 'shift-off', code: 'OFF', name: 'Off', startTime: null, endTime: null, hours: 0, color: '#EF4444' },
  { id: 'shift-al', code: 'AL', name: 'Leave', startTime: null, endTime: null, hours: 0, color: '#3B82F6' }
];
const employees = [
  { id: 'supervisor', employeeCode: 'SAMPLE-SUP', displayName: 'Sample Supervisor', firstName: 'Sample', lastName: 'Supervisor', department: 'SAMPLE', jobTitle: 'Supervisor' },
  { id: 'worker', employeeCode: 'SAMPLE-WRK', displayName: 'Sample Worker', firstName: 'Sample', lastName: 'Worker', department: 'SAMPLE', jobTitle: 'Security Officer' }
];
const licenses = employees.map((employee) => ({ employeeId: employee.id, issueDate: new Date('2020-01-01T00:00:00Z'), expiryDate: new Date('2030-01-01T00:00:00Z'), status: 'Active' }));

function client({ current = [], history = [], employeeRows = employees, licenseRows = licenses } = {}) {
  let shiftQuery = 0;
  return {
    schedulingRule: { findMany: async () => [{ ruleId: 'RULE001', value: '72', enabled: true }] },
    employee: { findMany: async () => employeeRows },
    shiftType: { findMany: async () => shiftTypes },
    shiftAssignment: { findMany: async () => (++shiftQuery === 1 ? current : history) },
    employeeLicense: { findMany: async () => licenseRows }
  };
}

test('auto schedule preview follows Supervisor and six-day rotating patterns without writing', async () => {
  const plan = await buildAutoSchedulePlan(client(), '2026-07');
  assert.equal(plan.summary.employees, 2);
  assert.equal(plan.rows.length, 62);
  const supervisorSunday = plan.rows.find((row) => row.employeeId === 'supervisor' && row.date === '2026-07-05');
  assert.equal(supervisorSunday.code, 'OFF');
  assert.deepEqual(plan.rows.filter((row) => row.employeeId === 'worker').slice(0, 7).map((row) => row.code), ['D', 'D', 'D', 'D', 'D', 'D', 'OFF']);
});

test('auto schedule preview preserves locked and approved-leave assignments', async () => {
  const current = [
    { employeeId: 'worker', workDate: new Date('2026-07-01T00:00:00Z'), locked: true, source: 'MANUAL', remark: 'keep', licenseOverride: false, shiftType: shiftTypes[1] },
    { employeeId: 'worker', workDate: new Date('2026-07-02T00:00:00Z'), locked: false, source: 'LEAVE_APPROVAL', remark: 'leave', licenseOverride: false, shiftType: shiftTypes[3] }
  ];
  const plan = await buildAutoSchedulePlan(client({ current }), '2026-07');
  assert.equal(plan.rows.find((row) => row.employeeId === 'worker' && row.date === '2026-07-01').code, 'N');
  assert.equal(plan.rows.find((row) => row.employeeId === 'worker' && row.date === '2026-07-02').code, 'AL');
  assert.equal(plan.summary.manualLocked, 2);
});

test('individual magic-wand plan writes only the selected employee six-on/one-off rotation', async () => {
  const plan = await buildEmployeeAutoSchedulePlan(client(), '2026-07', 'worker');
  assert.equal(plan.summary.employees, 1);
  assert.equal(plan.rows.length, 31);
  assert.ok(plan.rows.every((row) => row.employeeId === 'worker'));
  assert.deepEqual(plan.rows.slice(0, 7).map((row) => row.code), ['D', 'D', 'D', 'D', 'D', 'D', 'OFF']);
});

test('auto schedule substitutes OFF and warns when a working license is unavailable', async () => {
  const plan = await buildAutoSchedulePlan(client({ licenseRows: licenses.filter((license) => license.employeeId !== 'worker') }), '2026-07');
  assert.ok(plan.rows.filter((row) => row.employeeId === 'worker').every((row) => row.code === 'OFF'));
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /Sample Worker/);
});

test('individual magic-wand converts an expired-license work pattern to OFF License Block rows', async () => {
  const plan = await buildEmployeeAutoSchedulePlan(client({ licenseRows: licenses.filter((license) => license.employeeId !== 'worker') }), '2026-07', 'worker', 'D1', 'ROTATE');
  assert.ok(plan.rows.every((row) => row.code === 'OFF'));
  assert.ok(plan.rows.some((row) => String(row.remark).includes('License Block')));
});

test('individual magic-wand replaces a prior locked License Block when a renewal is effective', async () => {
  const current = [{
    employeeId: 'worker', workDate: new Date('2026-07-26T00:00:00Z'), locked: true, source: 'MANUAL',
    remark: 'License Block', licenseStatus: 'EXPIRED', licenseOverride: false,
    licenseBlockedFromShiftTypeId: 'shift-d', licenseBlockedFromRemark: 'Auto rotating pattern (D1)', shiftType: shiftTypes[2]
  }];
  const renewed = [
    { employeeId: 'worker', issueDate: new Date('2026-07-26T00:00:00Z'), expiryDate: new Date('2027-07-25T00:00:00Z'), status: 'Active' },
    ...licenses.filter((license) => license.employeeId !== 'worker')
  ];
  const plan = await buildEmployeeAutoSchedulePlan(client({ current, licenseRows: renewed }), '2026-07', 'worker', 'D1', 'ROTATE');
  const day = plan.rows.find((row) => row.date === '2026-07-26');
  assert.equal(day.code, 'N');
  assert.equal(day.locked, false);
  assert.equal(day.licenseStatus, 'VALID');
  assert.equal(day.licenseBlockedFromShiftTypeId, null);
});

test('individual magic-wand retains an existing Admin license override during an expired interval', async () => {
  const current = [{
    employeeId: 'worker', workDate: new Date('2026-07-01T00:00:00Z'), locked: true, source: 'MANUAL',
    remark: 'Admin coverage', licenseStatus: 'OVERRIDDEN', licenseOverride: true, overrideReason: 'Approved coverage', shiftType: shiftTypes[1]
  }];
  const plan = await buildEmployeeAutoSchedulePlan(client({ current, licenseRows: licenses.filter((license) => license.employeeId !== 'worker') }), '2026-07', 'worker', 'D1', 'ROTATE');
  const override = plan.rows.find((row) => row.date === '2026-07-01');
  assert.equal(override.code, 'N');
  assert.equal(override.locked, true);
  assert.equal(override.licenseOverride, true);
  assert.equal(override.licenseStatus, 'OVERRIDDEN');
});

test('the latest magic-wand action replaces prior manual shifts but keeps leave and Admin overrides', async () => {
  const current = [
    { employeeId: 'worker', workDate: new Date('2026-07-01T00:00:00Z'), locked: true, source: 'MANUAL', remark: 'old manual', licenseOverride: false, shiftType: shiftTypes[2] },
    { employeeId: 'worker', workDate: new Date('2026-07-02T00:00:00Z'), locked: true, source: 'MANUAL', remark: 'admin coverage', licenseStatus: 'OVERRIDDEN', licenseOverride: true, shiftType: shiftTypes[1] },
    { employeeId: 'worker', workDate: new Date('2026-07-03T00:00:00Z'), locked: true, source: 'LEAVE_APPROVAL', remark: 'leave', licenseOverride: false, shiftType: shiftTypes[3] }
  ];
  const plan = await buildEmployeeAutoSchedulePlan(client({ current }), '2026-07', 'worker', 'D1', 'ROTATE');
  const first = plan.rows.find((row) => row.date === '2026-07-01');
  const override = plan.rows.find((row) => row.date === '2026-07-02');
  const leave = plan.rows.find((row) => row.date === '2026-07-03');
  assert.equal(first.code, 'D');
  assert.equal(first.locked, false);
  assert.equal(override.code, 'N');
  assert.equal(override.licenseOverride, true);
  assert.equal(leave.code, 'AL');
});

test('auto schedule date and history helpers are deterministic', () => {
  assert.equal(monthBounds('2026-02').dates.length, 28);
  assert.equal(suggestedPhase([{ shiftType: { code: 'D' } }, { shiftType: { code: 'D' } }]), 'D3');
  assert.equal(suggestedPhase([{ shiftType: { code: 'OFF' } }, { shiftType: { code: 'D' } }]), 'N1');
});
