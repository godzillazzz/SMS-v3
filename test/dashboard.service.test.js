process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { actionRequired, buildExpiringLicenseDetails, employeeScope, expiringLicenseWhere, getDashboardSummary, licenseStatusSummary } = require('../src/services/dashboard.service');

test('dashboard scope keeps historical workforce global while operational work is active-only', () => {
  assert.deepEqual(employeeScope({ role: 'ADMIN', employeeId: null, department: null }), {});
  assert.deepEqual(employeeScope({ role: 'MANAGER', employeeId: 'employee-1', department: 'Security' }), { department: 'Security' });
  assert.deepEqual(employeeScope({ role: 'VIEWER', employeeId: 'employee-1', department: 'Security' }), { id: 'employee-1' });
  assert.deepEqual(employeeScope({ role: 'VIEWER', employeeId: null, department: null }), { id: '00000000-0000-0000-0000-000000000000' });
  assert.deepEqual(employeeScope({ role: 'ADMIN', employeeId: null, department: null }, true), { employee: { is: { isActive: true, deletedAt: null } } });
  assert.deepEqual(employeeScope({ role: 'MANAGER', employeeId: 'employee-1', department: 'Security' }, true), { employee: { is: { department: 'Security', isActive: true, deletedAt: null } } });
  assert.deepEqual(employeeScope({ role: 'VIEWER', employeeId: 'employee-1', department: 'Security' }, true), { employee: { is: { id: 'employee-1', isActive: true, deletedAt: null } } });
});

test('dashboard expiring license details use the count scope and sort urgency safely', () => {
  const today = new Date(Date.UTC(2026, 7, 3));
  const expiry30 = new Date(Date.UTC(2026, 8, 2));
  assert.deepEqual(expiringLicenseWhere({ employee: { is: { department: 'Security', isActive: true, deletedAt: null } } }, expiry30), { employee: { is: { department: 'Security', isActive: true, deletedAt: null } }, status: 'APPROVED', isCurrent: true, proposedExpiryDate: { lte: expiry30 } });
  const details = buildExpiringLicenseDetails([
    { employeeId: 'employee-warning', licenseId: 'license-warning', proposedExpiryDate: new Date(Date.UTC(2026, 7, 20)), employee: { employeeCode: 'EMP-W', firstName: 'W', lastName: 'Warning' } },
    { employeeId: 'employee-expired', licenseId: 'license-expired', proposedExpiryDate: new Date(Date.UTC(2026, 7, 1)), employee: { employeeCode: 'EMP-E', firstName: 'E', lastName: 'Expired' } },
    { employeeId: 'employee-urgent', licenseId: 'license-urgent', proposedExpiryDate: new Date(Date.UTC(2026, 7, 5)), employee: { employeeCode: 'EMP-U', firstName: 'U', lastName: 'Urgent' } }
  ], today);
  assert.deepEqual(details.map((row) => row.licenseId), ['license-expired', 'license-urgent', 'license-warning']);
  assert.equal(details[0].daysRemaining, -2);
  assert.equal(details[0].urgency, 'expired');
  assert.equal(details[1].urgency, 'urgent');
  assert.equal(details[2].urgency, 'warning');
});

