process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { QUERY_OPERATION_COUNT, bangkokDateStart, currentBangkokPeriod, leaveScopeWhere, resolveReportScope, getExecutiveReport } = require('../src/services/executive-report.service');

function reportClient(calls = []) {
  const record = (name, value) => async (query) => { calls.push({ name, query }); return value; };
  return {
    $queryRaw: record('workforce.snapshot', [
      { department: 'Operations', total: 3, active: 3 },
      { department: 'Other', total: 1, active: 0 }
    ]),
    shiftAssignment: { count: record('shiftAssignment.count', 8) },
    leaveRequest: { groupBy: async (query) => { calls.push({ name: 'leaveRequest.groupBy', query }); return query.by[0] === 'status' ? [{ status: 'PENDING', _count: { _all: 1 } }, { status: 'APPROVED', _count: { _all: 2 } }] : [{ leaveType: 'ลาป่วย', _count: { _all: 3 } }]; } },
    leaveQuota: { count: record('leaveQuota.count', 1) },
    employeeLicenseDocument: { count: async (query) => { calls.push({ name: 'employeeLicenseDocument.count', query }); return query.where.status === 'PENDING' ? 1 : 6; } }
  };
}

test('Executive Report uses Bangkok current period and exact leave overlap month rule', () => {
  assert.deepEqual(currentBangkokPeriod(new Date('2026-08-31T18:00:00.000Z')), { year: 2026, month: 9 });
  assert.equal(bangkokDateStart(new Date('2026-08-31T18:00:00.000Z')).toISOString(), '2026-09-01T00:00:00.000Z');
  const where = leaveScopeWhere({ department: 'Operations' }, { startDate: new Date('2026-08-01T00:00:00Z'), nextMonthStart: new Date('2026-09-01T00:00:00Z') });
  assert.deepEqual(where.startDate, { lt: new Date('2026-09-01T00:00:00Z') });
  assert.deepEqual(where.endDate, { gte: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(where.employee, { is: { deletedAt: null, department: 'Operations' } });
  const historical = require('../src/services/executive-report.service').historicalLeaveScopeWhere({ department: 'Operations' }, { startDate: new Date('2026-08-01T00:00:00Z'), nextMonthStart: new Date('2026-09-01T00:00:00Z') });
  assert.equal(historical.departmentSnapshot, 'Operations');
  assert.equal(historical.employee, undefined);
});

test('Executive Report scopes ADMIN globally or by requested department and keeps MANAGER restricted', () => {
  assert.deepEqual(resolveReportScope({ role: 'ADMIN' }, 'Operations'), { department: 'Operations', employeeId: null, label: 'Operations', allowsDepartmentFilter: true });
  assert.deepEqual(resolveReportScope({ role: 'MANAGER', department: 'Operations', employeeId: 'employee-1' }), { department: 'Operations', employeeId: null, label: 'Operations', allowsDepartmentFilter: false });
  assert.throws(() => resolveReportScope({ role: 'MANAGER', department: 'Operations' }, 'Other'), { statusCode: 403 });
});

test('Executive Report returns factual aggregates with deterministic attention and sequential bounded calls', async () => {
  const calls = [];
  const report = await getExecutiveReport({ prismaClient: reportClient(calls), requestUser: { role: 'ADMIN', department: null, employeeId: null }, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(report.period.label.includes('2569'), true);
  assert.equal(report.schedule.assignmentCount, 8);
  assert.equal(report.leave.totalRequests, 3);
  assert.equal(report.license.expired, 6);
  assert.equal(report.dataQuality.total, 19);
  assert.equal(report.meta.queryOperationCount, QUERY_OPERATION_COUNT);
  assert.equal(report.meta.queryStrategy, 'sequential');
  assert.ok(report.managementAttention.length <= 5);
  assert.equal(calls.length, QUERY_OPERATION_COUNT);
  assert.equal(calls[0].name, 'workforce.snapshot');
  const workforceSql = calls[0].query.strings.join(' ');
  assert.match(workforceSql, /employee_lifecycle_events/);
  assert.match(workforceSql, /DISTINCT ON \(employee_id\)/);
  assert.match(workforceSql, /e\.hired_at/);
  assert.doesNotMatch(workforceSql, /SELECT e\.\*/);
  assert.equal(calls.at(-1).name, 'employeeLicenseDocument.count');
});

test('Executive Report accepts empty data as zero rather than an unavailable value', async () => {
  const client = reportClient();
  client.$queryRaw = async () => [];
  client.shiftAssignment.count = async () => 0;
  client.leaveRequest.groupBy = async () => [];
  client.leaveQuota.count = async () => 0;
  client.employeeLicenseDocument.count = async () => 0;
  const report = await getExecutiveReport({ prismaClient: client, requestUser: { role: 'MANAGER', department: 'Operations', employeeId: null }, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(report.executiveSummary.every((item) => item.value === 0), true);
  assert.deepEqual(report.managementAttention, []);
});
