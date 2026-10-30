'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPatrolService, patrolRoundOf } = require('../src/services/patrol.service');
const { resolveReportScope, getExecutiveReport } = require('../src/services/executive-report.service');
const {
  departmentValues,
  departmentMatches,
  percentageOrNull,
  buildAttendanceMetrics,
  buildDepartmentRoundCoverage
} = require('../src/services/report-analytics.service');

const day = (value) => new Date(`${value}T00:00:00.000Z`);
const admin = { role: 'ADMIN' };

function reportPrisma() {
  return {
    $queryRaw: async () => [],
    shiftAssignment: { count: async () => 0, findMany: async () => [] },
    leaveRequest: { count: async () => 0, groupBy: async () => [], findMany: async () => [] },
    leaveQuota: { count: async () => 0, findMany: async () => [], groupBy: async () => [] },
    employeeLicenseDocument: { count: async () => 0, findMany: async () => [] },
    patrolCheckpoint: { findMany: async () => [] },
    patrolScan: { findMany: async () => [] }
  };
}

test('S1 patrol report rejects cross-department filters before any query and defaults to exact owned department tokens', async () => {
  const calls = [];
  const service = createPatrolService({ prisma: {
    patrolCheckpoint: { findMany: async ({ where }) => { calls.push(where); return []; } },
    patrolScan: { findMany: async ({ where }) => { calls.push(where); return []; } }
  } });
  const actor = { role: 'SUPERVISOR', department: 'AN1, AN2,AN3' };
  await assert.rejects(service.report({ actor, from: '2026-08-01', to: '2026-08-01', department: 'AN10' }), (error) => error.statusCode === 403);
  assert.deepEqual(calls, []);
  const report = await service.report({ actor, from: '2026-08-01', to: '2026-08-01' });
  assert.deepEqual(calls[0].department, { in: ['AN1', 'AN2', 'AN3'] });
  assert.deepEqual(calls[1].checkpointDepartment, { in: ['AN1', 'AN2', 'AN3'] });
  assert.deepEqual(report.departments, ['AN1', 'AN2', 'AN3']);
  const adminReport = await service.report({ actor: admin, from: '2026-08-01', to: '2026-08-01', department: 'AN10' });
  assert.equal(adminReport.department, 'AN10');
});

test('S1 patrol report loads the actor department from the user record (req.user has none) and fails closed when it is missing', async () => {
  const where = [];
  const SUP_1 = '0b6f5a2e-7d1c-4e3a-9b8f-1a2b3c4d5e01';
  const SUP_2 = '0b6f5a2e-7d1c-4e3a-9b8f-1a2b3c4d5e02';
  const users = { [SUP_1]: { department: 'AN2' }, [SUP_2]: { department: null } };
  const service = createPatrolService({ prisma: {
    user: { findUnique: async ({ where: lookup }) => users[lookup.id] || null },
    patrolCheckpoint: { findMany: async (query) => { where.push(query.where); return []; } },
    patrolScan: { findMany: async (query) => { where.push(query.where); return []; } }
  } });
  const report = await service.report({ actor: { sub: SUP_1, role: 'SUPERVISOR' }, from: '2026-08-01', to: '2026-08-01' });
  assert.equal(report.department, 'AN2');
  assert.equal(where[0].department, 'AN2');
  assert.equal(where[1].checkpointDepartment, 'AN2');
  await assert.rejects(service.report({ actor: { sub: SUP_1, role: 'MANAGER' }, from: '2026-08-01', to: '2026-08-01', department: 'AN1' }), (error) => error.statusCode === 403);
  await assert.rejects(service.report({ actor: { sub: SUP_2, role: 'SUPERVISOR' }, from: '2026-08-01', to: '2026-08-01' }), (error) => error.statusCode === 403);
  assert.equal(where.length, 2, 'no reads happen for rejected scopes');
});

test('S2 executive scope fails closed without department instead of falling back to employee ID', async () => {
  for (const role of ['MANAGER', 'SUPERVISOR']) {
    for (const department of [null, '', ' , ']) {
      assert.throws(() => resolveReportScope({ role, department, employeeId: 'synthetic-employee' }), (error) => error.statusCode === 403);
    }
    await assert.rejects(getExecutiveReport({ prismaClient: reportPrisma(), requestUser: { role, department: null, employeeId: 'synthetic-employee' }, filters: { year: 2026, month: 8 } }), (error) => error.statusCode === 403);
  }
  assert.equal(resolveReportScope({ role: 'ADMIN' }).department, null);
});

