const test = require('node:test');
const assert = require('node:assert/strict');
const { daysUntil, EXPIRY_THRESHOLDS, escapeHtml, notifyNewRegistrationForManagers, sendDailyApprovalDigest } = require('../src/services/operational-notification.service');
const { POLICIES, createOperationalAnomalyReporter } = require('../src/services/operational-anomaly.service');
const { MemoryAlertDedupStore } = require('../src/services/alert-dedup-store');

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

test('registration manager resolution fails closed for zero and includes all exact matches', async () => {
  let anomalyCount = 0;
  const noManagerClient = {
    user: { findMany: async () => [] },
    auditLog: { findFirst: async () => null, create: async () => { anomalyCount += 1; } }
  };
  assert.equal(await notifyNewRegistrationForManagers({ displayName: 'No Manager', department: 'Missing', userId: 'user-2' }, noManagerClient), false);
  assert.equal(anomalyCount, 1);
  const queries = [];
  const manyManagerClient = {
    user: { findMany: async (query) => { queries.push(query); return [{ email: 'manager1@example.invalid' }, { email: 'manager2@example.invalid' }]; } },
    auditLog: { findFirst: async () => null, create: async () => undefined }
  };
  await notifyNewRegistrationForManagers({ displayName: 'Many Managers', department: 'Operations', userId: 'user-3' }, manyManagerClient);
  assert.equal(queries[0].where.department, 'Operations');
});

test('anomaly reporter applies threshold and cooldown without recursion', async () => {
  assert.equal(POLICIES.email_delivery_failure.threshold, 3);
  const store = new MemoryAlertDedupStore();
  const client = { user: { findMany: async () => [{ email: 'admin@example.invalid' }] } };
  const report = createOperationalAnomalyReporter({ client, dedupStore: store, now: () => new Date('2026-08-03T00:00:00Z') });
  assert.equal((await report({ type: 'email_delivery_failure', safeMessage: 'provider_failure' })).status, 'suppressed');
  assert.equal((await report({ type: 'email_delivery_failure', safeMessage: 'provider_failure' })).status, 'suppressed');
  const third = await report({ type: 'email_delivery_failure', safeMessage: 'provider_failure' });
  assert.equal(third.delivered, false);
  assert.equal(third.status, 'disabled');
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
