process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createAlertDedupKey } = require('../src/services/alert-dedup-key');
const { MemoryAlertDedupStore, PostgresAlertDedupStore } = require('../src/services/alert-dedup-store');
const { AlertPolicyEngine } = require('../src/services/alert-policy');
const { DisabledAlertDelivery, InMemoryAlertDelivery } = require('../src/services/alert-delivery');
const { createLogger } = require('../src/utils/logger');

const dedupSecret = 'test-alert-dedup-secret-with-at-least-thirty-two-chars';
const baseTime = new Date('2026-07-22T00:00:10.000Z');
const windowStart = new Date('2026-07-22T00:00:00.000Z');

function dedupInput(overrides = {}) {
  const eventCategory = overrides.eventCategory || 'readiness_failure';
  const route = overrides.route === undefined ? '/api/v1/ready' : overrides.route;
  const deploymentEnvironment = overrides.deploymentEnvironment || 'test';
  const window = overrides.windowStart || windowStart;
  return {
    eventCategory,
    dedupKeyHash: createAlertDedupKey({ eventCategory, route, deploymentEnvironment, windowStart: window }, dedupSecret),
    severity: overrides.severity || 'critical',
    windowStart: window,
    threshold: overrides.threshold || 1,
    occurredAt: overrides.occurredAt || baseTime,
    cooldownSeconds: overrides.cooldownSeconds || 60,
    expiresAt: overrides.expiresAt || new Date('2026-07-29T00:00:10.000Z')
  };
}

function policyWith(options = {}) {
  const delivery = options.delivery || new InMemoryAlertDelivery({ nodeEnv: 'test' });
  const policy = new AlertPolicyEngine({
    delivery, dedupStore: options.store || new MemoryAlertDedupStore(), dedupHashSecret: dedupSecret,
    clock: options.clock || (() => baseTime.getTime()), cooldownSeconds: options.cooldownSeconds || 60,
    thresholds: options.thresholds, onStoreFailure: options.onStoreFailure
  });
  return { delivery, policy };
}

test('below-cooldown alert is eligible, duplicate is suppressed, and expiry permits a later alert', async () => {
  const store = new MemoryAlertDedupStore();
  const firstInput = dedupInput();
  const first = await store.reserve(firstInput);
  assert.equal(first.eligible, true);
  assert.equal(first.suppressed, false);
  assert.equal(first.occurrenceCount, 1);
  const duplicate = await store.reserve({ ...firstInput, occurredAt: new Date('2026-07-22T00:00:20.000Z') });
  assert.equal(duplicate.eligible, false);
  assert.equal(duplicate.suppressed, true);
  assert.equal(duplicate.occurrenceCount, 2);
  const expired = await store.reserve({ ...firstInput, occurredAt: new Date('2026-07-22T00:01:11.000Z') });
  assert.equal(expired.eligible, true);
  assert.equal(expired.occurrenceCount, 3);
});

test('key-specific reset removes only the selected deduplication state', async () => {
  const store = new MemoryAlertDedupStore();
  const readiness = dedupInput();
  const serverError = dedupInput({ eventCategory: 'unexpected_http_5xx', route: '/api/v1/employees' });
  await store.reserve(readiness);
  await store.reserve(serverError);
  await store.reset(readiness);
  assert.equal(store.entries().length, 1);
  const reset = await store.reserve(readiness);
  assert.equal(reset.eligible, true);
  assert.equal(reset.occurrenceCount, 1);
});

test('occurrences aggregate until the configured threshold is reached', async () => {
  const store = new MemoryAlertDedupStore();
  const input = dedupInput({ threshold: 3 });
  assert.equal((await store.reserve(input)).eligible, false);
  assert.equal((await store.reserve(input)).occurrenceCount, 2);
  const threshold = await store.reserve(input);
  assert.equal(threshold.eligible, true);
  assert.equal(threshold.occurrenceCount, 3);
});

test('two independent policy instances sharing one store observe the same cooldown', async () => {
  const shared = new MemoryAlertDedupStore();
  const first = policyWith({ store: shared });
  const second = policyWith({ store: shared });
  const record = { event: 'readiness_failure', route: '/api/v1/ready', deploymentEnvironment: 'test' };
  assert.equal((await first.policy.evaluate(record)).delivered, true);
  const duplicate = await second.policy.evaluate(record);
  assert.equal(duplicate.delivered, false);
  assert.equal(duplicate.status, 'cooldown_suppressed');
  assert.equal(first.delivery.getRecords().length, 1);
  assert.equal(second.delivery.getRecords().length, 0);
});