test('dashboard summary keeps expiring count and detail rows consistent', async () => {
  const today = new Date(Date.UTC(2026, 7, 3));
  const rows = [
    { employeeId: 'employee-1', licenseId: 'license-1', proposedExpiryDate: new Date(Date.UTC(2026, 7, 4)), employee: { employeeCode: 'EMP-1', firstName: 'One', lastName: 'Person' } },
    { employeeId: 'employee-2', licenseId: 'license-2', proposedExpiryDate: new Date(Date.UTC(2026, 7, 12)), employee: { employeeCode: 'EMP-2', firstName: 'Two', lastName: 'Person' } },
    { employeeId: 'employee-3', licenseId: 'license-3', proposedExpiryDate: new Date(Date.UTC(2026, 7, 25)), employee: { employeeCode: 'EMP-3', firstName: 'Three', lastName: 'Person' } }
  ];
  const empty = async () => []; const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty }, shiftAssignment: { findMany: empty, count: zero }, leaveRequest: { count: zero }, user: { count: zero }, scheduleApproval: { count: zero },
    employeeLicenseDocument: { groupBy: async ({ by }) => by.includes('proposedExpiryDate') ? rows.map((row) => ({ status: 'APPROVED', isCurrent: true, proposedExpiryDate: row.proposedExpiryDate, _count: { _all: 1 } })) : [], findMany: async ({ where }) => { assert.equal(where.status, 'APPROVED'); assert.equal(where.isCurrent, true); return rows; } },
    leaveQuota: { count: zero }, auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null }, now: today });
  assert.equal(summary.expiringLicenses, 3); assert.equal(summary.expiringLicenseDetails.length, 3);
  assert.deepEqual(summary.expiringLicenseDetails.map((row) => row.employeeCode), ['EMP-1', 'EMP-2', 'EMP-3']);
});

test('dashboard license status mapping preserves every supported status', () => {
  const summary = licenseStatusSummary([
    { status: 'APPROVED', _count: { _all: 4 } },
    { status: 'RETURNED_FOR_CORRECTION', _count: { _all: 2 } },
    { status: 'EXPIRED', _count: { _all: 1 } }
  ]);
  assert.deepEqual(summary, { PENDING: 0, APPROVED: 4, RETURNED_FOR_CORRECTION: 2, REJECTED: 0, EXPIRED: 1, SUPERSEDED: 0 });
});

test('dashboard action required contains only positive counts and preserves role visibility', () => {
  const input = { licenseSummary: { PENDING: 2, RETURNED_FOR_CORRECTION: 1, EXPIRED: 0 }, expiringLicenses: 3, pendingLeaves: 4, notScheduledToday: 1, unmatchedQuotas: 5 };
  const adminRows = actionRequired(input, true, true);
  assert.deepEqual(adminRows.map((row) => row.key), ['licensePending', 'unmatchedQuota', 'licenseExpiring', 'missingSchedule', 'licenseReturned', 'pendingLeaves']);
  const viewerRows = actionRequired(input, false, false);
  assert.deepEqual(viewerRows.map((row) => row.key), ['licensePending', 'licenseExpiring', 'missingSchedule', 'licenseReturned']);
});

test('dashboard action center orders urgent items before warning and follow-up items', () => {
  const rows = actionRequired({ licenseSummary: { PENDING: 0, RETURNED_FOR_CORRECTION: 2, EXPIRED: 0 }, expiringLicenses: 0, pendingLeaves: 3, notScheduledToday: 4, unmatchedQuotas: 1 }, true, true);
  assert.deepEqual(rows.map((row) => row.severity), ['urgent', 'warning', 'follow-up', 'follow-up']);
});

test('dashboard filters department for ADMIN and ignores unauthorized department override', async () => {
  const observed = [];
  const empty = async ({ where } = {}) => { observed.push(where); return []; };
  const zero = async ({ where } = {}) => { observed.push(where); return 0; };
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: { count: zero },
    user: { count: zero },
    scheduleApproval: { count: zero },
    employeeLicenseDocument: { groupBy: empty, findMany: empty },
    leaveQuota: { count: zero },
    auditLog: { findMany: empty }
  };
  await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null }, filters: { department: 'Security' } });
  assert.ok(observed.some((where) => where?.department === 'Security'));
  observed.length = 0;
  await getDashboardSummary({ prismaClient: client, requestUser: { role: 'MANAGER', employeeId: 'employee-1', department: 'Operations' }, filters: { department: 'Security' } });
  assert.ok(observed.some((where) => where?.department === undefined));
});

