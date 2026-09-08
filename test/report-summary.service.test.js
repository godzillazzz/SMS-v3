process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReportSummaryWhere, summaryPeriod, getReportSummary } = require('../src/services/report-summary.service');

test('report summary uses Bangkok month boundaries and department scope for every aggregate', () => {
  const period = summaryPeriod({ year: 2026, month: 8 }, new Date('2026-08-10T00:00:00.000Z'));
  assert.equal(period.startDate.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(period.nextMonthStart.toISOString(), '2026-09-01T00:00:00.000Z');
  const where = buildReportSummaryWhere({ scope: { department: 'Operations', employeeId: null }, period });
  assert.deepEqual(where.employees, { deletedAt: null, department: 'Operations' });
  assert.deepEqual(where.activeEmployees, { deletedAt: null, department: 'Operations', isActive: true });
  assert.deepEqual(where.shifts, { workDate: { gte: period.startDate, lt: period.nextMonthStart }, departmentSnapshot: 'Operations' });
  assert.deepEqual(where.leaveRequests, { startDate: { lt: period.nextMonthStart }, endDate: { gte: period.startDate }, departmentSnapshot: 'Operations' });
  assert.deepEqual(where.leaveQuotas, { quotaYear: 2026, employee: { is: { deletedAt: null, department: 'Operations' } } });
  assert.deepEqual(where.users, { department: 'Operations' });
});

test('report summary executes scoped counts and returns period/scope metadata', async () => {
  const calls = [];
  const count = (model, value) => async ({ where }) => { calls.push({ model, where }); return value; };
  const client = {
    $transaction: async (queries) => Promise.all(queries),
    employee: { count: count('employee', 4) },
    employeeLicense: { count: count('employeeLicense', 3) },
    shiftAssignment: { count: count('shiftAssignment', 8) },
    leaveRequest: { count: count('leaveRequest', 2) },
    leaveQuota: { count: count('leaveQuota', 4) },
    user: { count: count('user', 1) }
  };
  const result = await getReportSummary({
    prismaClient: client,
    requestUser: { role: 'ADMIN', department: null, employeeId: null },
    filters: { year: 2026, month: 8, department: 'Operations' },
    now: new Date('2026-08-10T00:00:00.000Z')
  });
  assert.deepEqual(result, {
    employees: 4, activeEmployees: 4, licenses: 3, shifts: 8, leaveRequests: 2, leaveQuotas: 4, users: 1,
    period: { year: 2026, month: 8, startDate: '2026-08-01', endDate: '2026-08-31' },
    scope: { department: 'Operations', employeeId: null, label: 'Operations' }
  });
  assert.equal(calls.length, 7);
  assert.ok(calls.some(({ model, where }) => model === 'shiftAssignment' && where.departmentSnapshot === 'Operations'));
});

test('report summary rejects a manager widening department scope', async () => {
  await assert.rejects(
    getReportSummary({ prismaClient: {}, requestUser: { role: 'MANAGER', department: 'Operations', employeeId: null }, filters: { department: 'Other' } }),
    (error) => error?.statusCode === 403
  );
});
