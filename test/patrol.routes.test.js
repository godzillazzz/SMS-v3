'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/smsv3_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createPatrolRoutes } = require('../src/routes/patrol.routes');
const { assertPatrolKey, patrolBucket, selectPatrolStorage } = require('../src/services/patrol-storage.service');

function app(user, service) {
  const router = createPatrolRoutes({
    service,
    authenticateMiddleware: (req, _res, next) => { req.user = user; next(); },
    authorizeMiddleware: (...roles) => (req, _res, next) => roles.includes(req.user.role) ? next() : next(Object.assign(new Error('forbidden'), { statusCode: 403 }))
  });
  const server = express();
  server.use(express.json());
  server.use('/api/v1/patrol', router);
  server.use((error, _req, res, _next) => res.status(error.statusCode || (error.name === 'ZodError' ? 400 : 500)).json({ error: error.message, code: error.details?.code }));
  return server;
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64)]);

test('scan endpoint passes multipart photo and fields to the service; replay returns 200', async () => {
  const calls = [];
  const service = { recordScan: async (input) => { calls.push(input); return { id: 's1', replayed: calls.length > 1 }; } };
  const server = app({ sub: 'u', role: 'VIEWER', employeeAuthority: { id: 'e' } }, service);
  const clientScanId = crypto.randomUUID();
  const first = await request(server).post('/api/v1/patrol/scans').field('qrPayload', 'SMSPATROL1:abc').field('clientScanId', clientScanId).field('latitude', '13.7').attach('photo', JPEG, { filename: 'cp.jpg', contentType: 'image/jpeg' });
  assert.equal(first.status, 201);
  assert.equal(calls[0].input.clientScanId, clientScanId);
  assert.equal(calls[0].input.latitude, '13.7');
  assert.ok(Buffer.isBuffer(calls[0].photo.buffer));
  const replay = await request(server).post('/api/v1/patrol/scans').field('qrPayload', 'SMSPATROL1:abc').field('clientScanId', clientScanId).attach('photo', JPEG, { filename: 'cp.jpg', contentType: 'image/jpeg' });
  assert.equal(replay.status, 200);
  const bad = await request(server).post('/api/v1/patrol/scans').field('qrPayload', 'x').field('clientScanId', 'not-a-uuid');
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 2);
});

test('checkpoint management is ADMIN-only and reports exclude VIEWER', async () => {
  const service = { createCheckpoint: async () => ({ id: 'c' }), report: async () => ({ ok: true }), listCheckpoints: async () => [] };
  const viewer = app({ sub: 'v', role: 'VIEWER' }, service);
  assert.equal((await request(viewer).post('/api/v1/patrol/checkpoints').send({ code: 'A', name: 'B', department: 'C' })).status, 403);
  assert.equal((await request(viewer).get('/api/v1/patrol/report?from=2026-10-01&to=2026-10-30')).status, 403);
  const supervisor = app({ sub: 's', role: 'SUPERVISOR' }, service);
  assert.equal((await request(supervisor).post('/api/v1/patrol/checkpoints').send({ code: 'A', name: 'B', department: 'C' })).status, 403);
  const report = await request(supervisor).get('/api/v1/patrol/report?from=2026-10-01&to=2026-10-30');
  assert.equal(report.status, 200);
  assert.equal(report.headers['cache-control'], 'no-store');
  const adminServer = app({ sub: 'a', role: 'ADMIN' }, service);
  assert.equal((await request(adminServer).post('/api/v1/patrol/checkpoints').send({ code: 'A', name: 'B', department: 'C' })).status, 201);
  assert.equal((await request(adminServer).post('/api/v1/patrol/checkpoints').send({ code: 'A', name: 'B', department: 'C', extra: 1 })).status, 400);
});

test('photo endpoint streams bytes with private no-store headers', async () => {
  const service = { photo: async () => ({ bytes: JPEG, mimeType: 'image/jpeg' }) };
  const response = await request(app({ sub: 'm', role: 'MANAGER' }, service)).get(`/api/v1/patrol/scans/${crypto.randomUUID()}/photo`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'image/jpeg');
  assert.equal(response.headers['cache-control'], 'private, no-store');
});

test('patrol storage keys are confined to the patrol-scan prefix and fall back to an existing private bucket', () => {
  assert.equal(assertPatrolKey(`patrol-scan/2026-10/${crypto.randomUUID()}.jpg`).startsWith('patrol-scan/'), true);
  for (const key of ['attendance-selfie/x/y', '../patrol-scan/2026-10/a.jpg', 'patrol-scan/2026-10/../../x.jpg']) assert.throws(() => assertPatrolKey(key));
  assert.equal(patrolBucket({ ATTENDANCE_DEVICE_SELFIE_BUCKET: 'selfies' }), 'selfies');
  assert.equal(patrolBucket({ PATROL_PHOTOS_BUCKET: 'patrol', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'selfies' }), 'patrol');
  assert.throws(() => patrolBucket({}), (error) => error.details.code === 'PATROL_STORAGE_NOT_CONFIGURED');
  assert.throws(() => selectPatrolStorage({ environment: { STORAGE_PROVIDER: 's3', NODE_ENV: 'production', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'b' } }), (error) => error.details.code === 'S3_PRODUCTION_NOT_APPROVED');
});

test('patrol router is mounted under /api/v1/patrol', () => {
  const index = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/routes/index.js'), 'utf8');
  assert.match(index, /router\.use\('\/patrol', createPatrolRoutes\(\)\)/);
});

test('progress endpoint is available to any authenticated scanner, forwards department and is not cached', async () => {
  const calls = [];
  const service = { progress: async (input) => { calls.push(input); return { round: 3 }; } };
  const server = app({ sub: 'v', role: 'VIEWER', employeeAuthority: { id: 'e' } }, service);
  const response = await request(server).get('/api/v1/patrol/progress?department=ANO');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body.data, { round: 3 });
  assert.equal(calls[0].department, 'ANO');
  assert.equal((await request(server).get(`/api/v1/patrol/progress?department=${'x'.repeat(101)}`)).status, 400);
});
