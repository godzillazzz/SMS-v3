process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/prisma');

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
  try {
    prisma.$queryRaw = async () => [{ one: 1 }];
    const healthy = await request(app).get('/api/v1/ready');
    assert.equal(healthy.status, 200);
    assert.equal(healthy.body.status, 'ready');
    assert.equal(healthy.body.requestId, healthy.headers['x-request-id']);
    prisma.$queryRaw = async () => { throw new Error('private database connection text'); };
    const failed = await request(app).get('/api/v1/ready');
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { error: 'Database unavailable.', requestId: failed.headers['x-request-id'] });
    assert.equal(JSON.stringify(failed.body).includes('private database'), false);
    assert.equal(JSON.stringify(failed.body).includes('stack'), false);
  } finally { prisma.$queryRaw = original; }
});
