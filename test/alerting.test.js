process.env.NODE_ENV = 'test';
process.env.ALERTING_ENABLED = 'false';
process.env.ALERTING_PROVIDER = 'disabled';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const env = require('../src/config/env');
const {
  AlertConfigurationError, DisabledAlertDelivery, InMemoryAlertDelivery, EnterpriseChatAlertDelivery, createAlertDelivery
} = require('../src/services/alert-delivery');
const { InProcessAlertCooldown } = require('../src/services/alert-cooldown');
const { AlertPolicyEngine } = require('../src/services/alert-policy');
const { createConfiguredAlerting } = require('../src/services/alerting.service');
const { createLogger } = require('../src/utils/logger');

function memoryPolicy(options = {}) {
  const delivery = new InMemoryAlertDelivery({ nodeEnv: 'test' });
  const policy = new AlertPolicyEngine({ delivery, ...options });
  return { delivery, policy };
}

test('alerting is disabled by default and does not claim delivery', async () => {
  const configured = createConfiguredAlerting(env);
  assert.equal(configured.delivery instanceof DisabledAlertDelivery, true);
  const result = await configured.evaluate({ event: 'readiness_failure', deploymentEnvironment: 'test' });
  assert.equal(result.delivered, false);
  assert.equal(result.status, 'disabled');
  assert.equal(result.eligible, true);
  assert.equal(result.suppressed, false);
  assert.equal(result.occurrenceCount, 1);
  assert.match(result.cooldownUntil, /^\d{4}-\d{2}-\d{2}T/);
});

test('disabled delivery performs no network operation', () => {
  let networkCalls = 0;
  const previous = global.fetch;
  global.fetch = () => { networkCalls += 1; throw new Error('network must not be called'); };
  try {
    const delivery = createAlertDelivery({ enabled: false, provider: 'disabled', nodeEnv: 'test' });
    assert.deepEqual(delivery.deliver({ eventCategory: 'readiness_failure' }), { delivered: false, status: 'disabled' });
    assert.equal(networkCalls, 0);
  } finally {
    if (previous === undefined) delete global.fetch; else global.fetch = previous;
  }
});

test('in-memory delivery is restricted to automated tests', () => {
  assert.throws(() => new InMemoryAlertDelivery({ nodeEnv: 'production' }), AlertConfigurationError);
  assert.throws(() => createAlertDelivery({ enabled: true, provider: 'unsupported', nodeEnv: 'production' }), AlertConfigurationError);
});

test('test delivery receives only the approved sanitized payload fields', async () => {
  const { delivery, policy } = memoryPolicy({ clock: () => Date.parse('2026-07-22T00:00:00.000Z') });
  const fixture = {
    event: 'readiness_failure', timestamp: '2026-07-22T00:00:00.000Z', deploymentEnvironment: 'test',
    requestId: 'safe-request-id', route: '/api/v1/ready', body: { password: 'synthetic-body-value' },
    headers: { authorization: 'synthetic-header-value' }, error: new Error('synthetic private stack detail'),
    email: 'private.fixture@example.invalid', ipAddress: '192.0.2.50', keyHash: 'a'.repeat(64)
  };
  assert.equal((await policy.evaluate(fixture)).delivered, true);
  const payload = delivery.getRecords()[0];
  assert.deepEqual(Object.keys(payload).sort(), [
    'deploymentEnvironment', 'eventCategory', 'guidance', 'requestId', 'route', 'severity', 'timestamp'
  ]);
  assert.equal(payload.eventCategory, 'readiness_failure');
  assert.equal(payload.route, '/api/v1/ready');
  const serialized = JSON.stringify(payload);
  for (const prohibited of [
    'synthetic-body-value', 'synthetic-header-value', 'synthetic private stack detail',
    'private.fixture@example.invalid', '192.0.2.50', 'a'.repeat(64), 'password', 'authorization'
  ]) assert.equal(serialized.includes(prohibited), false);
});