test('dashboard operational queries exclude inactive employees while retaining unlinked quota attention', async () => {
  const licenseWhere = [];
  const leaveWhere = [];
  const userWhere = [];
  const quotaWhere = [];
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: async ({ where }) => { leaveWhere.push(where); return []; }, count: async ({ where }) => { leaveWhere.push(where); return 0; } },
    leaveRequest: { count: async ({ where }) => { leaveWhere.push(where); return 0; }, findMany: async ({ where }) => { leaveWhere.push(where); return []; }, groupBy: async ({ where }) => { leaveWhere.push(where); return []; } },
    user: { count: async ({ where }) => { userWhere.push(where); return 0; } },
    scheduleApproval: { count: zero },
    employeeLicenseDocument: { groupBy: async ({ where }) => { licenseWhere.push(where); return []; }, findMany: async ({ where }) => { licenseWhere.push(where); return []; } },
    leaveQuota: { count: async ({ where }) => { quotaWhere.push(where); return 0; } },
    auditLog: { findMany: empty }
  };
  await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.ok(licenseWhere.some((where) => where.employee?.is?.isActive === true && where.employee.is.deletedAt === null));
  assert.ok(leaveWhere.some((where) => where.employee?.is?.isActive === true && where.employee.is.deletedAt === null));
  assert.ok(userWhere.some((where) => where.OR?.some((item) => item.employee?.is?.isActive === true)));
  assert.ok(quotaWhere.some((where) => where.OR?.some((item) => item.employeeId === null) && where.OR.some((item) => item.employee?.is?.isActive === true)));
});

test('dashboard summary returns today operations and month leave aggregation without loading full datasets', async () => {
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: async () => [{ department: 'Security' }] },
    shiftAssignment: { findMany: async () => [{ employeeId: 'e1', shiftType: { code: 'D', name: 'กะกลางวัน', color: '#2563eb' } }, { employeeId: 'e2', shiftType: { code: 'N', name: 'กะกลางคืน', color: '#0f172a' } }], count: zero },
    leaveRequest: { count: zero, findMany: async () => [{ employeeId: 'e1' }], groupBy: async () => [{ status: 'APPROVED', _count: { _all: 2 } }] },
    user: { count: zero },
    scheduleApproval: { count: zero },
    employeeLicenseDocument: { groupBy: empty, findMany: empty },
    leaveQuota: { count: zero },
    auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null }, now: new Date(Date.UTC(2026, 7, 3)), filters: { date: '2026-08-04', month: '2026-08' } });
  assert.equal(summary.context.date, '2026-08-04');
  assert.equal(summary.context.month, '2026-08');
  assert.equal(summary.todayOperations.totalScheduled, 2);
  assert.equal(summary.todayOperations.onDuty, 1);
  assert.deepEqual(summary.todayOperations.byShift.map((row) => row.code).sort(), ['D', 'N']);
  assert.equal(summary.leaveOverview.APPROVED, 2);
});

test('dashboard license overview uses non-overlapping database-side date buckets', async () => {
  const empty = async () => []; const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty }, shiftAssignment: { findMany: empty, count: zero }, leaveRequest: { count: zero }, user: { count: zero }, scheduleApproval: { count: zero },
    employeeLicenseDocument: {
      groupBy: async ({ by }) => by.includes('proposedExpiryDate') ? [
        { status: 'APPROVED', isCurrent: true, proposedExpiryDate: new Date(Date.UTC(2026, 7, 1)), _count: { _all: 2 } },
        { status: 'APPROVED', isCurrent: true, proposedExpiryDate: new Date(Date.UTC(2026, 7, 10)), _count: { _all: 3 } },
        { status: 'APPROVED', isCurrent: true, proposedExpiryDate: new Date(Date.UTC(2026, 8, 15)), _count: { _all: 5 } },
        { status: 'APPROVED', isCurrent: true, proposedExpiryDate: new Date(Date.UTC(2026, 11, 1)), _count: { _all: 7 } },
        { status: 'EXPIRED', isCurrent: true, proposedExpiryDate: new Date(Date.UTC(2026, 7, 1)), _count: { _all: 1 } },
        { status: 'PENDING', isCurrent: false, proposedExpiryDate: new Date(Date.UTC(2026, 11, 1)), _count: { _all: 4 } }
      ] : [],
      findMany: empty, count: async () => { throw new Error('consolidated path should not call count'); }
    },
    leaveQuota: { count: zero }, auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null }, now: new Date(Date.UTC(2026, 7, 3)) });
  assert.deepEqual(summary.licenseOverview, { valid: 7, expiringWithin30: 3, expiringWithin90: 5, expired: 3, pendingReview: 4 });
});

