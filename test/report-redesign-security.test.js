'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPatrolService } = require('../src/services/patrol.service');
const { resolveReportScope, getExecutiveReport } = require('../src/services/executive-report.service');

const admin = { role: 'ADMIN' };

function client() {
  return {
    $queryRaw: async () => [],
    shiftAssignment: { count: async () => 0, findMany: async () => [] },
    patrolCheckpoint: { findMany: async () => [] },
    patrolScan: { findMany: async () => [] },
    leaveRequest: {
      count: async () => 0,
      groupBy: async () => [],
      findMany: async () => []
    },
    leaveQuota: {
      count: async () => 0,
      findMany: async ({ where }) => where?.quotaYear === null ? [{ id: 'global-synthetic-quota', matchStatus: 'UNMATCHED' }] : [],
      groupBy: async () => [{ employeeId: 'synthetic-employee', quotaYear: 2026, _count: { _all: 2 } }]
    },
    employeeLicenseDocument: { count: async () => 0 }
  };
}

test('RED S1: SUPERVISOR cannot use patrol report filter to read another department', async () => {
  let reads = 0;
  const service = createPatrolService({ prisma: {
    patrolCheckpoint: { findMany: async () => { reads += 1; return []; } },
    patrolScan: { findMany: async () => { reads += 1; return []; } }
  } });
  await assert.rejects(
    service.report({ actor: { role: 'SUPERVISOR', department: 'AN1' }, from: '2026-08-01', to: '2026-08-01', department: 'AN2' }),
    (error) => error.statusCode === 403
  );
  assert.equal(reads, 0);
});

test('RED S2: non-ADMIN report scope without department fails closed', () => {
  assert.throws(
    () => resolveReportScope({ role: 'SUPERVISOR', department: null, employeeId: 'synthetic-employee' }),
    (error) => error.statusCode === 403
  );
});

test('RED S3: non-ADMIN executive report never serializes an unfilterable global critical count', async () => {
  const report = await getExecutiveReport({
    prismaClient: client(),
    requestUser: { role: 'SUPERVISOR', department: 'AN1' },
    filters: { year: 2026, month: 8 },
    now: new Date('2026-08-10T00:00:00Z')
  });
  const kpi = report.executiveSummary.find((item) => item.key === 'criticalDataQuality');
  assert.equal(kpi?.value, 0, 'global custom-rule rows (1 unclassified + 1 duplicate group) are not counted');
  assert.equal(kpi?.unavailableLabel, 'ไม่พร้อมใน scope');
  assert.equal(report.dataQualityAvailability, 'PARTIAL_SCOPE');
});

test('RED KPI 1/2 regression: no-base rate is null and prior check-in/absence aggregates exist', async () => {
  const report = await getExecutiveReport({
    prismaClient: client(),
    requestUser: { role: 'ADMIN' },
    filters: { year: 2026, month: 8 },
    now: new Date('2026-08-10T00:00:00Z')
  });
  assert.equal(report.attendance.attendanceRate, null);
  assert.equal(report.executiveSummary.find((item) => item.key === 'attendanceRate')?.value, null);
  assert.equal(typeof report.attendance.absentAssignments, 'number');
});
