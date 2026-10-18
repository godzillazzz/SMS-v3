'use strict';

process.env.DATABASE_URL ||= 'postgresql://telemetry:test@localhost:5432/telemetry';
process.env.JWT_SECRET ||= 'telemetry-test-secret-that-is-long-enough';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  MAX_SAMPLES_PER_ROUTE,
  normalizeRoute,
  record,
  summarize,
  resetForTest
} = require('../src/lib/route-latency-registry');
const latencyMiddleware = require('../src/middlewares/route-latency');
const { createTelemetryRoutes } = require('../src/routes/telemetry.routes');

function fakeAuth(role) {
  return (req, _res, next) => {
    if (!role) return next(Object.assign(new Error('Authentication required.'), { statusCode: 401 }));
    req.user = { role };
    return next();
  };
}

function fakeAuthorize(...roles) {
  return (req, _res, next) => roles.includes(req.user?.role)
    ? next()
    : next(Object.assign(new Error('Forbidden.'), { statusCode: 403 }));
}

function endpointApp(role) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/telemetry', createTelemetryRoutes({
    authenticateMiddleware: fakeAuth(role),
    authorizeMiddleware: fakeAuthorize
  }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
  return app;
}

test.beforeEach(() => resetForTest());

test('registry normalizes ids and UUIDs and retains only the latest 512 samples per route', () => {
  assert.equal(normalizeRoute('get', '/api/v1/employees/123?secret=query'), 'GET /api/v1/employees/:id');
  assert.equal(normalizeRoute('GET', '/api/v1/employees/550e8400-e29b-41d4-a716-446655440000'), 'GET /api/v1/employees/:id');
  const now = Date.now();
  for (let i = 0; i < MAX_SAMPLES_PER_ROUTE + 8; i += 1) record({ method: 'GET', route: '/api/v1/employees/1', status: 200, durationMs: i, timestamp: now });
  const result = summarize({ minutes: 15, now });
  assert.equal(result.routes[0].count, 512);
  assert.equal(result.routes[0].p50, 263);
  assert.equal(result.routes[0].p95, 494);
  assert.equal(result.routes[0].max, 519);
});

test('registry separates 2xx, 4xx and 5xx samples while errorRate counts 5xx', () => {
  const now = Date.now();
  record({ method: 'GET', route: '/secure', status: 200, durationMs: 10, timestamp: now });
  record({ method: 'GET', route: '/secure', status: 401, durationMs: 20, timestamp: now });
  record({ method: 'GET', route: '/secure', status: 403, durationMs: 30, timestamp: now });
  record({ method: 'GET', route: '/secure', status: 500, durationMs: 40, timestamp: now });
  assert.deepEqual(summarize({ minutes: 15, now }).routes[0], {
    route: 'GET /secure', count: 4, errorRate: 0.25, p50: 20, p95: 40, max: 40
  });
});

test('latency middleware records 401 and 403 response statuses without request data', async () => {
  const app = express();
  app.use(latencyMiddleware);
  app.get('/private/:id', (req, res) => res.status(req.params.id === '401' ? 401 : 403).json({ querySecret: req.query.secret }));
  const now = Date.now();
  await request(app).get('/private/401?secret=QUERY_SECRET');
  await request(app).get('/private/403?secret=QUERY_SECRET').send({ bodySecret: 'BODY_SECRET' });
  const result = summarize({ minutes: 15, now: Date.now() });
  assert.equal(result.routes[0].count, 2);
  assert.match(result.routes[0].route, /^GET \/private\/:id$/);
  assert.ok(!JSON.stringify(result).includes('QUERY_SECRET'));
  assert.ok(!JSON.stringify(result).includes('BODY_SECRET'));
});

test('telemetry endpoint is ADMIN-only and validates minutes', async () => {
  const now = Date.now();
  record({ method: 'POST', route: '/api/v1/private/123', status: 500, durationMs: 80, timestamp: now });
  const admin = await request(endpointApp('ADMIN')).get('/api/v1/admin/telemetry/latency?minutes=15&limit=50');
  assert.equal(admin.status, 200);
  assert.deepEqual(Object.keys(admin.body), ['window', 'routes']);
  assert.equal(admin.body.routes[0].route, 'POST /api/v1/private/:id');
  assert.equal(admin.body.routes[0].p95, 80);
  assert.equal(JSON.stringify(admin.body).includes('QUERY_SECRET'), false);
  for (const role of ['MANAGER', 'SUPERVISOR', 'VIEWER']) {
    assert.equal((await request(endpointApp(role)).get('/api/v1/admin/telemetry/latency')).status, 403);
  }
  assert.equal((await request(endpointApp(null)).get('/api/v1/admin/telemetry/latency')).status, 401);
  assert.equal((await request(endpointApp('ADMIN')).get('/api/v1/admin/telemetry/latency?minutes=0')).status, 400);
  assert.equal((await request(endpointApp('ADMIN')).get('/api/v1/admin/telemetry/latency?minutes=121')).status, 400);
});

test('telemetry excludes routes without samples in the requested window', () => {
  const now = Date.now();
  record({ method: 'GET', route: '/old', status: 200, durationMs: 1, timestamp: now - 16 * 60 * 1000 });
  assert.deepEqual(summarize({ minutes: 15, now }).routes, []);
});
