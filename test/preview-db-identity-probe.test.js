const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const prisma = require('../src/config/prisma');
const app = require('../src/app');

const path = '/api/v1/internal/preview-db-identity';
const previewRef = 'ezxanpfagitckpfsnflp';
const productionRef = 'jkexwnlxnxbemwavsebv';

async function withProbeEnv(values, fn) {
  const keys = ['VERCEL_ENV', 'DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
  }
  try { return await fn(); } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function installQueryStub(database = 'postgres') {
  const original = prisma.$queryRaw;
  let calls = 0;
  prisma.$queryRaw = async (strings, ...values) => {
    calls += 1;
    assert.deepEqual(Array.from(strings), ['SELECT current_database() AS database']);
    assert.deepEqual(values, []);
    return [{ database }];
  };
  return { restore: () => { prisma.$queryRaw = original; }, calls: () => calls };
}

test('preview probe matches expected Supabase project from pooler DATABASE_URL and direct DIRECT_URL', async () => {
  const stub = installQueryStub();
  try {
    await withProbeEnv({
      VERCEL_ENV: 'preview',
      DATABASE_URL: `postgresql://postgres.${previewRef}:fake-password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
      DIRECT_URL: `postgresql://postgres:fake-password@db.${previewRef}.supabase.co:5432/postgres`,
      JWT_SECRET: 'secret-jwt-sentinel'
    }, async () => {
      const response = await request(app).get(path).query({ sql: 'DELETE FROM users' }).expect(200);
      assert.deepEqual(response.body, {
        databaseUrlProjectMatchesExpectedPreview: true,
        directUrlProjectMatchesExpectedPreview: true,
        databaseUrlMatchesProductionProject: false,
        directUrlMatchesProductionProject: false,
        databaseName: 'postgres'
      });
      assert.equal(stub.calls(), 1);
      const body = JSON.stringify(response.body);
      assert.doesNotMatch(body, new RegExp(previewRef, 'i'));
      assert.doesNotMatch(body, new RegExp(productionRef, 'i'));
      assert.doesNotMatch(body, /fake-password|DATABASE_URL|DIRECT_URL|JWT_SECRET|supabase\.co|pooler/i);
    });
  } finally { stub.restore(); }
});

test('preview probe detects Production Supabase project without returning its raw ref', async () => {
  const stub = installQueryStub();
  try {
    await withProbeEnv({
      VERCEL_ENV: 'preview',
      DATABASE_URL: `postgresql://postgres.${productionRef}:fake-password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`,
      DIRECT_URL: `postgresql://postgres:fake-password@db.${productionRef}.supabase.co:5432/postgres`
    }, async () => {
      const response = await request(app).get(path).expect(200);
      assert.equal(response.body.databaseUrlProjectMatchesExpectedPreview, false);
      assert.equal(response.body.directUrlProjectMatchesExpectedPreview, false);
      assert.equal(response.body.databaseUrlMatchesProductionProject, true);
      assert.equal(response.body.directUrlMatchesProductionProject, true);
      assert.equal(response.body.databaseName, 'postgres');
      assert.doesNotMatch(JSON.stringify(response.body), new RegExp(productionRef, 'i'));
    });
  } finally { stub.restore(); }
});

test('preview probe fails closed for unrecognized URL shapes', async () => {
  const stub = installQueryStub();
  try {
    await withProbeEnv({ VERCEL_ENV: 'preview', DATABASE_URL: 'not-a-url', DIRECT_URL: 'postgresql://postgres:fake@other.example/postgres' }, async () => {
      const response = await request(app).get(path).expect(200);
      assert.deepEqual(response.body, {
        databaseUrlProjectMatchesExpectedPreview: false,
        directUrlProjectMatchesExpectedPreview: false,
        databaseUrlMatchesProductionProject: false,
        directUrlMatchesProductionProject: false,
        databaseName: 'postgres'
      });
    });
  } finally { stub.restore(); }
});

test('preview probe is unavailable in production and performs no database query', async () => {
  const original = prisma.$queryRaw;
  let called = false;
  prisma.$queryRaw = async () => { called = true; return [{ database: 'postgres' }]; };
  try {
    await withProbeEnv({ VERCEL_ENV: 'production' }, async () => {
      const response = await request(app).get(path).expect(404);
      assert.equal(response.body?.databaseName, undefined);
      assert.equal(called, false);
    });
  } finally { prisma.$queryRaw = original; }
});