test('unsafe request IDs and complete or query-bearing routes are omitted', async () => {
  const { delivery, policy } = memoryPolicy();
  await policy.evaluate({
    event: 'unexpected_http_5xx', deploymentEnvironment: 'test',
    requestId: 'unsafe request id', route: '/api/v1/employees?private=fixture'
  });
  const payload = delivery.getRecords()[0];
  assert.equal(payload.requestId, undefined);
  assert.equal(payload.route, undefined);
});

test('cooldown suppresses duplicates and expiry permits a later alert', async () => {
  let now = Date.parse('2026-07-22T00:00:00.000Z');
  const { delivery, policy } = memoryPolicy({ clock: () => now, cooldownSeconds: 60 });
  assert.equal((await policy.evaluate({ event: 'readiness_failure', deploymentEnvironment: 'test' })).status, 'recorded_for_test');
  const duplicate = await policy.evaluate({ event: 'readiness_failure', deploymentEnvironment: 'test' });
  assert.equal(duplicate.status, 'cooldown_suppressed');
  assert.equal(delivery.getRecords().length, 1);
  now += 61_000;
  assert.equal((await policy.evaluate({ event: 'readiness_failure', deploymentEnvironment: 'test' })).status, 'recorded_for_test');
  assert.equal(delivery.getRecords().length, 2);
});

test('cooldown can be reset explicitly by key or in full', () => {
  const cooldown = new InProcessAlertCooldown({ clock: () => 1000 });
  assert.equal(cooldown.evaluate('readiness_failure:global', 60).allowed, true);
  assert.equal(cooldown.evaluate('readiness_failure:global', 60).allowed, false);
  cooldown.reset('readiness_failure:global');
  assert.equal(cooldown.evaluate('readiness_failure:global', 60).allowed, true);
  cooldown.reset();
  assert.equal(cooldown.size(), 0);
});

