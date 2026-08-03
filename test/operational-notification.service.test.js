const test = require('node:test');
const assert = require('node:assert/strict');
const { daysUntil, EXPIRY_THRESHOLDS, escapeHtml, notifyNewRegistrationForManagers, sendDailyApprovalDigest } = require('../src/services/operational-notification.service');

test('operational notification helpers use the requested expiry thresholds and escape content', () => {
  assert.deepEqual(EXPIRY_THRESHOLDS, [90, 60, 30, 7, 0]);
  assert.equal(daysUntil('2026-08-03T00:00:00Z', new Date('2026-08-03T12:00:00Z')), 0);
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('pending registration resolves only managers in the matching department', async () => {
  const queries = [];
  const client = {
    user: { findMany: async (query) => { queries.push(query); return [{ email: 'manager@example.invalid' }]; } },
    auditLog: { findFirst: async () => null, create: async () => undefined }
  };
  await notifyNewRegistrationForManagers({ displayName: 'Fixture User', department: 'Operations', userId: 'user-1' }, client);
  assert.equal(queries[0].where.role, 'MANAGER');
  assert.equal(queries[0].where.department, 'Operations');
});

test('daily digest does not send an empty message and excludes schedule data', async () => {
  const client = {
    user: { findMany: async ({ where }) => where?.role ? [{ email: 'admin@example.invalid', role: 'ADMIN', department: null }] : [] },
    leaveRequest: { findMany: async () => [] },
    leaveQuota: { findMany: async () => [] },
    employeeLicenseDocument: { findMany: async () => [] },
    auditLog: { findFirst: async () => null, create: async () => undefined }
  };
  assert.equal(await sendDailyApprovalDigest({ client, now: new Date('2026-08-03T01:00:00Z') }), 0);
});