test('dashboard recent activity excludes technical audit actions', async () => {
  let query;
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: { count: zero },
    user: { count: zero },
    scheduleApproval: { count: zero },
    employeeLicenseDocument: { groupBy: empty, findMany: empty },
    leaveQuota: { count: zero },
    auditLog: { findMany: async (args) => { query = args; return []; } },
  };
  await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.deepEqual(query.where.action.notIn, ['LOGIN', 'LOGIN_FAILED', 'REFRESH', 'LOGOUT', 'LOGOUT_ALL', 'TOKEN_REUSE']);
});

test('dashboard keeps available sections when one aggregate query fails', async () => {
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: async ({ where }) => where.isActive ? 4 : Promise.reject(new Error('workforce aggregate failed')), findMany: async () => [{ department: 'Security' }] },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: { count: zero },
    user: { count: zero },
    scheduleApproval: { count: zero },
    employeeLicenseDocument: { groupBy: empty, findMany: empty },
    leaveQuota: { count: zero },
    auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.equal(summary.totalEmployees, 0);
  assert.equal(summary.activeEmployees, 4);
  assert.deepEqual(summary.partialErrors, ['workforce']);
});

test('dashboard monthly leave optimized group derives total without an extra monthly count or partial error', async () => {
  let monthlyCountCalls = 0;
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: {
      count: async ({ where }) => { if (!where.status && where.startDate?.lt && where.endDate?.gte) { monthlyCountCalls += 1; throw new Error('monthly count must not run on optimized path'); } return 0; },
      findMany: empty,
      groupBy: async () => [{ status: 'APPROVED', _count: { _all: 2 } }, { status: 'REJECTED', _count: { _all: 1 } }]
    },
    user: { count: zero }, scheduleApproval: { count: zero }, employeeLicenseDocument: { groupBy: empty, findMany: empty },
    leaveQuota: { count: zero }, auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.equal(summary.leaveMonth, 3);
  assert.equal(summary.leaveOverview.APPROVED, 2);
  assert.equal(summary.leaveOverview.REJECTED, 1);
  assert.equal(monthlyCountCalls, 0);
  assert.deepEqual(summary.partialErrors, []);
});

test('dashboard monthly leave capability fallback uses legacy count without artificial partial error', async () => {
  let monthlyCountCalls = 0;
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: { count: async ({ where }) => { if (!where.status && where.startDate?.lt && where.endDate?.gte) { monthlyCountCalls += 1; return 7; } return 0; }, findMany: empty },
    user: { count: zero }, scheduleApproval: { count: zero }, employeeLicenseDocument: { groupBy: empty, findMany: empty },
    leaveQuota: { count: zero }, auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.equal(summary.leaveMonth, 7);
  assert.equal(monthlyCountCalls, 1);
  assert.deepEqual(summary.partialErrors, []);
});

test('dashboard monthly leave real optimized query failure preserves partial error while legacy count supplies total', async () => {
  let monthlyCountCalls = 0;
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: {
      count: async ({ where }) => { if (!where.status && where.startDate?.lt && where.endDate?.gte) { monthlyCountCalls += 1; return 5; } return 0; },
      findMany: empty,
      groupBy: async () => { throw new Error('monthly groupBy failed'); }
    },
    user: { count: zero }, scheduleApproval: { count: zero }, employeeLicenseDocument: { groupBy: empty, findMany: empty },
    leaveQuota: { count: zero }, auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.equal(summary.leaveMonth, 5);
  assert.equal(monthlyCountCalls, 1);
  assert.deepEqual(summary.partialErrors, ['leaveOverview']);
});

