process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/config/prisma');

test('Supabase Session Pooler keeps port 5432 and receives conservative serverless pool settings', () => {
  const result = new URL(prisma.configuredDatabaseUrl('postgresql://user:pass@sample.pooler.supabase.com:5432/postgres?sslmode=require'));
  assert.equal(result.port, '5432');
  assert.equal(result.searchParams.get('sslmode'), 'require');
  assert.equal(result.searchParams.get('pgbouncer'), 'true');
  assert.equal(result.searchParams.get('connection_limit'), '1');
  assert.equal(result.searchParams.get('pool_timeout'), '15');
  assert.equal(result.searchParams.get('connect_timeout'), '15');
});