test('concurrent memory reservations do not lose occurrence increments', async () => {
  const store = new MemoryAlertDedupStore();
  const input = dedupInput();
  const decisions = await Promise.all(Array.from({ length: 50 }, () => store.reserve(input)));
  assert.deepEqual(decisions.map((item) => item.occurrenceCount).sort((a, b) => a - b), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.equal(decisions.filter((item) => item.eligible).length, 1);
});

test('HMAC deduplication input ignores identities, request IDs, errors, and unsafe route queries', () => {
  const safe = { eventCategory: 'readiness_failure', route: '/api/v1/ready', deploymentEnvironment: 'test', windowStart };
  const first = createAlertDedupKey({
    ...safe, email: 'first.fixture@example.invalid', ipAddress: '192.0.2.20', requestId: 'request-one',
    error: new Error('synthetic private detail')
  }, dedupSecret);
  const second = createAlertDedupKey({
    ...safe, email: 'second.fixture@example.invalid', ipAddress: '192.0.2.21', requestId: 'request-two',
    error: new Error('different synthetic detail')
  }, dedupSecret);
  assert.equal(first, second);
  const unsafeRoute = createAlertDedupKey({ ...safe, route: '/api/v1/ready?private=fixture' }, dedupSecret);
  const omittedRoute = createAlertDedupKey({ ...safe, route: undefined }, dedupSecret);
  assert.equal(unsafeRoute, omittedRoute);
});

test('stored memory state contains no raw route, identity, credential, or Error detail', async () => {
  const store = new MemoryAlertDedupStore();
  const { policy } = policyWith({ store });
  const fixture = {
    event: 'readiness_failure', route: '/api/v1/ready?private=fixture', deploymentEnvironment: 'test',
    requestId: 'request-fixture', body: { password: 'synthetic-credential-value' },
    headers: { authorization: 'synthetic-authorization-value' }, email: 'fixture@example.invalid',
    ipAddress: '192.0.2.30', error: new Error('synthetic raw error detail')
  };
  await policy.evaluate(fixture);
  const serialized = JSON.stringify(store.entries());
  for (const value of [
    'private=fixture', 'request-fixture', 'synthetic-credential-value', 'synthetic-authorization-value',
    'fixture@example.invalid', '192.0.2.30', 'synthetic raw error detail'
  ]) assert.equal(serialized.includes(value), false);
});

test('PostgreSQL configuration requires its independent deduplication secret', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./src/config/env')"], {
    cwd: process.cwd(), encoding: 'utf8', env: {
      ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@localhost:5432/smsv3_test',
      JWT_SECRET: 'test-secret-with-at-least-thirty-two-chars', CORS_ORIGIN: 'https://staging.example.test',
      RATE_LIMIT_STORE: 'memory', ALERTING_ENABLED: 'false', ALERT_DEDUP_STORE: 'postgres', ALERT_DEDUP_HASH_SECRET: ''
    }
  });
  assert.notEqual(result.status, 0);
  assert.equal(`${result.stdout}${result.stderr}`.includes('ALERT_DEDUP_HASH_SECRET'), true);
});

test('PostgreSQL store uses an atomic conflict update and returns no stored hash', async () => {
  let count = 0;
  const statements = [];
  const client = {
    $queryRaw: async (strings) => {
      statements.push(strings.join('?'));
      count += 1;
      return [{ occurrenceCount: count, cooldownUntil: new Date('2026-07-22T00:01:10.000Z'), eligible: count === 1 }];
    }
  };
  const first = new PostgresAlertDedupStore(client);
  const second = new PostgresAlertDedupStore(client);
  const input = dedupInput();
  const decisions = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).reserve(input)));
  assert.deepEqual(decisions.map((item) => item.occurrenceCount).sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.ok(statements.every((statement) => statement.includes('ON CONFLICT ("event_category", "dedup_key_hash", "window_start")')));
  assert.ok(statements.every((statement) => statement.includes('"occurrence_count" + 1')));
  assert.ok(statements.every((statement) => statement.includes('"alert_deduplication_states"')));
  assert.ok(statements.every((statement) => !statement.includes('employees') && !statement.includes('users') && !statement.includes('audit_logs')));
  assert.equal(JSON.stringify(decisions).includes(input.dedupKeyHash), false);
});

