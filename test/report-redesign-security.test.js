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

// OWNER policy 2026-10-30: MANAGER/SUPERVISOR are cross-department supervisors (department = place of work only).
// S1 previously rejected a SUPERVISOR patrol filter for another department; it is now allowed like ADMIN.
test('S1 (OWNER policy 2026-10-30): SUPERVISOR may use the patrol report filter for another department', async () => {
  const reads = [];
  const service = createPatrolService({ prisma: {
    patrolCheckpoint: { findMany: async ({ where }) => { reads.push(where); return []; } },
    patrolScan: { findMany: async ({ where }) => { reads.push(where); return []; } }
  } });
  const report = await service.report({ actor: { role: 'SUPERVISOR', department: 'AN1' }, from: '2026-08-01', to: '2026-08-01', department: 'AN2' });
  assert.equal(report.department, 'AN2');
  assert.equal(reads[0].department, 'AN2');
  assert.equal(reads[1].checkpointDepartment, 'AN2');
});

// S2 previously failed closed for a SUPERVISOR without a department; the scope is now all departments.
test('S2 (OWNER policy 2026-10-30): SUPERVISOR without department gets the all-department scope; VIEWER still fails closed', () => {
  assert.deepEqual(resolveReportScope({ role: 'SUPERVISOR', department: null, employeeId: 'synthetic-employee' }), { department: null, employeeId: null, label: 'ทุกหน่วยงาน', allowsDepartmentFilter: true });
  assert.throws(() => resolveReportScope({ role: 'VIEWER', department: 'AN1', employeeId: 'synthetic-employee' }), (error) => error.statusCode === 403);
});

// S3 previously withheld system-wide rules for SUPERVISOR; the all-department view now counts them like ADMIN.
test('S3 (OWNER policy 2026-10-30): SUPERVISOR all-department executive report counts system-wide critical rules like ADMIN', async () => {
  const report = await getExecutiveReport({
    prismaClient: client(),
    requestUser: { role: 'SUPERVISOR', department: 'AN1' },
    filters: { year: 2026, month: 8 },
    now: new Date('2026-08-10T00:00:00Z')
  });
  const kpi = report.executiveSummary.find((item) => item.key === 'criticalDataQuality');
  assert.equal(kpi?.value, 2, 'global custom-rule rows (1 unclassified + 1 duplicate group) are counted');
  assert.equal(kpi?.unavailableLabel, undefined);
  assert.equal(kpi?.targetPath, null, 'the ADMIN-only data-quality page is never linked');
  assert.equal(report.dataQualityAvailability, 'AVAILABLE');
});

test('S3: a department-filtered view still withholds the system-wide rules that cannot be filtered (any role)', async () => {
  for (const requestUser of [admin, { role: 'SUPERVISOR', department: 'AN1' }]) {
    const report = await getExecutiveReport({ prismaClient: client(), requestUser, filters: { year: 2026, month: 8, department: 'AN2' }, now: new Date('2026-08-10T00:00:00Z') });
    const kpi = report.executiveSummary.find((item) => item.key === 'criticalDataQuality');
    assert.equal(kpi?.value, 0);
    assert.equal(kpi?.unavailableLabel, 'ไม่พร้อมใน scope');
    assert.equal(report.dataQualityAvailability, 'PARTIAL_SCOPE');
  }
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