test('dashboard monthly leave fallback count failure reports leaveOverview partial error', async () => {
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: { count: async ({ where }) => { if (!where.status && where.startDate?.lt && where.endDate?.gte) throw new Error('monthly fallback count failed'); return 0; }, findMany: empty },
    user: { count: zero }, scheduleApproval: { count: zero }, employeeLicenseDocument: { groupBy: empty, findMany: empty },
    leaveQuota: { count: zero }, auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.equal(summary.leaveMonth, 0);
  assert.deepEqual(summary.partialErrors, ['leaveOverview']);
});

test('dashboard bounds aggregate query concurrency to respect the serverless connection limit', async () => {
  let active = 0;
  let peak = 0;
  const tracked = async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return value;
  };
  const client = {
    employee: { count: async () => tracked(0), findMany: async () => tracked([]) },
    shiftAssignment: { findMany: async () => tracked([]), count: async () => tracked(0) },
    leaveRequest: { count: async () => tracked(0), findMany: async () => tracked([]), groupBy: async () => tracked([]) },
    user: { count: async () => tracked(0) },
    scheduleApproval: { count: async () => tracked(0) },
    employeeLicenseDocument: { count: async () => tracked(0), groupBy: async () => tracked([]), findMany: async () => tracked([]) },
    leaveQuota: { count: async () => tracked(0) },
    auditLog: { findMany: async () => tracked([]) }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.ok(peak > 1, 'independent dashboard queries should overlap');
  assert.ok(peak <= 4, 'dashboard query peak exceeded bounded concurrency');
  assert.deepEqual(summary.partialErrors, []);
});

test('dashboard keeps the partial warning signal when license overview aggregation fails', async () => {
  let licenseCountCalls = 0; const empty = async () => []; const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty }, shiftAssignment: { findMany: empty, count: zero }, leaveRequest: { count: zero, findMany: empty, groupBy: empty }, user: { count: zero }, scheduleApproval: { count: zero },
    employeeLicenseDocument: { groupBy: async () => { throw new Error('license aggregate query failed'); }, findMany: empty, count: async () => { licenseCountCalls += 1; if (licenseCountCalls === 3) throw new Error('license category query failed'); return 0; } },
    leaveQuota: { count: zero }, auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.equal(summary.activeEmployees, 0); assert.deepEqual(summary.partialErrors, ['licenseOverview']);
});

test('dashboard consolidated normal path uses 13 operations with bounded overlap', async () => {
  let calls = 0; let active = 0; let peak = 0;
  const tracked = async (value) => { calls += 1; active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; return value; };
  const client = {
    employee: { groupBy: async () => tracked([{ isActive: true, _count: { _all: 4 } }, { isActive: false, _count: { _all: 1 } }]), findMany: async () => tracked([{ department: 'Security' }]), count: async () => { throw new Error('workforce fallback not expected'); } },
    shiftAssignment: { findMany: async () => tracked([]), count: async () => tracked(0) },
    leaveRequest: { count: async () => tracked(0), findMany: async () => tracked([]), groupBy: async () => tracked([]) },
    user: { count: async () => tracked(0) }, scheduleApproval: { count: async () => tracked(0) }, employeeLicenseDocument: { groupBy: async () => tracked([]), findMany: async () => tracked([]), count: async () => { throw new Error('license fallback not expected'); } },
    leaveQuota: { count: async () => tracked(0) }, auditLog: { findMany: async () => tracked([]) }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null } });
  assert.equal(calls, 13); assert.ok(peak > 1); assert.ok(peak <= 2); assert.equal(summary.totalEmployees, 5); assert.equal(summary.activeEmployees, 4); assert.deepEqual(summary.partialErrors, []);
});
