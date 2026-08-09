process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { actionRequired, buildExpiringLicenseDetails, employeeScope, expiringLicenseWhere, getDashboardSummary, licenseStatusSummary } = require('../src/services/dashboard.service');

test('dashboard scope keeps ADMIN global, MANAGER department-scoped, and VIEWER employee-scoped', () => {
  assert.deepEqual(employeeScope({ role: 'ADMIN', employeeId: null, department: null }), {});
  assert.deepEqual(employeeScope({ role: 'MANAGER', employeeId: 'employee-1', department: 'Security' }), { department: 'Security' });
  assert.deepEqual(employeeScope({ role: 'VIEWER', employeeId: 'employee-1', department: 'Security' }), { id: 'employee-1' });
  assert.deepEqual(employeeScope({ role: 'VIEWER', employeeId: null, department: null }), { id: '00000000-0000-0000-0000-000000000000' });
  assert.deepEqual(employeeScope({ role: 'MANAGER', employeeId: 'employee-1', department: 'Security' }, true), { employee: { is: { department: 'Security', deletedAt: null } } });
  assert.deepEqual(employeeScope({ role: 'VIEWER', employeeId: 'employee-1', department: 'Security' }, true), { employee: { is: { id: 'employee-1' } } });
});

test('dashboard expiring license details use the count scope and sort urgency safely', () => {
  const today = new Date(Date.UTC(2026, 7, 3));
  const expiry30 = new Date(Date.UTC(2026, 8, 2));
  assert.deepEqual(expiringLicenseWhere({ employee: { is: { department: 'Security', deletedAt: null } } }, expiry30), { employee: { is: { department: 'Security', deletedAt: null } }, status: 'APPROVED', isCurrent: true, proposedExpiryDate: { lte: expiry30 } });
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
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: { count: zero },
    user: { count: zero },
    scheduleApproval: { count: zero },
    employeeLicenseDocument: { groupBy: empty, findMany: async ({ where }) => { assert.equal(where.status, 'APPROVED'); assert.equal(where.isCurrent, true); return rows; } },
    leaveQuota: { count: zero },
    auditLog: { findMany: empty }
  };
  const summary = await getDashboardSummary({ prismaClient: client, requestUser: { role: 'ADMIN', employeeId: null, department: null }, now: today });
  assert.equal(summary.expiringLicenses, 3);
  assert.equal(summary.expiringLicenseDetails.length, 3);
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
  const empty = async () => [];
  const zero = async () => 0;
  const client = {
    employee: { count: zero, findMany: empty },
    shiftAssignment: { findMany: empty, count: zero },
    leaveRequest: { count: zero },
    user: { count: zero },
    scheduleApproval: { count: zero },
    employeeLicenseDocument: {
      groupBy: empty,
      findMany: empty,
      count: async ({ where }) => { const expiry = where.proposedExpiryDate || {}; if (expiry.lt) return 2; if (expiry.gte && expiry.lte) return 3; if (expiry.gt && expiry.lte) return 5; if (expiry.gt) return 7; return where.status === 'EXPIRED' ? 1 : where.status === 'PENDING' ? 4 : 7; }
    },
    leaveQuota: { count: zero },
    auditLog: { findMany: empty }
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
