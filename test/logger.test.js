process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createLogger } = require('../src/utils/logger');
const { createRequestLogger } = require('../src/middlewares/request-logger');
const requestContext = require('../src/middlewares/request-context');

function captureLogger() {
  const entries = [];
  const logger = createLogger({
    environment: 'test', clock: () => new Date('2026-07-22T00:00:00.000Z'),
    writer: (level, line) => entries.push({ level, record: JSON.parse(line), serialized: line })
  });
  return { logger, entries };
}

test('structured logger redacts secrets, prohibited headers, bodies, raw identities, hashes, and Error details', () => {
  const { logger, entries } = captureLogger();
  const fixtures = {
    password: 'synthetic-password-value', authorization: 'Bearer synthetic-access-value',
    headers: { cookie: 'synthetic-cookie-value', authorization: 'Bearer hidden' },
    body: { email: 'private.account@example.invalid', password: 'body-password' },
    ipAddress: '192.0.2.44', email: 'private.account@example.invalid', keyHash: 'a'.repeat(64),
    error: new Error('private connection text'), safeField: 'safe-value'
  };
  logger.error('synthetic_failure', fixtures);
  const entry = entries[0];
  assert.equal(entry.level, 'error');
  assert.equal(entry.record.safeField, 'safe-value');
  assert.equal(entry.record.password, '[REDACTED]');
  assert.equal(entry.record.authorization, '[REDACTED]');
  assert.equal(entry.record.headers, undefined);
  assert.equal(entry.record.body, undefined);
  assert.deepEqual(entry.record.error, { name: 'Error', category: 'internal_error' });
  for (const value of ['synthetic-password-value', 'synthetic-access-value', 'synthetic-cookie-value', 'private.account@example.invalid', '192.0.2.44', 'a'.repeat(64), 'private connection text']) {
    assert.equal(entry.serialized.includes(value), false);
  }
});

test('HTTP request logging uses a route template and excludes query strings, headers, bodies, IP, and account identity', () => {
  const { logger, entries } = captureLogger();
  const times = [0n, 2_500_000n];
  const middleware = createRequestLogger(logger, () => times.shift());
  const req = {
    requestId: 'safe-request-id', method: 'POST', baseUrl: '/api/v1', route: { path: '/employees/:id' },
    originalUrl: '/api/v1/employees/fixture?password=hidden', headers: { authorization: 'hidden' },
    body: { email: 'hidden@example.invalid' }, ip: '192.0.2.20'
  };
  const res = new EventEmitter(); res.statusCode = 200;
  let nextCalled = false; middleware(req, res, () => { nextCalled = true; }); res.emit('finish');
  assert.equal(nextCalled, true);
  assert.deepEqual(entries[0].record, {
    timestamp: '2026-07-22T00:00:00.000Z', level: 'info', event: 'http_request', deploymentEnvironment: 'test',
    requestId: 'safe-request-id', route: '/api/v1/employees/:id', method: 'POST', status: 200, durationMs: 2.5
  });
  const serialized = entries[0].serialized;
  assert.equal(serialized.includes('password=hidden'), false);
  assert.equal(serialized.includes('authorization'), false);
  assert.equal(serialized.includes('hidden@example.invalid'), false);
  assert.equal(serialized.includes('192.0.2.20'), false);
});

test('request context generates an ID and ignores untrusted request IDs', () => {
  const previous = process.env.VERCEL; delete process.env.VERCEL;
  const headers = {};
  const req = { get: (name) => name === 'x-request-id' ? 'untrusted-value' : undefined };
  requestContext(req, { setHeader: (name, value) => { headers[name] = value; } }, () => {});
  assert.match(req.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(req.requestId, headers['x-request-id']);
  if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
});

test('request context accepts only a safely formatted platform request ID in hosted execution', () => {
  const previous = process.env.VERCEL; process.env.VERCEL = '1';
  const req = { get: (name) => name === 'x-vercel-id' ? 'trusted_region::safe_request_123' : undefined };
  requestContext(req, { setHeader: () => {} }, () => {});
  assert.equal(req.requestId, 'trusted_region::safe_request_123');
  if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
});
