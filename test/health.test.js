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
    assert.equal(healthy.body.requestId, healthy.headers['x-request-id']);
    logger.error = (event, fields) => records.push({ event, fields: sanitize(fields) });
    prisma.$queryRaw = async () => { throw Object.assign(new Error('private database connection text'), { code: 'P1001' }); };
    const failed = await request(app).get('/api/v1/ready');
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { status: 'not_ready', database: 'unavailable', requestId: failed.headers['x-request-id'] });
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
