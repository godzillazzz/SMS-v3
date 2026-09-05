'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  contract,
  main,
  normalizePreviewOrigin,
  validateContractDefinition,
  validateEnvironment,
  verifyDatabaseTarget,
} = require('../scripts/ci/verify-environment-contract');

const validDb = 'postgresql://runtime:runtime@db.preview-example.supabase.co:5432/postgres?sslmode=require';
const validDirect = 'postgresql://runtime:runtime@db.preview-example.supabase.co:5432/postgres?sslmode=require';
const validPreviewEnv = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'preview',
  DATABASE_URL: validDb,
  DIRECT_URL: validDirect,
  JWT_SECRET: 'preview-secret-with-at-least-thirty-two-characters',
  CORS_ORIGIN: 'https://sms-v3-staging-ten.vercel.app',
  VERCEL_URL: 'sms-v3-staging-preview.vercel.app',
  RUN_MIGRATIONS: 'false',
};
const validProductionEnv = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  DATABASE_URL: 'postgresql://runtime:runtime@db.production-example.supabase.co:5432/postgres?sslmode=require',
  DIRECT_URL: 'postgresql://runtime:runtime@db.production-example.supabase.co:5432/postgres?sslmode=require',
  JWT_SECRET: 'production-secret-with-at-least-thirty-two-characters',
  CORS_ORIGIN: 'https://sms-v3-staging-ten.vercel.app',
  SUPABASE_URL: 'https://storage.example.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-key',
  LICENSE_DOCUMENTS_BUCKET: 'private-license-documents',
  EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'employee-reference-photos',
  APPROVED_DATABASE_TARGET_FINGERPRINT: '1'.repeat(64),
  RUN_MIGRATIONS: 'false',
};

test('contract definition is complete and contains no credential material', () => {
  assert.doesNotThrow(() => validateContractDefinition());
  assert.equal(contract.project.name, 'sms-v3-staging');
  assert.ok(contract.sourceValidatedKeys.includes('FACE_MATCH_SIMILARITY_THRESHOLD'));
  assert.doesNotMatch(JSON.stringify(contract), /postgres(?:ql)?:\/\/[^\s"']+@/i);
  assert.doesNotMatch(JSON.stringify(contract), /-----BEGIN .*PRIVATE KEY-----/i);
});

test('Production rejects wildcard and non-canonical Vercel CORS origins', () => {
  for (const cors of ['*', 'https://sms-v3-staging-preview.vercel.app']) {
    assert.throws(() => validateEnvironment({ environment: 'production', env: { ...validProductionEnv, CORS_ORIGIN: cors } }), /CORS_ORIGIN/);
  }
});

test('Preview allows validated own Vercel URL and branch URL without a wildcard', () => {
  const env = { ...validPreviewEnv, VERCEL_BRANCH_URL: 'sms-v3-staging-feature.vercel.app' };
  assert.doesNotThrow(() => normalizePreviewOrigin(env.VERCEL_URL));
  assert.doesNotThrow(() => normalizePreviewOrigin(env.VERCEL_BRANCH_URL));
  assert.doesNotThrow(() => validateEnvironment({ environment: 'preview', env, requirePreviewFingerprint: false }));
});

test('Preview rejects malformed or non-Vercel own origins', () => {
  for (const value of ['preview.example.com', 'https://preview.vercel.app/path', 'https://preview.vercel.app?secret=1']) {
    assert.throws(() => normalizePreviewOrigin(value), /preview origin|Vercel|valid origin/i);
  }
});

test('Production does not auto-allow an immutable Vercel hostname', () => {
  assert.throws(() => validateEnvironment({
    environment: 'production',
    env: { ...validProductionEnv, CORS_ORIGIN: 'https://sms-v3-staging-ten.vercel.app,https://sms-v3-staging-immutable.vercel.app' },
  }), /non-canonical Vercel/);
});

test('unbranched Preview has no branch override requirement', () => {
  const env = { ...validPreviewEnv };
  delete env.VERCEL_URL;
  delete env.VERCEL_BRANCH_URL;
  const result = validateEnvironment({ environment: 'preview', env });
  assert.equal(result.branchOverrideRequired, false);
});

test('missing database variables fail closed without exposing a URL', () => {
  const errors = [];
  const status = main(['--environment=preview'], {
    env: { ...validPreviewEnv, DATABASE_URL: undefined },
    error: (message) => errors.push(message),
    log: () => {},
  });
  assert.equal(status, 1);
  assert.match(errors[0], /DATABASE_URL/);
  assert.doesNotMatch(errors.join('\n'), /postgres(?:ql)?:\/\//i);
});

test('Preview fingerprint guard rejects a Production fingerprint match', () => {
  const fingerprint = verifyDatabaseTarget('preview', validPreviewEnv).fingerprint;
  assert.throws(() => validateEnvironment({
    environment: 'preview',
    env: { ...validPreviewEnv, APPROVED_DATABASE_TARGET_FINGERPRINT: fingerprint },
  }), /must not equal the Production target fingerprint/);
});

test('required Preview fingerprint is enforced only when the release gate requests it', () => {
  const env = { ...validPreviewEnv };
  delete env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT;
  assert.doesNotThrow(() => validateEnvironment({ environment: 'preview', env }));
  assert.throws(() => validateEnvironment({ environment: 'preview', env, requirePreviewFingerprint: true }), /APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT/);
});

test('migration policy is explicit and Preview cannot migrate', () => {
  assert.throws(() => validateEnvironment({ environment: 'preview', env: { ...validPreviewEnv, RUN_MIGRATIONS: 'true' } }), /forbids migrations/);
  const env = { ...validProductionEnv, RUN_MIGRATIONS: undefined, APPROVED_DATABASE_TARGET_FINGERPRINT: undefined };
  assert.throws(() => validateEnvironment({ environment: 'production', env }), /RUN_MIGRATIONS/);
});

test('diagnostics never print secret-like values', () => {
  const output = [];
  const status = main(['--environment=preview'], {
    env: validPreviewEnv,
    log: (message) => output.push(message),
    error: (message) => { throw new Error(message); },
  });
  assert.equal(status, 0);
  const text = output.join('\n');
  assert.doesNotMatch(text, /runtime:runtime|preview-secret|postgres(?:ql)?:\/\//i);
  assert.match(text, /DATABASE_TARGET_FINGERPRINT=[0-9a-f]{64}/i);
});

test('contract-only CLI mode works without deployment secrets', () => {
  const output = [];
  assert.equal(main(['--contract-only'], { env: {}, log: (line) => output.push(line), error: (line) => { throw new Error(line); } }), 0);
  assert.match(output.join('\n'), /ENVIRONMENT_CONTRACT_DEFINITION=PASS/);
});

test('contract path is repository-relative and stable', () => {
  assert.equal(path.basename(require.resolve('../config/environment-contract.json')), 'environment-contract.json');
});