test('multi-department executive scope filters every source with exact tokens, never the raw substring', async () => {
  const seen = {};
  const client = reportPrisma();
  client.$queryRaw = async (query) => { seen.workforce = query.values; return []; };
  client.shiftAssignment.count = async ({ where }) => { seen.count = where.departmentSnapshot; return 0; };
  client.shiftAssignment.findMany = async ({ where }) => { seen.assignments = where.departmentSnapshot; return []; };
  client.leaveRequest.groupBy = async ({ where }) => { seen.leave = where.departmentSnapshot; return []; };
  client.patrolCheckpoint.findMany = async ({ where }) => { seen.checkpoints = where.department; return []; };
  client.patrolScan.findMany = async ({ where }) => { seen.scans = where.checkpointDepartment; return []; };
  client.employeeLicenseDocument.count = async ({ where }) => { seen.license = where.employee.is.department; return 0; };
  await getExecutiveReport({ prismaClient: client, requestUser: { role: 'SUPERVISOR', department: 'AN1, AN2,AN3' }, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00Z') });
  const exact = { in: ['AN1', 'AN2', 'AN3'] };
  for (const key of ['count', 'assignments', 'leave', 'checkpoints', 'scans', 'license']) assert.deepEqual(seen[key], exact, key);
  assert.ok(seen.workforce.some((value) => Array.isArray(value) && value.join('|') === 'AN1|AN2|AN3'));
});

test('department lists split comma-delimited values and compare each value exactly', () => {
  assert.deepEqual(departmentValues('AN1, AN2,AN3'), ['AN1', 'AN2', 'AN3']);
  assert.equal(departmentMatches(['AN1', 'AN2', 'AN3'], 'AN10'), false);
  assert.equal(departmentMatches('AN1,AN2,AN3', 'AN2'), true);
});

test('attendance KPI uses unique non-OFF assignments, active check-ins, approved leave suppression for absences, and Bangkok shift end boundaries', () => {
  const assignments = [
    { id: 'checked', workDate: day('2026-08-10'), startTime: '08:00', endTime: '16:00', shiftType: { code: 'DAY' }, attendanceSession: [{ state: 'OPEN', events: [{ eventType: 'CHECK_IN', state: 'ACTIVE', effectiveEventAt: new Date('2026-08-10T01:00:00Z') }] }] },
    { id: 'absent', workDate: day('2026-08-10'), startTime: '08:00', endTime: '16:00', shiftType: { code: 'DAY' }, attendanceSession: [] },
    { id: 'leave', employeeId: 'employee-leave', workDate: day('2026-08-10'), startTime: '08:00', endTime: '16:00', shiftType: { code: 'DAY' }, attendanceSession: [] },
    { id: 'off', workDate: day('2026-08-10'), startTime: null, endTime: null, shiftType: { code: 'OFF' }, attendanceSession: [] },
    { id: 'overnight', workDate: day('2026-08-10'), startTime: '20:00', endTime: '06:00', shiftType: { code: 'NIGHT' }, attendanceSession: [] }
  ];
  const approvedLeaves = [{ employeeId: 'employee-leave', startDate: day('2026-08-10'), endDate: day('2026-08-10') }];
  // 2026-08-10T22:59:59.999Z = 05:59:59 Bangkok on 11 Aug: the 20:00–06:00 overnight shift has not ended yet.
  const beforeEnd = buildAttendanceMetrics({ assignments: [...assignments, assignments[0]], approvedLeaves, from: day('2026-08-01'), nextMonthStart: day('2026-09-01'), asOf: new Date('2026-08-10T22:59:59.999Z') });
  assert.equal(beforeEnd.checkedInAssignments, 1, 'duplicate assignment rows count once');
  assert.equal(beforeEnd.scheduledAssignments, 3, 'OFF and the unfinished overnight shift are outside the base');
  assert.equal(beforeEnd.absentAssignments, 1, 'approved leave is never absent; the running overnight shift is not absent yet');
  assert.equal(beforeEnd.attendanceRate, 33.3);
  const atEnd = buildAttendanceMetrics({ assignments, approvedLeaves, from: day('2026-08-01'), nextMonthStart: day('2026-09-01'), asOf: new Date('2026-08-10T23:00:00Z') });
  assert.equal(atEnd.scheduledAssignments, 4, 'overnight shift joins the base exactly at its 06:00 Bangkok end');
  assert.equal(atEnd.absentAssignments, 2, 'only completed unexcused shifts are absent');
  assert.equal(atEnd.checkedInAssignments, 1, 'active check-in is counted once per assignment');
  assert.equal(atEnd.attendanceRate, 25);
});

test('voided sessions/events and rejected device-transfer check-ins never count; future shifts stay out of the base', () => {
  const base = { workDate: day('2026-08-10'), startTime: '08:00', endTime: '16:00', shiftType: { code: 'DAY' } };
  const checkIn = (extra = {}) => ({ eventType: 'CHECK_IN', state: 'ACTIVE', effectiveEventAt: new Date('2026-08-10T01:00:00Z'), ...extra });
  const assignments = [
    { ...base, id: 'void-session', attendanceSession: [{ state: 'VOIDED', voidedAt: new Date(), events: [checkIn()] }] },
    { ...base, id: 'void-event', attendanceSession: [{ state: 'CLOSED', events: [checkIn({ state: 'VOIDED' })] }] },
    { ...base, id: 'rejected', attendanceSession: [{ state: 'OPEN', events: [checkIn({ reviewReasons: ['DEVICE_TRANSFER_REJECTED'] })] }] },
    { ...base, id: 'support', attendanceSession: [{ state: 'OPEN', expectedSiteId: 'site-a', events: [checkIn({ locationEvidence: { actualSiteId: 'site-b' } })] }] },
    { ...base, id: 'future', workDate: day('2026-08-20'), attendanceSession: [] },
    { ...base, id: 'next-month', workDate: day('2026-09-01'), attendanceSession: [] }
  ];
  const result = buildAttendanceMetrics({ assignments, approvedLeaves: [], from: day('2026-08-01'), nextMonthStart: day('2026-09-01'), asOf: new Date('2026-08-11T00:00:00Z') });
  assert.equal(result.scheduledAssignments, 4);
  assert.equal(result.checkedInAssignments, 1);
  assert.equal(result.absentAssignments, 3);
  assert.equal(result.assistOtherSiteCheckIns, 1);
  assert.equal(result.attendanceRate, 25);
  const empty = buildAttendanceMetrics({ assignments: [], approvedLeaves: [], from: day('2026-08-01'), nextMonthStart: day('2026-09-01'), asOf: new Date('2026-08-11T00:00:00Z') });
  assert.equal(empty.attendanceRate, null, '0/0 is null, never 0% or NaN');
});

test('patrol round coverage uses 07:00 Bangkok start, deduplicates scans, and excludes incomplete/future rounds', () => {
  const checkpoints = [{ id: 'cp-1', department: 'AN1' }];
  const scans = [
    { checkpointId: 'cp-1', scannedAt: new Date('2026-08-10T01:00:00Z') },
    { checkpointId: 'cp-1', scannedAt: new Date('2026-08-10T02:59:59Z') },
    { checkpointId: 'cp-1', scannedAt: new Date('2026-08-10T23:59:59Z') },
    { checkpointId: 'cp-1', scannedAt: new Date('2026-08-11T00:00:00Z') }
  ];
  const before = buildDepartmentRoundCoverage({ checkpoints, scans, from: '2026-08-10', to: '2026-08-10', asOf: new Date('2026-08-10T23:59:59.999Z') });
  assert.equal(before.expectedRounds, 7);
  assert.equal(before.scannedRounds, 1);
  assert.equal(before.missedRounds, 6);
  assert.equal(before.coveragePercent, 14.3);
  const atBoundary = buildDepartmentRoundCoverage({ checkpoints, scans, from: '2026-08-10', to: '2026-08-10', asOf: new Date('2026-08-11T00:00:00Z') });
  assert.equal(atBoundary.expectedRounds, 8);
  assert.equal(atBoundary.scannedRounds, 2, '06:59:59 Bangkok scan closes round 8 of the same patrol day');
  assert.deepEqual(patrolRoundOf(new Date('2026-08-10T23:59:59Z')), { day: '2026-08-10', round: 8 });
  assert.deepEqual(patrolRoundOf(new Date('2026-08-11T00:00:00Z')), { day: '2026-08-11', round: 1 });
});

test('zero-denominator KPI is null, and future-only month has no completed patrol rounds', () => {
  assert.equal(percentageOrNull(0, 0), null);
  const result = buildDepartmentRoundCoverage({ checkpoints: [{ id: 'cp', department: 'AN1' }], scans: [], from: '2026-12-01', to: '2026-12-31', asOf: new Date('2026-08-10T00:00:00Z') });
  assert.equal(result.expectedRounds, 0);
  assert.equal(result.coveragePercent, null);
  assert.equal(result.missedRounds, 0);
});

test('S3 non-ADMIN critical KPI counts only department-filterable rules and flags the withheld unscoped rules; ADMIN keeps all', async () => {
  const quotaWhere = [];
  const client = reportPrisma();
  client.leaveQuota.count = async ({ where }) => { quotaWhere.push(where); return 2; };
  client.leaveQuota.findMany = async () => [{ id: 'synthetic-global-quota', matchStatus: 'UNMATCHED' }];
  client.leaveQuota.groupBy = async () => [{ employeeId: 'synthetic-employee', quotaYear: 2026, _count: { _all: 3 } }];
  const manager = await getExecutiveReport({ prismaClient: client, requestUser: { role: 'MANAGER', department: 'AN1' }, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00Z') });
  const managerKpi = manager.executiveSummary.find((item) => item.key === 'criticalDataQuality');
  assert.equal(manager.dataQualityAvailability, 'PARTIAL_SCOPE');
  assert.equal(managerKpi.value, 2, 'only the department-filtered quota rule is counted');
  assert.equal(managerKpi.unavailableLabel, 'ไม่พร้อมใน scope');
  assert.deepEqual(managerKpi.unavailableRules, ['LEAVE_QUOTA_YEAR_UNCLASSIFIED', 'LEAVE_QUOTA_ANNUAL_DUPLICATE', 'AMBIGUOUS_LEGACY_CROSS_YEAR_DAY_COUNT']);
  assert.equal(managerKpi.targetPath, null, 'ADMIN-only data-quality route is never linked for MANAGER');
  assert.equal(manager.dataQuality.categories.some((item) => item.rule === 'LEAVE_QUOTA_YEAR_UNCLASSIFIED'), false, 'unscoped rule totals are not serialized');
  assert.deepEqual(quotaWhere[0].AND.at(-1).employee.is.department, 'AN1');
  const admin = await getExecutiveReport({ prismaClient: client, requestUser: { role: 'ADMIN' }, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00Z') });
  assert.equal(admin.dataQualityAvailability, 'AVAILABLE');
  assert.equal(admin.executiveSummary.find((item) => item.key === 'criticalDataQuality').value, 4, 'ADMIN: 2 quota + 1 unclassified + 1 duplicate group');
  assert.equal(admin.executiveSummary.find((item) => item.key === 'criticalDataQuality').targetPath, 'dataQuality');
});

test('executive report exposes 8 KPIs, null no-base rates, current pending queue and gap attention items', async () => {
  const client = reportPrisma();
  client.shiftAssignment.findMany = async () => [
    { id: 'a1', employeeId: 'e1', workDate: day('2026-08-03'), startTime: '08:00', endTime: '16:00', shiftType: { code: 'DAY' }, attendanceSession: [] },
    { id: 'a2', employeeId: 'e2', workDate: day('2026-08-03'), startTime: '08:00', endTime: '16:00', shiftType: { code: 'DAY' }, attendanceSession: [{ state: 'CLOSED', events: [{ eventType: 'CHECK_IN', state: 'ACTIVE', effectiveEventAt: new Date('2026-08-03T01:00:00Z') }] }] }
  ];
  client.patrolCheckpoint.findMany = async () => [{ id: 'cp', department: 'AN1' }];
  const report = await getExecutiveReport({ prismaClient: client, requestUser: admin, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00Z'), pendingQueue: async () => ({ summary: { total: 9, byType: { LEAVE_REQUEST: 9 } } }) });
  assert.deepEqual(report.executiveSummary.map((item) => item.key), ['attendanceRate', 'absentAssignments', 'patrolCoverage', 'assistOtherSite', 'licenseAttention', 'pendingLeave', 'pendingQueue', 'criticalDataQuality']);
  const value = (key) => report.executiveSummary.find((item) => item.key === key);
  assert.equal(value('attendanceRate').value, 50);
  assert.equal(value('absentAssignments').value, 1);
  assert.equal(value('patrolCoverage').value, 0);
  assert.equal(value('patrolCoverage').denominator, 9 * 8, '9 completed patrol days x 8 rounds on 10 Aug 07:00 Bangkok');
  assert.equal(value('pendingQueue').value, 9);
  assert.equal(value('pendingQueue').asOf, 'CURRENT');
  assert.equal(report.patrol.byDepartment[0].department, 'AN1');
  assert.deepEqual(report.managementAttention.map((item) => item.title).slice(0, 2), ['กะที่ขาด / ไม่มีเช็กอิน', 'จุดตรวจตกหล่น']);
  assert.equal(typeof report.schedule.assignmentCount, 'number', 'existing export/print fields are kept');
  assert.equal(typeof report.workforce.activeEmployees, 'number');
  const noQueue = await getExecutiveReport({ prismaClient: reportPrisma(), requestUser: admin, filters: { year: 2026, month: 8 }, now: new Date('2026-08-10T00:00:00Z') });
  assert.equal(noQueue.executiveSummary.find((item) => item.key === 'pendingQueue').value, null);
  assert.equal(noQueue.executiveSummary.find((item) => item.key === 'attendanceRate').value, null);
});
