'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyConnectivityOutput,
  classifyTargetValues,
  redactDiagnosticText
} = require('../scripts/ci/production-database-diagnostic');

const transactionUrl = (project = 'projectref') => `postgresql://postgres.${project}@aws-1-us-east-1.pooler.supabase.com:6543/postgres`;
const sessionUrl = (project = 'projectref') => `postgresql://db-user.${project}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`;
const directUrl = (project = 'projectref') => `postgresql://postgres@db.${project}.supabase.co:5432/postgres`;

test('classifies transaction pooler 6543 without exposing identity', () => {
  const result = classifyTargetValues({ DATABASE_URL: transactionUrl(), DIRECT_URL: sessionUrl() });
  assert.equal(result.databaseUrl.mode, 'transaction-pooler');
  assert.equal(result.databaseUrl.port, '6543');
  assert.equal(result.directUrl.mode, 'verified-supabase-session');
  assert.equal(result.directUrl.port, '5432');
  assert.equal(result.logicalPairMatch, 'true');
  assert.doesNotMatch(JSON.stringify(result), /projectref|aws-1-us-east-1|db\.projectref/);
});

test('classifies direct 5432 and matching session pair', () => {
  const result = classifyTargetValues({ DATABASE_URL: directUrl(), DIRECT_URL: sessionUrl() });
  assert.equal(result.databaseUrl.mode, 'direct');
  assert.equal(result.databaseUrl.port, '5432');
  assert.equal(result.logicalPairMatch, 'true');
});

test('detects logical pair mismatch and malformed URL', () => {
  assert.equal(classifyTargetValues({ DATABASE_URL: transactionUrl('one'), DIRECT_URL: sessionUrl('two') }).logicalPairMatch, 'false');
  const malformed = classifyTargetValues({ DATABASE_URL: 'not-a-url', DIRECT_URL: sessionUrl() });
  assert.equal(malformed.databaseUrl.mode, 'unknown');
  assert.equal(malformed.logicalPairMatch, 'unknown');
});

test('redacts secrets and connection data', () => {
  const token = ['unit', 'token'].join('-');
  const raw = `Bearer ${token} postgresql://user:pass@db.example.test:6543/postgres?token=${token}`;
  const safe = redactDiagnosticText(raw, [token]);
  assert.doesNotMatch(safe, new RegExp(token));
  assert.doesNotMatch(safe, /postgresql|db\.example|pass|6543/);
});

test('classifies Prisma connectivity failures', () => {
  assert.equal(classifyConnectivityOutput('P1001 cannot reach database', 1).classification, 'CONNECTION_ERROR');
  assert.equal(classifyConnectivityOutput('P1002 timed out', 1).classification, 'TIMEOUT');
  assert.equal(classifyConnectivityOutput('P2024 connection pool timeout', 1).classification, 'POOL_EXHAUSTED');
  assert.equal(classifyConnectivityOutput('P1012 invalid datasource', 1).classification, 'CONFIG_ERROR');
  assert.equal(classifyConnectivityOutput('', 1).classification, 'UNKNOWN');
});
