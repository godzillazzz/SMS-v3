process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  MAX_HTTP_SAMPLES,
  recordHttpRequest,
  snapshotRuntimeTelemetry,
  resetRuntimeTelemetryForTest
} = require('../src/services/runtime-telemetry.service');
const {
  applicationIdentity,
  getSystemHealth
} = require('../src/services/system-health.service');
const { createRequestLogger } = require('../src/middlewares/request-logger');
const { EventEmitter } = require('node:events');

test.beforeEach(() => {
  resetRuntimeTelemetryForTest({ startedAt: new Date('2026-08-30T00:00:00.000Z') });
});

test('PERF-08 runtime telemetry reports bounded p50/p95 and error counts without request identity', () => {
  const samples = [
    { route: '/api/v1/dashboard', method: 'GET', status: 200, durationMs: 100, timestamp: '2026-08-30T00:00:01.000Z' },
    { route: '/api/v1/dashboard', method: 'GET', status: 200, durationMs: 200, timestamp: '2026-08-30T00:00:02.000Z' },
    { route: '/api/v1/leave-requests', method: 'GET', status: 500, durationMs: 300, timestamp: '2026-08-30T00:00:03.000Z' },
    { route: '/api/v1/leave-requests', method: 'GET', status: 404, durationMs: 400, timestamp: '2026-08-30T00:00:04.000Z' }
  ];
  samples.forEach(recordHttpRequest);

  const snapshot = snapshotRuntimeTelemetry();
  assert.equal(snapshot.scope, 'CURRENT_RUNTIME_INSTANCE');
  assert.equal(snapshot.requestCount, 4);
  assert.equal(snapshot.serverErrorCount, 1);
  assert.equal(snapshot.clientErrorCount, 1);
  assert.equal(snapshot.serverErrorRatePct, 25);
  assert.equal(snapshot.p50Ms, 200);
  assert.equal(snapshot.p95Ms, 400);
  assert.equal(snapshot.maxMs, 400);
  assert.equal(snapshot.slowRoutes[0].route, '/api/v1/leave-requests');
  assert.equal(JSON.stringify(snapshot).includes('requestId'), false);
  assert.equal(JSON.stringify(snapshot).includes('email'), false);
});

test('PERF-08 telemetry keeps only the latest bounded sample window', () => {
  for (let index = 0; index < MAX_HTTP_SAMPLES + 5; index += 1) {
    recordHttpRequest({
      route: '/api/v1/health',
      method: 'GET',
      status: 200,
      durationMs: index,
      timestamp: new Date(Date.UTC(2026, 7, 30, 0, 0, index))
    });
  }
  const snapshot = snapshotRuntimeTelemetry();
  assert.equal(snapshot.retainedSamples, MAX_HTTP_SAMPLES);
  assert.equal(snapshot.droppedSamples, 5);
  assert.equal(snapshot.requestCount, MAX_HTTP_SAMPLES);
  assert.equal(snapshot.p50Ms >= 5, true);
});

test('PERF-08 request logger feeds only safe route template performance fields to telemetry recorder', () => {
  const records = [];
  const logged = [];
  const logger = { info: (_event, fields) => logged.push(fields) };
  const times = [0n, 1_250_000n];
  const middleware = createRequestLogger(logger, () => times.shift(), (sample) => records.push(sample));
  const req = {
    requestId: 'private-request-id-not-for-telemetry',
    method: 'GET',
    baseUrl: '/api/v1',
    route: { path: '/employees/:id' },
    originalUrl: '/api/v1/employees/secret?email=private@example.invalid'
  };
  const res = new EventEmitter();
  res.statusCode = 200;
  middleware(req, res, () => {});
  res.emit('finish');

  assert.equal(logged[0].requestId, 'private-request-id-not-for-telemetry');
  assert.deepEqual(records, [{
    route: '/api/v1/employees/:id',
    method: 'GET',
    status: 200,
    durationMs: 1.25
  }]);
  assert.equal(JSON.stringify(records).includes('private-request-id'), false);
  assert.equal(JSON.stringify(records).includes('private@example.invalid'), false);
});

