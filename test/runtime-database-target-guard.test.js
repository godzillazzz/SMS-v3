'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAndNormalize } = require('../src/utils/database-target-identity');
const deploymentTargetVerifier = require('../scripts/ci/verify-deployment-target');
const {
  PREVIEW_DATABASE_TARGET_GUARD_ERROR,
  verifyPreviewDatabaseTarget,
} = require('../src/services/runtime-database-target-guard.service');

const DATABASE_URL = 'postgresql://postgres.previewproject123:test-secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres';
const DIRECT_URL = 'postgresql://postgres:test-secret@db.previewproject123.supabase.co:5432/postgres';
const fingerprint = parseAndNormalize({ DATABASE_URL, DIRECT_URL }).fingerprint;

test('Preview runtime database target guard accepts the exact approved logical target', () => {
  const result = verifyPreviewDatabaseTarget({
    VERCEL_ENV: 'preview',
    DATABASE_URL,
    DIRECT_URL,
    APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint,
  });
  assert.deepEqual(result, { required: true, matched: true });
});

test('Preview runtime database target guard fails closed on missing, mismatched, or malformed authority without leaking target details', () => {
  for (const env of [
    { VERCEL_ENV: 'preview', DATABASE_URL, DIRECT_URL },
    {
      VERCEL_ENV: 'preview',
      DATABASE_URL,
      DIRECT_URL,
      APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'f'.repeat(64),
    },
    {
      VERCEL_ENV: 'preview',
      DATABASE_URL: 'postgresql://private-user:private-password@private.example.com:5432/postgres',
      DIRECT_URL,
      APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint,
    },
  ]) {
    assert.throws(
      () => verifyPreviewDatabaseTarget(env),
      (error) => {
        assert.equal(error.code, PREVIEW_DATABASE_TARGET_GUARD_ERROR);
        assert.equal(error.message, 'Preview database target guard failed.');
        const serialized = JSON.stringify({ name: error.name, code: error.code, message: error.message });
        assert.equal(serialized.includes('previewproject123'), false);
        assert.equal(serialized.includes('test-secret'), false);
        assert.equal(serialized.includes('private-password'), false);
        assert.equal(serialized.includes('private.example.com'), false);
        return true;
      }
    );
  }
});

test('Production and non-Preview runtime behavior does not require the Preview target guard', () => {
  assert.deepEqual(verifyPreviewDatabaseTarget({ VERCEL_ENV: 'production' }), { required: false, matched: null });
  assert.deepEqual(verifyPreviewDatabaseTarget({ NODE_ENV: 'test' }), { required: false, matched: null });
});


test('Preview runtime fingerprint algorithm stays aligned with the existing deployment-target verifier', () => {
  const runtimeFingerprint = parseAndNormalize({ DATABASE_URL, DIRECT_URL }).fingerprint;
  const deploymentFingerprint = deploymentTargetVerifier.targetFingerprint(
    deploymentTargetVerifier.parseTarget('DATABASE_URL', DATABASE_URL),
    deploymentTargetVerifier.parseTarget('DIRECT_URL', DIRECT_URL)
  );
  assert.equal(runtimeFingerprint, deploymentFingerprint);
});
