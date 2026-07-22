process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_STORE = 'memory';
process.env.RATE_LIMIT_HASH_SECRET = 'test-rate-limit-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { MemoryRateLimitStore, PostgresRateLimitStore } = require('../src/services/rate-limit-store');
const { createRateLimitEvaluator } = require('../src/services/rate-limit.service');
const { getRequestIpIdentity, normalizeAccountIdentity, normalizeIpIdentity } = require('../src/services/rate-limit-key');
const { createLoginRateLimit, publicLimitMessage, publicStoreFailureMessage } = require('../src/middlewares/login-rate-limit');

const hashSecret = 'test-rate-limit-secret-with-at-least-thirty-two-chars';

function runMiddleware(middleware, req) {
  const headers = {};
  return new Promise((resolve) => middleware(req, { setHeader: (name, value) => { headers[name] = value; } }, (error) => resolve({ error, headers })));
}

test('fixed-window requests below and exactly at the limit pass, then the next request is blocked', async () => {
  const store = new MemoryRateLimitStore();
  const evaluate = createRateLimitEvaluator({ store, hashSecret, limit: 3, windowMs: 60_000, clock: () => new Date('2026-07-22T00:00:10.000Z') });
  const first = await evaluate({ scope: 'login-ip', identity: '192.0.2.1' });
  const second = await evaluate({ scope: 'login-ip', identity: '192.0.2.1' });
  const exact = await evaluate({ scope: 'login-ip', identity: '192.0.2.1' });
  const above = await evaluate({ scope: 'login-ip', identity: '192.0.2.1' });
  assert.equal(first.allowed, true); assert.equal(first.remaining, 2);
  assert.equal(second.allowed, true); assert.equal(second.remaining, 1);
  assert.equal(exact.allowed, true); assert.equal(exact.remaining, 0);
  assert.equal(above.allowed, false); assert.equal(above.remaining, 0);
  assert.equal(above.retryAfterSeconds, 50);
});

test('login middleware returns generic HTTP 429 details and Retry-After after the configured limit', async () => {
  const middleware = createLoginRateLimit({ store: new MemoryRateLimitStore(), storeType: 'memory', hashSecret, limit: 1, windowMs: 60_000, clock: () => new Date('2026-07-22T00:00:10.000Z') });
  const request = { ip: '192.0.2.2', body: { email: 'sample@example.invalid' }, requestId: 'safe-request' };
  assert.equal((await runMiddleware(middleware, request)).error, undefined);
  const blocked = await runMiddleware(middleware, request);
  assert.equal(blocked.error.statusCode, 429);
  assert.equal(blocked.error.message, publicLimitMessage);
  assert.equal(blocked.headers['Retry-After'], 50);
  assert.equal(blocked.headers['RateLimit-Limit'], 1);
  assert.equal(blocked.headers['RateLimit-Remaining'], 0);
  assert.ok(Number.isInteger(blocked.headers['RateLimit-Reset']));
});

test('expired fixed windows reset safely', async () => {
  let now = new Date('2026-07-22T00:00:10.000Z');
  const store = new MemoryRateLimitStore();
  const evaluate = createRateLimitEvaluator({ store, hashSecret, limit: 1, windowMs: 60_000, clock: () => now });
  assert.equal((await evaluate({ scope: 'login-account', identity: 'account@example.invalid' })).allowed, true);
  assert.equal((await evaluate({ scope: 'login-account', identity: 'account@example.invalid' })).allowed, false);
  now = new Date('2026-07-22T00:01:00.000Z');
  const reset = await evaluate({ scope: 'login-account', identity: 'account@example.invalid' });
  assert.equal(reset.allowed, true); assert.equal(reset.count, 1); assert.equal(store.entries().length, 1);
});

test('different hashed identities are isolated', async () => {
  const evaluate = createRateLimitEvaluator({ store: new MemoryRateLimitStore(), hashSecret, limit: 1, windowMs: 60_000, clock: () => new Date('2026-07-22T00:00:10.000Z') });
  assert.equal((await evaluate({ scope: 'login-account', identity: 'first@example.invalid' })).allowed, true);
  assert.equal((await evaluate({ scope: 'login-account', identity: 'second@example.invalid' })).allowed, true);
  assert.equal((await evaluate({ scope: 'login-account', identity: 'first@example.invalid' })).allowed, false);
});

test('Vercel client IP uses the platform header while local requests ignore forwarded spoofing', () => {
  const request = {
    ip: '192.0.2.10',
    headers: { 'x-vercel-forwarded-for': '198.51.100.20' },
    get: (name) => name === 'x-vercel-forwarded-for' ? '198.51.100.20' : undefined
  };
  assert.equal(getRequestIpIdentity(request, { isVercel: true }), '198.51.100.20');
  assert.equal(getRequestIpIdentity(request, { isVercel: false }), '192.0.2.10');
  assert.equal(normalizeIpIdentity('not-an-ip-address'), 'unknown');
});