test('unsupported enabled provider fails configuration safely', () => {
  const providerFixture = 'unsupported-provider-fixture';
  const result = spawnSync(process.execPath, ['-e', "require('./src/config/env')"], {
    cwd: process.cwd(), encoding: 'utf8', env: {
      ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@localhost:5432/smsv3_test',
      JWT_SECRET: 'test-secret-with-at-least-thirty-two-chars', CORS_ORIGIN: 'https://staging.example.test',
      RATE_LIMIT_STORE: 'memory', ALERTING_ENABLED: 'true', ALERTING_PROVIDER: providerFixture
    }
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(output.includes(providerFixture), false);
  assert.equal(output.includes('ALERTING_PROVIDER'), true);
});

test('ordinary 401 and individual 429 events remain dashboard-only by default', async () => {
  const { delivery, policy } = memoryPolicy();
  assert.equal((await policy.evaluate({ event: 'http_request', status: 401, route: '/api/v1/employees' })).status, 'dashboard_only');
  assert.equal((await policy.evaluate({ event: 'rate_limit_denied', status: 429, route: '/api/v1/auth/login' })).status, 'dashboard_only');
  assert.equal(delivery.getRecords().length, 0);
});

test('approved threshold hooks aggregate safely before alerting', async () => {
  const { delivery, policy } = memoryPolicy({ thresholds: { loginFailureSpike: 3, refreshFailureSpike: 2, http429Spike: 2 } });
  assert.equal((await policy.evaluate({ event: 'authentication_failure' })).status, 'threshold_pending');
  assert.equal((await policy.evaluate({ event: 'authentication_failure' })).status, 'threshold_pending');
  assert.equal((await policy.evaluate({ event: 'authentication_failure' })).status, 'recorded_for_test');
  assert.equal((await policy.evaluate({ event: 'refresh_failure' })).status, 'threshold_pending');
  assert.equal((await policy.evaluate({ event: 'refresh_failure' })).status, 'recorded_for_test');
  assert.equal((await policy.evaluate({ event: 'rate_limit_denied' })).status, 'threshold_pending');
  assert.equal((await policy.evaluate({ event: 'rate_limit_denied' })).status, 'recorded_for_test');
  assert.equal(delivery.getRecords().length, 3);
});

test('readiness and limiter-store failures produce expected safe alerts', async () => {
  const { delivery, policy } = memoryPolicy();
  assert.equal((await policy.evaluate({ event: 'readiness_failure', requestId: 'request-one' })).delivered, true);
  assert.equal((await policy.evaluate({ event: 'rate_limit_store_unavailable', requestId: 'request-two', route: '/api/v1/auth/login' })).delivered, true);
  assert.deepEqual(delivery.getRecords().map((record) => record.eventCategory), ['readiness_failure', 'rate_limit_store_unavailable']);
});

test('configuration, startup-dependency, and unexpected server failures are policy-approved', async () => {
  const { delivery, policy } = memoryPolicy();
  for (const event of ['application_config_invalid', 'startup_dependency_failure', 'unexpected_http_5xx']) {
    assert.equal((await policy.evaluate({ event, deploymentEnvironment: 'test' })).delivered, true);
  }
  assert.deepEqual(delivery.getRecords().map((record) => record.eventCategory), [
    'application_config_invalid', 'startup_dependency_failure', 'unexpected_http_5xx'
  ]);
});

test('database-latency and function-timeout hooks remain disabled until configured', async () => {
  const disabled = memoryPolicy();
  assert.equal((await disabled.policy.evaluate({ event: 'database_latency', durationMs: 2000 })).status, 'dashboard_only');
  assert.equal((await disabled.policy.evaluate({ event: 'function_timeout' })).status, 'dashboard_only');
  assert.equal(disabled.delivery.getRecords().length, 0);

  const enabled = memoryPolicy({ thresholds: { databaseLatencyMs: 500, functionTimeoutCount: 2 } });
  assert.equal((await enabled.policy.evaluate({ event: 'database_latency', durationMs: 499 })).status, 'dashboard_only');
  assert.equal((await enabled.policy.evaluate({ event: 'database_latency', durationMs: 500 })).status, 'recorded_for_test');
  assert.equal((await enabled.policy.evaluate({ event: 'function_timeout' })).status, 'threshold_pending');
  assert.equal((await enabled.policy.evaluate({ event: 'function_timeout' })).status, 'recorded_for_test');
  assert.deepEqual(enabled.delivery.getRecords().map((record) => record.eventCategory), ['database_latency', 'function_timeout']);
});

test('cleanup alert requires repeated failure and reset clears aggregate state', async () => {
  const { delivery, policy } = memoryPolicy();
  assert.equal((await policy.evaluate({ event: 'rate_limit_cleanup_failure' })).status, 'threshold_pending');
  assert.equal((await policy.evaluate({ event: 'rate_limit_cleanup_failure' })).status, 'recorded_for_test');
  await policy.reset();
  assert.equal((await policy.evaluate({ event: 'rate_limit_cleanup_failure' })).status, 'threshold_pending');
  assert.equal(delivery.getRecords().length, 1);
});

test('central logger forwards safe records to the policy without forwarding raw inputs', async () => {
  const { delivery, policy } = memoryPolicy();
  const lines = [];
  const logger = createLogger({
    environment: 'test', writer: (_level, line) => lines.push(line),
    eventSink: (record) => policy.evaluate(record)
  });
  logger.error('readiness_failure', {
    requestId: 'safe-request', route: '/api/v1/ready',
    headers: { authorization: 'synthetic-value' }, body: { email: 'fixture@example.invalid' },
    error: new Error('synthetic private detail')
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivery.getRecords().length, 1);
  const combined = `${lines.join('')} ${JSON.stringify(delivery.getRecords())}`;
  for (const value of ['synthetic-value', 'fixture@example.invalid', 'synthetic private detail']) {
    assert.equal(combined.includes(value), false);
  }
});

test('policy delivery failure is recorded safely and never reported as delivered', () => {
  const lines = [];
  const logger = createLogger({
    environment: 'test', writer: (_level, line) => lines.push(JSON.parse(line)),
    eventSink: () => { throw new Error('synthetic private delivery detail'); }
  });
  logger.error('readiness_failure', { requestId: 'safe-request' });
  assert.equal(lines.length, 2);
  assert.equal(lines[1].event, 'alert_policy_failure');
  assert.equal(lines[1].errorCategory, 'internal_error');
  assert.equal(JSON.stringify(lines).includes('synthetic private delivery detail'), false);
  assert.equal(JSON.stringify(lines).includes('delivered'), false);
});

test('enterprise chat provider is not active unless explicitly selected', () => {
  const delivery = createAlertDelivery({ enabled: false });
  assert.equal(delivery instanceof DisabledAlertDelivery, true);
});

test('missing destination/credential fails closed', () => {
  assert.throws(() => new EnterpriseChatAlertDelivery({ enabled: true, destination: '', token: '' }), AlertConfigurationError);
  assert.throws(() => new EnterpriseChatAlertDelivery({ enabled: true, destination: 'http://localhost', token: '' }), AlertConfigurationError);
  assert.throws(() => new EnterpriseChatAlertDelivery({ enabled: true, destination: '', token: 'token' }), AlertConfigurationError);
});

test('invalid destination config fails safely during construct', () => {
  assert.throws(() => createAlertDelivery({ enabled: true, provider: 'enterprise_chat' }), AlertConfigurationError);
});

test('successful mock delivery records safe state only', async () => {
  const prevFetch = global.fetch;
  let fetchCall = null;
  global.fetch = async (url, options) => {
    fetchCall = { url, options };
    return { ok: true, status: 200 };
  };

  try {
    const delivery = new EnterpriseChatAlertDelivery({
      enabled: true,
      destination: 'https://chat.example.com/webhook',
      token: 'super-secret-token'
    });

    const payload = {
      event: 'database_latency',
      timestamp: '2026-07-23T00:00:00.000Z',
      message: 'Too slow',
      unwantedField: 'should-be-removed',
      cookie: 'session=123',
      csrf: 'token-abc',
      token: 'jwt-xyz'
    };

    const res = await delivery.deliver(payload);
    assert.equal(res.delivered, true);
    assert.equal(res.status, 'sent');
    assert.equal(fetchCall.url, 'https://chat.example.com/webhook');
    assert.equal(fetchCall.options.headers['Authorization'], 'Bearer super-secret-token');

    const body = JSON.parse(fetchCall.options.body);
    assert.equal(body.message, 'Too slow');
    assert.equal(body.unwantedField, undefined);
    assert.equal(body.cookie, undefined);
    assert.equal(body.csrf, undefined);
    assert.equal(body.token, undefined);
  } finally {
    global.fetch = prevFetch;
  }
});

test('failed mock delivery does not claim success and sanitizes error', async () => {
  const prevFetch = global.fetch;
  global.fetch = async () => {
    return { ok: false, status: 500 };
  };

  try {
    const delivery = new EnterpriseChatAlertDelivery({
      enabled: true,
      destination: 'https://chat.example.com/webhook',
      token: 'secret-token'
    });
    const res = await delivery.deliver({ message: 'Error' });
    assert.equal(res.delivered, false);
    assert.equal(res.status, 'failed');
    assert.equal(res.statusCode, 500);
  } finally {
    global.fetch = prevFetch;
  }
});

test('timeout handling is bounded and sanitized', async () => {
  const prevFetch = global.fetch;
  global.fetch = async (url, options) => {
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  try {
    const delivery = new EnterpriseChatAlertDelivery({
      enabled: true,
      destination: 'https://chat.example.com/webhook',
      token: 'secret-token',
      timeoutMs: 10
    });
    const res = await delivery.deliver({ message: 'Timeout' });
    assert.equal(res.delivered, false);
    assert.equal(res.status, 'failed');
    assert.equal(res.error, 'timeout');
  } finally {
    global.fetch = prevFetch;
  }
});