test('PERF-08 telemetry recorder failure cannot break request completion logging', () => {
  const logged = [];
  const logger = { info: (_event, fields) => logged.push(fields) };
  const times = [0n, 750_000n];
  const middleware = createRequestLogger(logger, () => times.shift(), () => { throw new Error('telemetry failure'); });
  const req = { requestId: 'safe-id', method: 'GET', baseUrl: '/api/v1', route: { path: '/health' } };
  const res = new EventEmitter();
  res.statusCode = 200;
  middleware(req, res, () => {});
  assert.doesNotThrow(() => res.emit('finish'));
  assert.equal(logged.length, 1);
  assert.equal(logged[0].durationMs, 0.75);
});

test('PERF-08 system health returns read-only DB readiness and safe application identity', async () => {
  recordHttpRequest({ route: '/api/v1/dashboard', method: 'GET', status: 200, durationMs: 125 });
  const timers = [10, 18.25];
  const result = await getSystemHealth({
    prismaClient: { $queryRaw: async () => [{ '?column?': 1 }] },
    environment: {
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_SHA: 'b3dd12a4f0abd75e2d2bf36f6b0354de27d3b4ad',
      VERCEL_URL: 'sms-v3-staging-example.vercel.app',
      DATABASE_URL: 'postgresql://must-not-leak'
    },
    timer: () => timers.shift(),
    clock: () => new Date('2026-08-30T15:00:00.000Z')
  });

  assert.equal(result.data.overallStatus, 'ready');
  assert.deepEqual(result.data.database, { status: 'ok', latencyMs: 8.25 });
  assert.equal(result.data.application.commitSha, 'b3dd12a4f0abd75e2d2bf36f6b0354de27d3b4ad');
  assert.equal(result.data.application.deploymentHost, 'sms-v3-staging-example.vercel.app');
  assert.equal(result.data.scope.globalMetrics, false);
  assert.equal(result.data.scope.kind, 'CURRENT_RUNTIME_INSTANCE');
  assert.equal(JSON.stringify(result).includes('DATABASE_URL'), false);
  assert.equal(JSON.stringify(result).includes('postgresql://'), false);
});

test('PERF-08 system health degrades safely when database readiness fails', async () => {
  const timers = [20, 27];
  const result = await getSystemHealth({
    prismaClient: { $queryRaw: async () => { throw new Error('postgresql://private-host/secret'); } },
    environment: { NODE_ENV: 'test' },
    timer: () => timers.shift(),
    clock: () => new Date('2026-08-30T15:00:00.000Z')
  });
  assert.equal(result.data.overallStatus, 'degraded');
  assert.equal(result.data.database.status, 'unavailable');
  assert.equal(result.data.database.latencyMs, 7);
  assert.equal(result.data.warnings.some((warning) => warning.code === 'DATABASE_NOT_READY'), true);
  assert.equal(JSON.stringify(result).includes('private-host'), false);
});

test('PERF-08 application identity fails closed on malformed system metadata', () => {
  assert.deepEqual(applicationIdentity({
    VERCEL_ENV: 'production',
    VERCEL_GIT_COMMIT_SHA: 'not-a-sha',
    VERCEL_URL: 'https://bad host/?token=secret'
  }), {
    environment: 'production',
    commitSha: null,
    deploymentHost: null
  });
});

test('PERF-08 route is GET-only, authenticated and ADMIN-only', () => {
  const route = fs.readFileSync('src/routes/system-health.routes.js', 'utf8');
  const index = fs.readFileSync('src/routes/index.js', 'utf8');
  assert.match(route, /router\.get\('\/', authenticate, authorize\('ADMIN'\)/);
  assert.doesNotMatch(route, /router\.(post|put|patch|delete)\(/);
  assert.match(index, /router\.use\('\/admin\/system-health', systemHealthRoutes\)/);
});
