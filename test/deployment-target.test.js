const test = require('node:test');
const assert = require('node:assert/strict');
const { generateFingerprint, parseTarget, targetFingerprint, verifyDeploymentTarget } = require('../scripts/ci/verify-deployment-target');

const databaseUrl = 'postgresql://postgres.project-ref@aws-0-region.pooler.supabase.com:6543/postgres';
const directUrl = 'postgresql://postgres:placeholder@db.project-ref.supabase.co:5432/postgres';
const approvedFingerprint = targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', directUrl));

function run(overrides = {}) {
  const logs = [];
  const errors = [];
  const status = verifyDeploymentTarget({ env: { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl, APPROVED_DATABASE_TARGET_FINGERPRINT: approvedFingerprint, ...overrides }, log: (value) => logs.push(value), error: (value) => errors.push(value) });
  return { status, logs, errors };
}

test('valid approved target passes without exposing connection data', () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.match(result.logs.join('\n'), /TARGET_FINGERPRINT_MATCH=true/);
  assert.doesNotMatch(result.logs.join('\n'), /postgresql|project-ref|placeholder|supabase\.co/i);
});

test('missing and malformed targets fail closed', () => {
  assert.equal(run({ DATABASE_URL: undefined }).status, 1);
  assert.match(run({ DIRECT_URL: 'not-a-url' }).errors[0], /DIRECT_URL is malformed/);
});

test('transaction pooler DIRECT_URL is rejected', () => {
  const result = run({ DIRECT_URL: databaseUrl });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /pooled PostgreSQL connection/);
});

test('logical identity mismatch is rejected', () => {
  const result = run({ DIRECT_URL: 'postgresql://postgres:placeholder@db.other-project.supabase.co:5432/postgres' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /project identities differ/);
});

test('fingerprint is normalized across pooled and direct endpoints', () => {
  const sessionUrl = 'postgresql://postgres.project-ref:placeholder@aws-0-region.pooler.supabase.com:5432/postgres';
  assert.equal(targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', directUrl)), targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', sessionUrl)));
  const output = [];
  assert.equal(generateFingerprint({ env: { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl }, log: (value) => output.push(value), error: () => {} }), 0);
  assert.match(output.join('\n'), /APPROVED_DATABASE_TARGET_FINGERPRINT=[a-f0-9]{64}/);
});
