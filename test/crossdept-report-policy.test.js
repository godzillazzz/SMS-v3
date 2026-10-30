'use strict';

// OWNER policy 2026-10-30 (and 18 Oct 2026, src/services/attendance-supervisor.service.js
// "MANAGER/SUPERVISOR are cross-department executives"): a department is only a place of work;
// every MANAGER and SUPERVISOR supervises all VIEWERs. Read/report scope for MANAGER/SUPERVISOR is
// therefore the same as ADMIN (all departments + optional department filter). ADMIN-only routes and
// write/approval rights are unchanged; VIEWER stays limited to its own data.

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPatrolService } = require('../src/services/patrol.service');
const { resolveReportScope, getExecutiveReport } = require('../src/services/executive-report.service');
const { getReportSummary } = require('../src/services/report-summary.service');

function client() {
  return {
    $queryRaw: async () => [],
    shiftAssignment: { count: async () => 0, findMany: async () => [] },
    patrolCheckpoint: { findMany: async () => [] },
    patrolScan: { findMany: async () => [] },
    leaveRequest: { count: async () => 0, groupBy: async () => [], findMany: async () => [] },
    leaveQuota: {
      count: async () => 0,
      findMany: async ({ where }) => where?.quotaYear === null ? [{ id: 'global-synthetic-quota', matchStatus: 'UNMATCHED' }] : [],
      groupBy: async () => [{ employeeId: 'synthetic-employee', quotaYear: 2026, _count: { _all: 2 } }]
    },
    employeeLicenseDocument: { count: async () => 0 },
    employee: { count: async () => 0 }
  };
}

test('MANAGER/SUPERVISOR report scope is all departments with a free department filter, even without an own department', () => {
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR']) {
    for (const department of [null, 'AN1']) {
      assert.deepEqual(resolveReportScope({ role, department }), { department: null, employeeId: null, label: 'ทุกหน่วยงาน', allowsDepartmentFilter: true });
      assert.deepEqual(resolveReportScope({ role, department }, 'AN2'), { department: 'AN2', employeeId: null, label: 'AN2', allowsDepartmentFilter: true });
    }
  }
});

test('VIEWER (and unknown roles) still have no report-center scope', () => {
  for (const role of ['VIEWER', '', undefined]) {
    assert.throws(() => resolveReportScope({ role, department: 'AN1' }), (error) => error.statusCode === 403);
  }
});

test('MANAGER without a department gets the executive report with system-wide critical data quality like ADMIN', async () => {
  const report = await getExecutiveReport({ prismaClient: client(), requestUser: { role: 'MANAGER', department: null }, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00Z') });
  const kpi = report.executiveSummary.find((item) => item.key === 'criticalDataQuality');
  assert.equal(report.scope.departmentName, 'ทุกหน่วยงาน');
  assert.equal(report.scope.allowsDepartmentFilter, true);
  assert.equal(report.dataQualityAvailability, 'AVAILABLE');
  assert.equal(kpi.value, 2, 'global custom rules are counted (1 unclassified + 1 duplicate group)');
  assert.equal(kpi.unavailableLabel, undefined);
  assert.equal(kpi.targetPath, null, 'the ADMIN-only data-quality page is still never linked for MANAGER');
});

test('SUPERVISOR in AN1 may filter the executive report to another department', async () => {
  const report = await getExecutiveReport({ prismaClient: client(), requestUser: { role: 'SUPERVISOR', department: 'AN1' }, filters: { year: 2026, month: 8, department: 'AN2' }, now: new Date('2026-08-10T00:00:00Z') });
  assert.equal(report.scope.departmentName, 'AN2');
});

test('report summary accepts MANAGER without a department and a SUPERVISOR department filter', async () => {
  const counter = { count: async () => 0 };
  const proxy = { $transaction: async (calls) => Promise.all(calls), employee: counter, employeeLicense: counter, shiftAssignment: counter, leaveRequest: counter, leaveQuota: counter, user: counter };
  const managerSummary = await getReportSummary({ prismaClient: proxy, requestUser: { role: 'MANAGER', department: null }, filters: { year: 2026, month: 8 } });
  assert.equal(managerSummary.scope.label, 'ทุกหน่วยงาน');
  const supervisorSummary = await getReportSummary({ prismaClient: proxy, requestUser: { role: 'SUPERVISOR', department: 'AN1' }, filters: { year: 2026, month: 8, department: 'AN2' } });
  assert.equal(supervisorSummary.scope.department, 'AN2');
});

test('SUPERVISOR patrol report may read department=B and MANAGER sees all departments without a user lookup', async () => {
  const reads = [];
  const lookups = [];
  const service = createPatrolService({ prisma: {
    patrolCheckpoint: { findMany: async ({ where }) => { reads.push(where); return []; } },
    patrolScan: { findMany: async ({ where }) => { reads.push(where); return []; } },
    user: { findUnique: async ({ where }) => { lookups.push(where); return null; } }
  } });
  const filtered = await service.report({ actor: { sub: 'not-a-uuid', role: 'SUPERVISOR', department: 'AN1' }, from: '2026-08-01', to: '2026-08-01', department: 'AN2' });
  assert.equal(filtered.department, 'AN2');
  assert.equal(reads[0].department, 'AN2');
  assert.equal(reads[1].checkpointDepartment, 'AN2');
  reads.length = 0;
  const all = await service.report({ actor: { sub: 'm', role: 'MANAGER' }, from: '2026-08-01', to: '2026-08-01' });
  assert.equal(all.department, null);
  assert.equal('department' in reads[0], false, 'no department pin for MANAGER');
  assert.equal('checkpointDepartment' in reads[1], false);
  assert.deepEqual(lookups, [], 'no user lookup, so a non-UUID subject can never cause a 500');
  await assert.rejects(service.report({ actor: { sub: 'v', role: 'VIEWER' }, from: '2026-08-01', to: '2026-08-01' }), (error) => error.statusCode === 403);
});
