'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validate,
  validateMetadata,
} = require('../scripts/ci/verify-preview-control-plane');

const cwd = path.resolve(__dirname, '..');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd, encoding: 'utf8' }).trim();
const previewFingerprint = 'a'.repeat(64);
const productionFingerprint = 'b'.repeat(64);

function metadata(overrides = {}) {
  const types = {
    DATABASE_URL: 'sensitive',
    DIRECT_URL: 'sensitive',
    JWT_SECRET: 'sensitive',
    CORS_ORIGIN: 'encrypted',
    APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'encrypted',
    ...overrides,
  };
  return {
    envs: Object.entries(types).map(([key, type]) => ({
      key,
      type,
      target: ['preview'],
      configurationId: null,
    })),
  };
}

function envText(fingerprint = previewFingerprint) {
  return [
    'DATABASE_URL="[SENSITIVE]"',
    'DIRECT_URL="[SENSITIVE]"',
    'JWT_SECRET="[SENSITIVE]"',
    'CORS_ORIGIN="https://sms-v3-staging-ten.vercel.app"',
    `APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT="${fingerprint}"`,
    '',
  ].join('\n');
}

function withFiles(t, env = envText(), meta = metadata()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-preview-control-plane-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, '.env.preview.local');
  const metadataFile = path.join(dir, 'preview-env-metadata.json');
  fs.writeFileSync(envFile, env, 'utf8');
  fs.writeFileSync(metadataFile, JSON.stringify(meta), 'utf8');
  return { envFile, metadataFile };
}

test('Preview control-plane preflight validates metadata and non-secret guards while deferring sensitive DB identity to runtime readiness', (t) => {
  const files = withFiles(t);
  const result = validate({
    ...files,
    sourceSha,
    sourceTree,
    cwd,
    productionFingerprint,
    runMigrations: 'false',
  });
  assert.equal(result.sourceVerified, true);
  assert.equal(result.databaseRuntimeValidation, 'DEFERRED_TO_PREVIEW_READINESS');
  assert.equal(result.corsCount, 1);
});

test('Preview control-plane metadata keeps DB credentials sensitive and guard variables readable', () => {
  assert.doesNotThrow(() => validateMetadata(metadata()));
  assert.throws(() => validateMetadata(metadata({ DATABASE_URL: 'encrypted' })), /DATABASE_URL must remain Vercel Sensitive/);
  assert.throws(
    () => validateMetadata(metadata({ APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'sensitive' })),
    /must be readable non-sensitive configuration/
  );
});

test('Preview control-plane preflight fails closed for missing or invalid fingerprint and Production target reuse', (t) => {
  {
    const files = withFiles(t, envText('not-a-fingerprint'));
    assert.throws(
      () => validate({ ...files, sourceSha, sourceTree, cwd, productionFingerprint, runMigrations: 'false' }),
      /must be a SHA-256 fingerprint/
    );
  }
  {
    const files = withFiles(t, envText(productionFingerprint));
    assert.throws(
      () => validate({ ...files, sourceSha, sourceTree, cwd, productionFingerprint, runMigrations: 'false' }),
      /must not equal Production/
    );
  }
  {
    const files = withFiles(t);
    assert.throws(
      () => validate({ ...files, sourceSha, sourceTree, cwd, productionFingerprint, runMigrations: 'true' }),
      /forbids migrations/
    );
  }
});
