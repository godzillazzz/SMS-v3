process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/config/prisma');

test('Supabase Session Pooler keeps port 5432 and uses bounded serverless pool floor 2', () => {
  const result = new URL(prisma.configuredDatabaseUrl('postgresql://user:pass@sample.pooler.supabase.com:5432/postgres?sslmode=require'));
  assert.equal(result.port, '5432');
  assert.equal(result.searchParams.get('sslmode'), 'require');
  assert.equal(result.searchParams.get('pgbouncer'), 'true');
  assert.equal(result.searchParams.get('connection_limit'), '2');
  assert.equal(result.searchParams.get('pool_timeout'), '15');
  assert.equal(result.searchParams.get('connect_timeout'), '15');
});

test('Supabase Transaction Pooler keeps port 6543 and uses bounded serverless pool floor 2', () => {
  const result = new URL(prisma.configuredDatabaseUrl('postgresql://user:pass@sample.pooler.supabase.com:6543/postgres?sslmode=require'));
  assert.equal(result.port, '6543');
  assert.equal(result.searchParams.get('sslmode'), 'require');
  assert.equal(result.searchParams.get('pgbouncer'), 'true');
  assert.equal(result.searchParams.get('connection_limit'), '2');
  assert.equal(result.searchParams.get('pool_timeout'), '15');
  assert.equal(result.searchParams.get('connect_timeout'), '15');
});

test('Supabase Pooler raises an explicit connection_limit=1 to the bounded floor 2', () => {
  const result = new URL(prisma.configuredDatabaseUrl('postgresql://user:pass@sample.pooler.supabase.com:6543/postgres?connection_limit=1&pool_timeout=15'));
  assert.equal(result.searchParams.get('connection_limit'), '2');
  assert.equal(result.searchParams.get('pool_timeout'), '15');
});

test('Supabase Pooler preserves an explicitly larger connection limit', () => {
  const result = new URL(prisma.configuredDatabaseUrl('postgresql://user:pass@sample.pooler.supabase.com:6543/postgres?connection_limit=3'));
  assert.equal(result.searchParams.get('connection_limit'), '3');
});

test('non-Supabase database URLs are not rewritten with pool settings', () => {
  const result = new URL(prisma.configuredDatabaseUrl('postgresql://user:pass@example.test:5432/postgres?sslmode=require'));
  assert.equal(result.searchParams.get('sslmode'), 'require');
  assert.equal(result.searchParams.has('connection_limit'), false);
  assert.equal(result.searchParams.has('pool_timeout'), false);
  assert.equal(result.searchParams.has('pgbouncer'), false);
});
