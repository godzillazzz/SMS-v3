process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateScheduleRules, isoWeek } = require('../src/services/schedule-rules.service');

const employee = { id: 'employee-1', employeeCode: 'SAMPLE-001', displayName: 'Sample Employee', department: 'PO11', jobTitle: 'Supervisor' };
const shift = (date, code = 'D', hours = 8, extra = {}) => ({ employeeId: employee.id, workDate: new Date(`${date}T00:00:00Z`), startTime: code === 'N' ? '20:00' : '08:00', hours, licenseStatus: 'VALID', shiftType: { code }, ...extra });

test('ISO week calculation is deterministic at year boundaries', () => {
  assert.equal(isoWeek(new Date('2026-01-01T00:00:00Z')), '2026-W01');
});

test('rule evaluation detects weekly-hour and Supervisor violations', () => {
  const rules = [
    { ruleId: 'RULE001', name: 'Weekly hours', value: '40', enabled: true },
    { ruleId: 'RULE006', name: 'Supervisor schedule', value: '1', enabled: true }
  ];
  const shifts = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11'].map((date) => shift(date));
  shifts.push(shift('2026-07-12', 'D'));
  const result = evaluateScheduleRules({ rules, employees: [employee], shifts, leaves: [], dates: shifts.map((item) => item.workDate.toISOString().slice(0, 10)) });
  assert.ok(result.violations.some((item) => item.ruleId === 'RULE001'));
  assert.ok(result.violations.some((item) => item.ruleId === 'RULE006'));
});

test('rule evaluation detects approved-leave conflicts and invalid licenses', () => {
  const workDate = new Date('2026-07-15T00:00:00Z');
  const result = evaluateScheduleRules({
    rules: [{ ruleId: 'RULE005', name: 'Leave conflict', value: '1', enabled: true }],
    employees: [employee], shifts: [shift('2026-07-15', 'D', 8, { licenseStatus: 'INVALID' })],
    leaves: [{ employeeId: employee.id, startDate: workDate, endDate: workDate }], dates: ['2026-07-15']
  });
  assert.ok(result.violations.some((item) => item.ruleId === 'RULE005'));
  assert.ok(result.violations.some((item) => item.ruleId === 'LICENSE'));
});
