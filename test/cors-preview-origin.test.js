const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

function readCorsOrigins(overrides = {}, unset = []) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://test:test@db.example.com:5432/smsv3_preview',
    JWT_SECRET: 'test-secret-with-at-least-thirty-two-chars',
    RATE_LIMIT_HASH_SECRET: 'test-rate-limit-secret-with-at-least-thirty-two-chars',
    ...overrides
  };
  for (const key of unset) delete env[key];
  const script = "process.stdout.write(JSON.stringify(require('./src/config/env').corsOrigins))";
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: process.cwd(), env }).toString());
}

test('Preview CORS includes immutable deployment and stable branch Vercel origins without wildcard', () => {
  const origins = readCorsOrigins({
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'sms-v3-staging-abc123-godzillazz.vercel.app',
    VERCEL_BRANCH_URL: 'sms-v3-staging-git-feature-g06-attendance-con-fe61ac-godzillazz.vercel.app'
  }, ['CORS_ORIGIN']);
  assert.ok(origins.includes('https://sms-v3-staging-abc123-godzillazz.vercel.app'));
  assert.ok(origins.includes('https://sms-v3-staging-git-feature-g06-attendance-con-fe61ac-godzillazz.vercel.app'));
  assert.ok(origins.includes('https://sms-v3-staging-ten.vercel.app'));
  assert.ok(!origins.includes('*'));
});

test('Preview CORS preserves explicit origins and unions exact Vercel origins', () => {
  const origins = readCorsOrigins({
    CORS_ORIGIN: 'https://staging.example.test',
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'sms-v3-staging-preview.vercel.app',
    VERCEL_BRANCH_URL: 'sms-v3-staging-git-safe-branch.vercel.app'
  });
  assert.deepEqual(origins, [
    'https://staging.example.test',
    'https://sms-v3-staging-preview.vercel.app',
    'https://sms-v3-staging-git-safe-branch.vercel.app'
  ]);
});

test('Production does not auto-allow Vercel branch aliases', () => {
  const origins = readCorsOrigins({
    CORS_ORIGIN: 'https://sms-v3-staging-ten.vercel.app',
    VERCEL_ENV: 'production',
    VERCEL_URL: 'sms-v3-staging-production.vercel.app',
    VERCEL_BRANCH_URL: 'sms-v3-staging-git-feature-g06.vercel.app'
  });
  assert.deepEqual(origins, ['https://sms-v3-staging-ten.vercel.app']);
});

test('Preview ignores non-Vercel values from Vercel URL variables', () => {
  const origins = readCorsOrigins({
    CORS_ORIGIN: 'https://staging.example.test',
    VERCEL_ENV: 'preview',
    VERCEL_URL: 'evil.example.com',
    VERCEL_BRANCH_URL: 'https://evil.example.com/path'
  });
  assert.deepEqual(origins, ['https://staging.example.test']);
});
