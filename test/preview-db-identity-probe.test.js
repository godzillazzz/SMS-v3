const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

const path = '/api/v1/internal/preview-db-identity';

async function withProbeEnv(value, fn) {
  const previous = process.env.VERCEL_ENV;
  if (value === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = value;
  try { return await fn(); } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
}

test('preview database identity probe is available only in Vercel Preview and uses one hard-coded query', async () => {
  const original = prisma.$queryRaw;
  let calls = 0;
  prisma.$queryRaw = async (strings, ...values) => {
    calls += 1;
    assert.deepEqual(Array.from(strings), ['SELECT current_database() AS database']);
    assert.deepEqual(values, []);
    return [{ database: 'sms-v3-preview' }];
  };
  try {
    await withProbeEnv('preview', async () => {
      const response = await request(app).get(path).query({ sql: 'DELETE FROM users' }).expect(200);
      assert.deepEqual(response.body, { database: 'sms-v3-preview' });
      assert.equal(calls, 1);
    });
  } finally { prisma.$queryRaw = original; }
});

test('preview database identity probe is unavailable in production', async () => {
  const original = prisma.$queryRaw;
  let called = false;
  prisma.$queryRaw = async () => { called = true; return [{ database: 'should-not-run' }]; };
  try {
    await withProbeEnv('production', async () => {
      const response = await request(app).get(path).expect(404);
      assert.equal(response.body?.database, undefined);
      assert.equal(called, false);
    });
  } finally { prisma.$queryRaw = original; }
});

test('preview database identity response cannot expose environment secrets', async () => {
  const originalQuery = prisma.$queryRaw;
  const oldDb = process.env.DATABASE_URL;
  const oldDirect = process.env.DIRECT_URL;
  const oldJwt = process.env.JWT_SECRET;
  process.env.DATABASE_URL = 'secret-database-url-sentinel';
  process.env.DIRECT_URL = 'secret-direct-url-sentinel';
  process.env.JWT_SECRET = 'secret-jwt-sentinel';
  prisma.$queryRaw = async () => [{ database: 'sms-v3-preview' }];
  try {
    await withProbeEnv('preview', async () => {
      const response = await request(app).get(path).expect(200);
      const body = JSON.stringify(response.body);
      assert.deepEqual(response.body, { database: 'sms-v3-preview' });
      assert.doesNotMatch(body, /secret-|DATABASE_URL|DIRECT_URL|JWT_SECRET|postgres/i);
    });
  } finally {
    prisma.$queryRaw = originalQuery;
    if (oldDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDb;
    if (oldDirect === undefined) delete process.env.DIRECT_URL; else process.env.DIRECT_URL = oldDirect;
    if (oldJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldJwt;
  }
});