test('concurrent memory increments are not lost', async () => {
  const evaluate = createRateLimitEvaluator({ store: new MemoryRateLimitStore(), hashSecret, limit: 100, windowMs: 60_000, clock: () => new Date('2026-07-22T00:00:10.000Z') });
  const results = await Promise.all(Array.from({ length: 50 }, () => evaluate({ scope: 'login-ip', identity: '192.0.2.3' })));
  assert.deepEqual(results.map((result) => result.count).sort((a, b) => a - b), Array.from({ length: 50 }, (_, index) => index + 1));
});

test('two limiter instances share counters when they use the same store and secret', async () => {
  const store = new MemoryRateLimitStore();
  const options = { store, storeType: 'memory', hashSecret, limit: 2, windowMs: 60_000, clock: () => new Date('2026-07-22T00:00:10.000Z') };
  const firstInstance = createLoginRateLimit(options);
  const secondInstance = createLoginRateLimit(options);
  const request = { ip: '192.0.2.4', body: { email: 'shared@example.invalid' }, requestId: 'safe-request' };
  assert.equal((await runMiddleware(firstInstance, request)).error, undefined);
  assert.equal((await runMiddleware(secondInstance, request)).error, undefined);
  assert.equal((await runMiddleware(firstInstance, request)).error.statusCode, 429);
});

test('PostgreSQL store uses one atomic conflict increment statement under concurrency', async () => {
  let count = 0; const statements = [];
  const client = { $queryRaw: async (strings) => { statements.push(strings.join('?')); count += 1; return [{ count }]; } };
  const firstStore = new PostgresRateLimitStore(client);
  const secondStore = new PostgresRateLimitStore(client);
  const input = { scope: 'login-ip', keyHash: 'a'.repeat(64), windowStart: new Date('2026-07-22T00:00:00.000Z'), expiresAt: new Date('2026-07-22T00:01:00.000Z'), now: new Date('2026-07-22T00:00:10.000Z') };
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? firstStore : secondStore).increment(input)));
  assert.deepEqual(results.sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.ok(statements.every((statement) => statement.includes('ON CONFLICT ("scope", "key_hash", "window_start")')));
  assert.ok(statements.every((statement) => statement.includes('"rate_limit_buckets"."count" + 1')));
  assert.ok(statements.every((statement) => statement.includes('DELETE FROM "rate_limit_buckets"')));
  assert.ok(statements.every((statement) => !statement.includes('employees') && !statement.includes('users')));
});

test('PostgreSQL cleanup targets only the rate-limit model', async () => {
  let where;
  const client = {
    rateLimitBucket: { deleteMany: async (args) => { where = args.where; return { count: 2 }; } },
    employee: { deleteMany: async () => { throw new Error('unexpected table'); } }
  };
  const removed = await new PostgresRateLimitStore(client).cleanupExpired(new Date('2026-07-22T00:02:00.000Z'));
  assert.equal(removed, 2); assert.ok(where.expiresAt.lte instanceof Date);
});

test('PostgreSQL store failure fails closed without exposing implementation details', async () => {
  const logs = [];
  const middleware = createLoginRateLimit({
    store: { increment: async () => { throw new Error('private database failure'); } }, storeType: 'postgres', hashSecret,
    limit: 2, windowMs: 60_000, logger: { error: (value) => logs.push(value) }
  });
  const request = { ip: '192.0.2.55', body: { email: 'sensitive@example.invalid' }, requestId: 'safe-request' };
  const result = await runMiddleware(middleware, request);
  assert.equal(result.error.statusCode, 503); assert.equal(result.error.message, publicStoreFailureMessage);
  const serialized = JSON.stringify({ error: result.error.message, logs });
  assert.equal(serialized.includes(request.ip), false);
  assert.equal(serialized.includes(request.body.email), false);
  assert.equal(serialized.includes(hashSecret), false);
  assert.equal(serialized.includes('private database failure'), false);
});

test('PostgreSQL selection fails fast when RATE_LIMIT_HASH_SECRET is missing', () => {
  const script = "require('./src/config/env')";
  assert.throws(() => execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(), stdio: 'pipe', env: {
      ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@localhost:5432/smsv3_test',
      JWT_SECRET: 'test-secret-with-at-least-thirty-two-chars', CORS_ORIGIN: 'https://staging.example.test',
      RATE_LIMIT_STORE: 'postgres', RATE_LIMIT_HASH_SECRET: ''
    }
  }));
});

test('stored rate-limit records contain hashes, never raw account or IP identities', async () => {
  const store = new MemoryRateLimitStore();
  const middleware = createLoginRateLimit({ store, storeType: 'memory', hashSecret, limit: 2, windowMs: 60_000, clock: () => new Date('2026-07-22T00:00:10.000Z') });
  const rawIp = '::ffff:192.0.2.99'; const rawEmail = '  Private.Sample@Example.Invalid  ';
  await runMiddleware(middleware, { ip: rawIp, body: { email: rawEmail }, requestId: 'safe-request' });
  const serialized = JSON.stringify(store.entries());
  assert.equal(serialized.includes(rawIp), false);
  assert.equal(serialized.includes(rawEmail), false);
  assert.equal(serialized.includes(normalizeIpIdentity(rawIp)), false);
  assert.equal(serialized.includes(normalizeAccountIdentity(rawEmail)), false);
  assert.ok(store.entries().every((entry) => /^[a-f0-9]{64}$/.test(entry.keyHash)));
});
