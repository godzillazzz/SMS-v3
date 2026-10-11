process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL?.includes('sms_v3_test')) {
  throw new Error('Dashboard integration tests require an isolated sms_v3_test database.');
}

const prisma = require('../../src/config/prisma');
const { getDashboardSummary } = require('../../src/services/dashboard.service');
const { getDashboardDetails } = require('../../src/services/dashboard-detail.service');

test('dashboard summary completes allowed ADMIN and VIEWER scopes without partial data', async () => {
  const now = new Date(Date.UTC(2026, 7, 10));
  const admin = await getDashboardSummary({
    prismaClient: prisma,
    requestUser: { role: 'ADMIN', employeeId: null, department: null },
    now
  });
  const viewer = await getDashboardSummary({
    prismaClient: prisma,
    requestUser: { role: 'VIEWER', employeeId: null, department: null },
    now
  });

  assert.deepEqual(admin.partialErrors, []);
  assert.deepEqual(viewer.partialErrors, []);
  assert.equal(viewer.context.department, '');
});


test('dashboard KPI drill-down totals match the summary under identical filters', async () => {
  const now = new Date(Date.UTC(2026, 7, 10));
  const requestUser = { role: 'ADMIN', employeeId: null, department: null };
  const summary = await getDashboardSummary({
    prismaClient: prisma,
    requestUser,
    now,
    filters: { date: '2026-08-10', month: '2026-08' }
  });
  const cases = [
    [{ metric: 'activeEmployees', date: '2026-08-10', month: '2026-08' }, summary.activeEmployees],
    [{ metric: 'totalEmployees', date: '2026-08-10', month: '2026-08' }, summary.totalEmployees],
    [{ metric: 'schedule', workforce: 'SCHEDULED', date: '2026-08-10' }, summary.workingToday],
    [{ metric: 'schedule', workforce: 'ON_DUTY', date: '2026-08-10' }, summary.onDutyToday],
    [{ metric: 'schedule', workforce: 'NO_SHIFT', date: '2026-08-10' }, summary.notScheduledToday],
    [{ metric: 'leaveToday', date: '2026-08-10' }, summary.leaveToday],
    [{ metric: 'leaveMonth', month: '2026-08' }, summary.leaveMonth],
    [{ metric: 'pendingLeaves' }, summary.pendingLeaves],
    [{ metric: 'licenseExpiry', expiryBucket: 'EXPIRING_0_30', date: '2026-08-10' }, summary.expiringLicenses],
    [{ metric: 'licenseExpiry', expiryBucket: 'EXPIRED', date: '2026-08-10' }, summary.licenseOverview.expired]
  ];
  for (const [filters, expected] of cases) {
    const detail = await getDashboardDetails({ prismaClient: prisma, requestUser, filters });
    assert.equal(detail.total, expected, `metric ${filters.metric}/${filters.workforce || filters.expiryBucket || ''}`);
  }
});
