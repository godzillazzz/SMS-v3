'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { verifyRuntimeIsolation } = require('../e2e/uat-v3/database-isolation');
const { verifyTrust, paths } = require('../scripts/ci/verify-uat-v3-trust');
const { parseAndNormalize } = require('../src/utils/database-target-identity');
const { verifyPreviewDatabaseTarget } = require('../src/services/runtime-database-target-guard.service');
const synthetic = { VERCEL_ENV: 'preview', DATABASE_URL: 'postgresql://synthetic:synthetic@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres', DIRECT_URL: 'postgresql://synthetic:synthetic@db.synthetic-project.supabase.co:5432/postgres' };
// Provider identities are synthetic; no network or credentials are used.
synthetic.DATABASE_URL = synthetic.DATABASE_URL.replace('synthetic:synthetic@aws-', 'synthetic.synthetic-project:synthetic@aws-');
const fingerprint = parseAndNormalize(synthetic).fingerprint;
const target = { database_target_fingerprint: fingerprint, production_database_target_fingerprint: 'c'.repeat(64) };
const ready = { status: 'ready', database: 'ok' };
test('actual runtime guard computes logical target and rejects a format-valid wrong hash', () => {
  assert.throws(() => verifyPreviewDatabaseTarget({ ...synthetic, APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'b'.repeat(64) }));
  assert.deepEqual(verifyPreviewDatabaseTarget({ ...synthetic, APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint }), { required: true, matched: true });
  const changed = { ...synthetic, DATABASE_URL: synthetic.DATABASE_URL.replaceAll('synthetic-project', 'other-project'), DIRECT_URL: synthetic.DIRECT_URL.replaceAll('synthetic-project', 'other-project'), APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint };
  assert.throws(() => verifyPreviewDatabaseTarget(changed));
});
test('runtime binding requires actual immutable-deployment fingerprint, Preview runtime, distinct Production and readiness', () => {
  const deployment = { env: { VERCEL_ENV: 'preview', APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint } };
  assert.equal(verifyRuntimeIsolation(target, deployment, ready).approvedFingerprintMatch, true);
  for (const d of [{}, { env: {} }, { env: { VERCEL_ENV: 'production', APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint } }, { env: { VERCEL_ENV: 'preview', APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'b'.repeat(64) } }]) assert.throws(() => verifyRuntimeIsolation(target, d, ready));
  assert.throws(() => verifyRuntimeIsolation({ ...target, production_database_target_fingerprint: fingerprint }, deployment, ready));
  assert.throws(() => verifyRuntimeIsolation(target, deployment, { status: 'not_ready', database: 'unavailable' }));
});
test('trusted-main guard denies unprotected/moved main and altered target runtime source', async () => {
  const contents = Object.fromEntries(paths.map(path => [path, fs.readFileSync(path)]));
  const pins = { runtime_guard_file_sha256: Object.fromEntries(paths.map(path => [path, crypto.createHash('sha256').update(contents[path]).digest('hex')])) };
  const env = { GITHUB_TOKEN: 'synthetic-only', UAT_SOURCE_SHA: 'a'.repeat(40), UAT_TRUSTED_MAIN_SHA: 'b'.repeat(40) };
  function fetcher(main, mutate = false) { return async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.endsWith('branches/main')) return { status: 200, json: async () => main };
    const path = new URL(url).pathname.split('/contents/')[1];
    assert.equal(new URL(url).searchParams.get('ref'), env.UAT_SOURCE_SHA);
    return { status: 200, json: async () => ({ path, type: 'file', encoding: 'base64', content: (mutate ? Buffer.from('altered') : contents[path]).toString('base64') }) };
  }; }
  const main = { protected: true, commit: { sha: env.UAT_TRUSTED_MAIN_SHA } };
  assert.equal((await verifyTrust(fetcher(main), env, pins)).runtimeGuardSource, 'PASS');
  await assert.rejects(() => verifyTrust(fetcher({ ...main, protected: false }), env, pins));
  await assert.rejects(() => verifyTrust(fetcher({ protected: true, commit: { sha: 'c'.repeat(40) } }), env, pins));
  await assert.rejects(() => verifyTrust(fetcher(main, true), env, pins));
});
test('protected actions are immutable and additional trust guard remains before credentials', () => {
  const workflow = fs.readFileSync('.github/workflows/authenticated-uat-v3-readonly.yml', 'utf8');
  for (const match of workflow.matchAll(/uses: (actions\/[\w-]+)@(\S+)/g)) assert.match(match[2], /^[a-f0-9]{40}$/);
  assert.match(workflow.split('  authenticated-readonly:')[0], /verify-uat-v3-trust\.js/);
  assert.doesNotMatch(workflow.split('  authenticated-readonly:')[0], /secrets\./);
  const config = JSON.parse(fs.readFileSync('.github/uat/authenticated-readonly-target.json'));
  assert.equal(config.authorized, false); assert.equal(config.database_isolation_verified, false);
});