test('PostgreSQL store failure returns a safe failure and never calls delivery', async () => {
  let deliveryCalls = 0;
  const failures = [];
  const policy = new AlertPolicyEngine({
    delivery: { deliver: () => { deliveryCalls += 1; return { delivered: true, status: 'unexpected' }; } },
    dedupStore: { reserve: async () => { throw new Error('synthetic private database detail'); } },
    dedupHashSecret: dedupSecret, clock: () => baseTime.getTime(), onStoreFailure: (fields) => failures.push(fields)
  });
  const decision = await policy.evaluate({ event: 'readiness_failure', deploymentEnvironment: 'test' });
  assert.deepEqual(decision, {
    delivered: false, status: 'store_unavailable', eligible: false, suppressed: false,
    occurrenceCount: 0, cooldownUntil: null, failureCategory: 'alert_dedup_store_unavailable'
  });
  assert.equal(deliveryCalls, 0);
  assert.deepEqual(failures, [{ eventCategory: 'readiness_failure', errorCategory: 'alert_dedup_store_unavailable' }]);
});

test('delivery-state store failure cannot produce a false delivery claim', async () => {
  const delivery = new InMemoryAlertDelivery({ nodeEnv: 'test' });
  const policy = new AlertPolicyEngine({
    delivery,
    dedupStore: {
      reserve: async () => ({ eligible: true, suppressed: false, occurrenceCount: 1, cooldownUntil: new Date('2026-07-22T00:01:10.000Z') }),
      recordDelivery: async () => { throw new Error('synthetic state update failure'); }
    },
    dedupHashSecret: dedupSecret, clock: () => baseTime.getTime()
  });
  const decision = await policy.evaluate({ event: 'readiness_failure', deploymentEnvironment: 'test' });
  assert.equal(delivery.getRecords().length, 1);
  assert.equal(decision.delivered, false);
  assert.equal(decision.status, 'store_unavailable');
  assert.equal(decision.failureCategory, 'alert_dedup_store_unavailable');
});

test('generic delivery state records no destination or provider response content', async () => {
  const disabledStore = new MemoryAlertDedupStore();
  const disabled = new AlertPolicyEngine({
    delivery: new DisabledAlertDelivery(), dedupStore: disabledStore, dedupHashSecret: dedupSecret,
    clock: () => baseTime.getTime()
  });
  const result = await disabled.evaluate({ event: 'readiness_failure', deploymentEnvironment: 'test' });
  assert.equal(result.delivered, false);
  assert.equal(disabledStore.entries()[0].deliveryStatus, 'suppressed');
  assert.equal(disabledStore.entries()[0].lastDeliveryAttemptAt, undefined);
  assert.deepEqual(Object.keys(disabledStore.entries()[0]).sort(), [
    'cooldownUntil', 'createdAt', 'dedupKeyHash', 'deliveryStatus', 'eventCategory', 'expiresAt', 'id',
    'lastDeliveryAttemptAt', 'lastOccurrenceAt', 'occurrenceCount', 'severity', 'updatedAt', 'windowStart'
  ]);
});

test('cleanup deletes only expired alert-deduplication records', async () => {
  let where;
  const logLines = [];
  const client = {
    alertDeduplicationState: { deleteMany: async (args) => { where = args.where; return { count: 2 }; } },
    employee: { deleteMany: async () => { throw new Error('unexpected model'); } },
    auditLog: { deleteMany: async () => { throw new Error('unexpected model'); } }
  };
  const logger = createLogger({ environment: 'test', writer: (_level, line) => logLines.push(line) });
  const removed = await new PostgresAlertDedupStore(client, { logger }).cleanupExpired(baseTime);
  assert.equal(removed, 2);
  assert.deepEqual(where, { expiresAt: { lte: baseTime } });
  assert.equal(JSON.parse(logLines[0]).event, 'alert_dedup_cleanup_result');
});

test('migration is limited to the dedicated alert-deduplication table and indexes', () => {
  const migration = fs.readFileSync(path.join(process.cwd(), 'prisma/migrations/202607220002_shared_alert_deduplication/migration.sql'), 'utf8');
  assert.equal(migration.includes('alert_deduplication_states'), true);
  for (const existing of ['users', 'employees', 'audit_logs', 'refresh_sessions', 'rate_limit_buckets', 'DELETE FROM', 'UPDATE ', 'DROP ', 'TRUNCATE ']) {
    assert.equal(migration.includes(existing), false);
  }
});
