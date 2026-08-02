const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateFingerprint,
  normalizeLogicalTarget,
  parseTarget,
  targetFingerprint,
  verifyDeploymentTarget
} = require('../scripts/ci/verify-deployment-target');

const databaseUrl = 'postgresql://postgres.project-ref@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require';
const directUrl = 'postgresql://postgres:placeholder@db.project-ref.supabase.co:5432/postgres?sslmode=require';
const sessionUrl = 'postgresql://postgres.project-ref:placeholder@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
const approvedFingerprint = targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', directUrl));

function runWith(overrides = {}) {
  const logs = [];
  const errors = [];
  const status = verifyDeploymentTarget({
    env: { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl, APPROVED_DATABASE_TARGET_FINGERPRINT: approvedFingerprint, NODE_ENV: 'production', ...overrides },
    log: (message) => logs.push(message),
    error: (message) => errors.push(message)
  });
  return { status, logs, errors };
}

function runGenerate(overrides = {}) {
  const logs = [];
  const errors = [];
  const status = generateFingerprint({
    env: { DATABASE_URL: databaseUrl, DIRECT_URL: directUrl, ...overrides },
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

test('malformed DATABASE_URL and DIRECT_URL fail', () => {
  assert.match(runWith({ DATABASE_URL: 'not-a-url' }).errors[0], /DATABASE_URL is malformed/);
  assert.match(runWith({ DIRECT_URL: 'not-a-url' }).errors[0], /DIRECT_URL is malformed/);
});

test('local, development, and isolated test databases fail', () => {
  for (const value of ['postgresql://x:y@127.0.0.1:5432/postgres', 'postgresql://x:y@db.project-ref.supabase.co:5432/sms_v3_test', 'postgresql://x:y@db.project-ref.supabase.co:5432/sms_v3_dev']) {
    const result = runWith({ DIRECT_URL: value });
    assert.equal(result.status, 1);
  }
});

test('transaction pooler DIRECT_URL fails closed', () => {
  const result = runWith({ DIRECT_URL: 'postgresql://postgres:placeholder@db.project-ref.supabase.co:6543/postgres' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /pooled PostgreSQL connection/);
});

test('session pooler DIRECT_URL fails closed', () => {
  const result = runWith({ DIRECT_URL: sessionUrl, APPROVED_DATABASE_TARGET_FINGERPRINT: targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', sessionUrl)) });
  assert.equal(result.status, 0);
  assert.match(result.logs.join('\n'), /DIRECT_MODE=verified-supabase-session/);
});

test('pgbouncer query DIRECT_URL fails closed', () => {
  const result = runWith({ DIRECT_URL: 'postgresql://postgres:placeholder@db.project-ref.supabase.co:5432/postgres?pgbouncer=true' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /pooled PostgreSQL connection/);
});

test('pooler hostname DIRECT_URL fails closed', () => {
  const result = runWith({ DIRECT_URL: 'postgresql://postgres.project-ref@pooler.example.com:5432/postgres' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /mode could not be verified/);
});

test('unknown DIRECT_URL mode fails closed', () => {
  const result = runWith({ DIRECT_URL: 'postgresql://postgres:placeholder@database.example.com:5432/postgres' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /mode could not be verified as direct or verified Supabase session/);
});

test('verified direct URL passes with pooled DATABASE_URL', () => {
  const result = runWith();
  assert.equal(result.status, 0);
  assert.match(result.logs.join('\n'), /DATABASE_MODE=verified-supabase-session/);
  assert.match(result.logs.join('\n'), /DIRECT_MODE=direct/);
  assert.match(result.logs.join('\n'), /TARGET_FINGERPRINT_MATCH=true/);
  assert.doesNotMatch(result.logs.join('\n'), /placeholder|supabase\.co|postgresql:\/\//i);
});

test('direct DATABASE_URL is allowed when direct target is verified', () => {
  const runtime = 'postgresql://postgres:placeholder@db.project-ref.supabase.co:5432/postgres';
  const result = runWith({ DATABASE_URL: runtime, APPROVED_DATABASE_TARGET_FINGERPRINT: targetFingerprint(parseTarget('DATABASE_URL', runtime), parseTarget('DIRECT_URL', directUrl)) });
  assert.equal(result.status, 0);
  assert.match(result.logs.join('\n'), /DATABASE_MODE=direct/);
});

test('logical project mismatch fails', () => {
  const result = runWith({ DIRECT_URL: 'postgresql://postgres:placeholder@db.other-project.supabase.co:5432/postgres' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /project identities differ/);
});

test('database mismatch fails even when project identity matches', () => {
  const result = runWith({ DIRECT_URL: 'postgresql://postgres.project-ref:placeholder@aws-0-region.pooler.supabase.com:5432/other_database' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /database identities differ/);
});

test('missing Supabase session project identity fails closed', () => {
  const result = runWith({ DIRECT_URL: 'postgresql://postgres:placeholder@aws-0-region.pooler.supabase.com:5432/postgres' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /project identity could not be verified/);
});

test('transaction mode query signals fail closed for session targets', () => {
  for (const query of ['pool_mode=transaction', 'mode=transaction']) {
    const result = runWith({ DIRECT_URL: `${sessionUrl}&${query}` });
    assert.equal(result.status, 1);
    assert.match(result.errors[0], /pooled PostgreSQL connection/);
  }
});

test('different provider identity fails closed', () => {
  assert.throws(() => normalizeLogicalTarget(
    { provider: 'supabase', mode: 'pooled', database: 'postgres', projectRef: 'project-ref', hostname: 'pooler.example', port: '5432' },
    { provider: 'postgresql', mode: 'direct', database: 'postgres', hostname: 'db.example', port: '5432' }
  ), /provider identities differ/);
});

test('fingerprint is deterministic and normalized across pooled/direct endpoints', () => {
  const first = targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', directUrl));
  const second = targetFingerprint(parseTarget('DATABASE_URL', 'postgresql://postgres.project-ref@aws-0-another-region.pooler.supabase.com:6543/postgres'), parseTarget('DIRECT_URL', 'postgresql://postgres:other@db.project-ref.supabase.co:5432/postgres'));
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('direct and verified Supabase session fingerprints are equal', () => {
  const directFingerprint = targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', directUrl));
  const sessionFingerprint = targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', sessionUrl));
  assert.equal(directFingerprint, sessionFingerprint);
});

test('bootstrap generator outputs only safe status and fingerprint fields', () => {
  const result = runGenerate();
  assert.equal(result.status, 0);
  const output = result.logs.join('\n');
  assert.match(output, /DATABASE_URL_PRESENT=true/);
  assert.match(output, /DIRECT_URL_PRESENT=true/);
  assert.match(output, /DATABASE_CONNECTION_MODE=verified-supabase-session/);
  assert.match(output, /DIRECT_CONNECTION_MODE=direct/);
  assert.match(output, /TARGET_PAIR_MATCH=true/);
  assert.match(output, /APPROVED_DATABASE_TARGET_FINGERPRINT=[a-f0-9]{64}/);
  assert.doesNotMatch(output, /postgresql:\/\/|placeholder|supabase\.co|project-ref/i);
});

test('bootstrap generator rejects pooled DIRECT_URL without exposing details', () => {
  const result = runGenerate({ DIRECT_URL: 'postgresql://postgres.project-ref@aws-0-region.pooler.supabase.com:6543/postgres' });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /pooled PostgreSQL connection/);
  assert.doesNotMatch(result.errors.join('\n'), /postgresql:\/\/|project-ref|placeholder/i);
});

test('bootstrap generator accepts a verified Supabase session migration URL', () => {
  const result = runGenerate({ DIRECT_URL: sessionUrl });
  assert.equal(result.status, 0);
  assert.match(result.logs.join('\n'), /DIRECT_CONNECTION_MODE=verified-supabase-session/);
  assert.doesNotMatch(result.logs.join('\n'), /postgresql:\/\/|pooler\.supabase\.com|placeholder/i);
});

test('mismatched approved fingerprint fails', () => {
  const result = runWith({ APPROVED_DATABASE_TARGET_FINGERPRINT: '0'.repeat(64) });
  assert.equal(result.status, 1);
  assert.match(result.errors[0], /fingerprint mismatch/);
});
