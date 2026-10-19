process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');
const { logger, sanitize } = require('../src/utils/logger');

test('health endpoint reports service status', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
});

test('versioned health response remains lightweight and sanitized', async () => {
  const response = await request(app).get('/api/v1/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
  assert.equal(JSON.stringify(response.body).includes('database'), false);
});

test('readiness success and dependency failure responses are sanitized', async () => {
  const original = prisma.$queryRaw;
  const originalError = logger.error;
  const records = [];
  try {
    prisma.$queryRaw = async () => [{ one: 1 }];
    const healthy = await request(app).get('/api/v1/ready');
    assert.equal(healthy.status, 200);
    assert.equal(healthy.body.status, 'ready');
    assert.equal(healthy.body.database, 'ok');
    assert.equal(healthy.body.features.attendanceSelfieStorage, 'NOT_CONFIGURED');
    assert.equal(healthy.body.requestId, healthy.headers['x-request-id']);
    logger.error = (event, fields) => records.push({ event, fields: sanitize(fields) });
    prisma.$queryRaw = async () => { throw Object.assign(new Error('private database connection text'), { code: 'P1001' }); };
    const failed = await request(app).get('/api/v1/ready');
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { status: 'not_ready', database: 'unavailable', features: { attendanceSelfieStorage: 'NOT_CONFIGURED' }, requestId: failed.headers['x-request-id'] });
    assert.equal(JSON.stringify(failed.body).includes('private database'), false);
    assert.equal(JSON.stringify(failed.body).includes('stack'), false);
    assert.equal(records[0].event, 'readiness_failure');
    assert.equal(records[0].fields.operation, 'readiness_check');
    assert.equal(records[0].fields.errorCode, 'P1001');
    assert.equal(records[0].fields.errorName, 'Error');
    assert.equal(records[0].fields.errorMessage, 'Database readiness check failed.');
    assert.equal(JSON.stringify(records[0]).includes('private database'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(records[0].fields, 'stack'), false);
  } finally {
    prisma.$queryRaw = original;
    logger.error = originalError;
  }
});

test('readiness reports selfie storage readiness without exposing configuration values', async () => {
  const originalQuery = prisma.$queryRaw;
  const original = { ...process.env };
  try {
    prisma.$queryRaw = async () => [{ one: 1 }];
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ATTENDANCE_DEVICE_SELFIE_BUCKET', 'SELFIE_PATH_SECRET']) delete process.env[key];
    const missing = await request(app).get('/api/v1/ready');
    assert.equal(missing.body.features.attendanceSelfieStorage, 'NOT_CONFIGURED');
    process.env.SUPABASE_URL = 'https://storage.example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-value-that-must-not-appear';
    process.env.ATTENDANCE_DEVICE_SELFIE_BUCKET = 'attendance-selfies';
    process.env.SELFIE_PATH_SECRET = 'a-secure-path-secret-with-at-least-32-chars';
    const ready = await request(app).get('/api/v1/ready');
    assert.equal(ready.body.features.attendanceSelfieStorage, 'READY');
    assert.equal(JSON.stringify(ready.body).includes('service-role-value-that-must-not-appear'), false);
    assert.equal(JSON.stringify(ready.body).includes('a-secure-path-secret-with-at-least-32-chars'), false);
  } finally {
    prisma.$queryRaw = originalQuery;
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    for (const [key, value] of Object.entries(original)) process.env[key] = value;
  }
});


test('preview readiness fails closed before a database query when target authority is missing', async () => {
  const originalQuery = prisma.$queryRaw;
  const originalError = logger.error;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalFingerprint = process.env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT;
  const records = [];
  let queryCount = 0;
  try {
    process.env.VERCEL_ENV = 'preview';
    delete process.env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT;
    prisma.$queryRaw = async () => { queryCount += 1; return [{ one: 1 }]; };
    logger.error = (event, fields) => records.push({ event, fields: sanitize(fields) });
    const failed = await request(app).get('/api/v1/ready');
    assert.equal(failed.status, 503);
    assert.equal(queryCount, 0);
    assert.deepEqual(failed.body, { status: 'not_ready', database: 'unavailable', features: { attendanceSelfieStorage: 'NOT_CONFIGURED' }, requestId: failed.headers['x-request-id'] });
    assert.equal(records[0].event, 'readiness_failure');
    assert.equal(records[0].fields.errorCode, 'PREVIEW_DATABASE_TARGET_GUARD_FAILED');
    assert.equal(records[0].fields.errorMessage, 'Preview database target guard failed.');
    assert.equal(records[0].fields.errorCategory, 'environment_validation');
  } finally {
    prisma.$queryRaw = originalQuery;
    logger.error = originalError;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalFingerprint === undefined) delete process.env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT; else process.env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT = originalFingerprint;
  }
});
