const test = require('node:test');
const assert = require('node:assert/strict');
const { targetFingerprint, verifyDeploymentTarget } = require('../scripts/ci/verify-deployment-target');

const databaseUrl = 'postgresql://runtime:placeholder@aws-0-example.pooler.supabase.com:5432/postgres?sslmode=require';
const directUrl = 'postgresql://migration:placeholder@db.example.supabase.co:5432/postgres?sslmode=require';

function runWith(overrides = {}) {
  const logs = [];
  const errors = [];
  const status = verifyDeploymentTarget({
    env: { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl, APPROVED_DATABASE_TARGET_FINGERPRINT: targetFingerprint(require('../scripts/ci/verify-deployment-target').parseTarget('DATABASE_URL', databaseUrl), require('../scripts/ci/verify-deployment-target').parseTarget('DIRECT_URL', directUrl)), ...overrides },
    log: (message) => logs.push(message),
    error: (message) => errors.push(message)
  });
  return { status, logs, errors };
}

test('missing DATABASE_URL fails without revealing connection details', () => {
  const result = runWith({ DATABASE_URL: undefined });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /DATABASE_URL is missing/);
  assert.doesNotMatch(result.errors.join('\n'), /placeholder|supabase\.co|postgresql:\/\//i);
});

test('missing DIRECT_URL fails', () => {
  const result = runWith({ DIRECT_URL: undefined });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /DIRECT_URL is missing/);
});

test('local and isolated test databases fail', () => {
  for (const value of ['postgresql://x:y@127.0.0.1:5432/sms_v3_test', 'postgresql://x:y@db.example.supabase.co:5432/sms_v3_dev']) {
    const result = runWith({ DATABASE_URL: value });
    assert.equal(result.status, 1);
  }
});

test('malformed URL fails', () => {
  const result = runWith({ DIRECT_URL: 'not-a-url' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /DIRECT_URL is malformed/);
});

test('approved pooled/direct target passes', () => {
  const result = runWith();
  assert.equal(result.status, 0);
  assert.match(result.logs.join('\n'), /TARGET_FINGERPRINT_MATCH=true/);
  assert.doesNotMatch(result.logs.join('\n'), /placeholder|supabase\.co|postgresql:\/\//i);
});

test('mismatched approved fingerprint fails', () => {
  const result = runWith({ APPROVED_DATABASE_TARGET_FINGERPRINT: '0'.repeat(64) });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /fingerprint mismatch/);
});
