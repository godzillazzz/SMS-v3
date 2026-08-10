process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL?.includes('sms_v3_test')) {
  throw new Error('Dashboard integration tests require an isolated sms_v3_test database.');
}

const prisma = require('../../src/config/prisma');
const { getDashboardSummary } = require('../../src/services/dashboard.service');

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
