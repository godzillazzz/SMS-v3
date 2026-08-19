process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { logger } = require('../src/utils/logger');
const { QUERY_OPERATION_COUNT, bangkokDateStart, currentBangkokPeriod, leaveScopeWhere, operationalLeaveScopeWhere, resolveReportScope, getExecutiveReport } = require('../src/services/executive-report.service');

function reportClient(calls = []) {
  const record = (name, value) => async (query) => { calls.push({ name, query }); return value; };
  return {
    $queryRaw: record('workforce.snapshot', [
      { department: 'Operations', total: 3, active: 3 },
      { department: 'Other', total: 1, active: 0 }
    ]),
    shiftAssignment: { count: record('shiftAssignment.count', 8) },
    leaveRequest: { count: record('leaveRequest.count', 0), groupBy: async (query) => { calls.push({ name: 'leaveRequest.groupBy', query }); return query.by[0] === 'status' ? [{ status: 'PENDING', _count: { _all: 1 } }, { status: 'APPROVED', _count: { _all: 2 } }] : [{ leaveType: 'ลาป่วย', _count: { _all: 3 } }]; } },
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
  assert.deepEqual(operationalLeaveScopeWhere({ department: 'Operations' }, { startDate: new Date('2026-08-01T00:00:00Z'), nextMonthStart: new Date('2026-09-01T00:00:00Z') }).employee, { is: { isActive: true, deletedAt: null, department: 'Operations' } });
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
  assert.equal(report.leave.actionablePendingCount, 0);
  assert.ok(calls.filter((call) => call.name === 'employeeLicenseDocument.count').every((call) => call.query.where.employee.is.isActive === true));
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
  client.leaveRequest.count = async () => 0;
  client.leaveQuota.count = async () => 0;
  client.employeeLicenseDocument.count = async () => 0;
  const report = await getExecutiveReport({ prismaClient: client, requestUser: { role: 'MANAGER', department: 'Operations', employeeId: null }, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00.000Z') });
  assert.equal(report.executiveSummary.every((item) => item.value === 0), true);
  assert.deepEqual(report.managementAttention, []);
});

test('Executive Report performance instrumentation executes safely with a truthy requestId', async () => {
  const events = [];
  const originalInfo = logger.info;
  logger.info = (event, fields) => { events.push({ event, fields }); };
  try {
    const report = await getExecutiveReport({
      prismaClient: reportClient(),
      requestUser: { role: 'ADMIN', department: null, employeeId: null },
      filters: { year: 2026, month: 8 },
      now: new Date('2026-08-10T00:00:00.000Z'),
      requestId: 'uat-regression-request'
    });
    assert.equal(report.meta.queryStrategy, 'sequential');
  } finally {
    logger.info = originalInfo;
  }

  assert.ok(events.length > 0);
  assert.deepEqual(new Set(events.map(({ fields }) => fields.stage)), new Set([
    'EXEC_WORKFORCE_ASOF',
    'EXEC_SCHEDULE',
    'EXEC_LEAVE',
    'EXEC_DATA_QUALITY',
    'EXEC_LICENSE'
  ]));
  for (const { event, fields } of events) {
    assert.equal(event, 'performance_stage');
    assert.deepEqual(Object.keys(fields).sort(), ['durationMs', 'operation', 'queryCount', 'requestId', 'stage', 'status']);
    assert.equal(fields.requestId, 'uat-regression-request');
    assert.equal(fields.operation, 'executive-report');
    assert.equal(fields.status, 'ok');
    assert.equal(Number.isFinite(fields.durationMs), true);
    assert.equal(Number.isInteger(fields.queryCount), true);
  }
});

test('Executive Report timing instrumentation preserves the original stage error', async () => {
  const expected = new Error('synthetic executive stage failure');
  const client = reportClient();
  client.shiftAssignment.count = async () => { throw expected; };
  const events = [];
  const originalInfo = logger.info;
  logger.info = (event, fields) => { events.push({ event, fields }); };
  try {
    await assert.rejects(
      getExecutiveReport({
        prismaClient: client,
        requestUser: { role: 'ADMIN', department: null, employeeId: null },
        filters: { year: 2026, month: 8 },
        now: new Date('2026-08-10T00:00:00.000Z'),
        requestId: 'uat-regression-request-error'
      }),
      (error) => error === expected
    );
  } finally {
    logger.info = originalInfo;
  }
  const failedStage = events.find(({ fields }) => fields.stage === 'EXEC_SCHEDULE');
  assert.ok(failedStage);
  assert.equal(failedStage.event, 'performance_stage');
  assert.equal(failedStage.fields.status, 'error');
});
