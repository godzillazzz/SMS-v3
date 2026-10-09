'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { verifyRuntimeIsolation } = require('../e2e/uat-v3/database-isolation');
const { verifyTrust, verifyHostedGovernance, paths } = require('../scripts/ci/verify-uat-v3-trust');
const { parseAndNormalize } = require('../src/utils/database-target-identity');
const { verifyPreviewDatabaseTarget } = require('../src/services/runtime-database-target-guard.service');
const synthetic = { VERCEL_ENV: 'preview', DATABASE_URL: 'postgresql://synthetic:synthetic@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres', DIRECT_URL: 'postgresql://synthetic:synthetic@db.synthetic-project.supabase.co:5432/postgres' };
// Provider identities are synthetic; no network or credentials are used.
synthetic.DATABASE_URL = synthetic.DATABASE_URL.replace('synthetic:synthetic@aws-', 'synthetic.synthetic-project:synthetic@aws-');
const fingerprint = parseAndNormalize(synthetic).fingerprint;
const target = { database_target_fingerprint: fingerprint, production_database_target_fingerprint: 'c'.repeat(64) };
const ready = { status: 'ready', database: 'ok' };
const rules = [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: { required_approving_review_count: 0 } }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'validate', integration_id: 15368 }] } }];
const hostedEnvironment = { name: 'Hosted UAT', can_admins_bypass: false, protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'godzillazzz' } }] }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
const policies = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
test('Solo-Owner governance accepts zero PR approvals while requiring validate and normal Owner Environment approval', () => {
  assert.equal(verifyHostedGovernance(rules, hostedEnvironment, policies).hostedEnvironmentProtection, 'PASS');
  for (const type of ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks']) assert.throws(() => verifyHostedGovernance(rules.filter(rule => rule.type !== type), hostedEnvironment, policies));
  assert.throws(() => verifyHostedGovernance(rules.map(rule => rule.type === 'required_status_checks' ? { ...rule, parameters: { required_status_checks: [{ context: 'validate', integration_id: 1 }] } } : rule), hostedEnvironment, policies));
});
test('Hosted governance denies missing reviewers, admin bypass, Production environment and non-main or tag policies', () => {
  for (const patch of [{ can_admins_bypass: true }, { name: 'production-sms-v3-staging' }, { protection_rules: [] }, { deployment_branch_policy: null }]) assert.throws(() => verifyHostedGovernance(rules, { ...hostedEnvironment, ...patch }, policies));
  for (const policy of [{ total_count: 0, branch_policies: [] }, { total_count: 2, branch_policies: [...policies.branch_policies, { name: '*', type: 'branch' }] }, { total_count: 1, branch_policies: [{ name: 'main', type: 'tag' }] }]) assert.throws(() => verifyHostedGovernance(rules, hostedEnvironment, policy));
});
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
    if (url.endsWith('rules/branches/main')) return { status: 200, json: async () => rules };
    if (url.endsWith('/branches/main')) return { status: 200, json: async () => main };
    if (url.includes('/deployment-branch-policies?')) return { status: 200, json: async () => policies };
    if (url.endsWith('environments/Hosted%20UAT')) return { status: 200, json: async () => hostedEnvironment };
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
