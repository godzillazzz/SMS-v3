'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { verifyRuntimeIsolation } = require('../e2e/uat-v3/database-isolation');
const { verifyTrust, verifyHostedGovernance, paths } = require('../scripts/ci/verify-uat-v3-trust');
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
test('configured hashes and readiness cannot replace independently verified runtime receipt', async () => {
  const ready = { status: 'ready', database: 'ok' };
  await assert.rejects(() => verifyRuntimeIsolation({ authorized: false }, {}, ready), /UAT_DISPOSABLE_TARGET_NOT_AUTHORIZED/);
  await assert.rejects(() => verifyRuntimeIsolation({ authorized: true, database_isolation_verified: true }, {}, ready, { env: {} }), /UAT_RUNTIME_RECEIPT_REQUIRED/);
  await assert.rejects(() => verifyRuntimeIsolation({}, {}, { status: 'not_ready' }), /UAT_RUNTIME_DATABASE_READINESS_FAILED/);
});
test('trusted-main guard denies unprotected/moved main and altered target runtime source', async () => {
  // Main is the control plane; source bytes below are a synthetic hash-check fixture.
  const contents = Object.fromEntries(paths.map(path => [path, Buffer.from('synthetic source for ' + path)]));
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

test('fresh challenge reuses existing receipt verifier and rejects missing provider evidence', async () => {
  const target = {
    authorized: true, database_isolation_verified: true,
    url: 'https://sms-v3-staging-123456789-godzillazz.vercel.app',
    deployment_id: 'dpl_Synthetic', source_sha: 'a'.repeat(40), source_branch: 'fix/serverless-database-reliability',
    approved_runtime_principal: 'synthetic_role',
    approved_preview_cluster_fingerprint_sha256: 'a'.repeat(64), approved_production_cluster_fingerprint_sha256: 'b'.repeat(64),
    approved_production_database_ref: 'x'.repeat(20), approved_production_storage_ref: 'y'.repeat(20)
  };
  const deployment = { id: target.deployment_id, url: new URL(target.url).host, meta: { githubCommitSha: target.source_sha, githubCommitRef: target.source_branch } };
  const env = { RUNTIME_ISOLATION_PROBE_HMAC_SECRET: 'synthetic-hmac-only-'.repeat(3), VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-bypass' };
  async function fetcher(url, options) {
    const u = new URL(url), q = u.searchParams;
    assert.equal(u.origin, target.url); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.match(options.headers['x-smsv3-probe-signature'], /^v1=[a-f0-9]{64}$/);
    return { status: 200, json: async () => ({
      contract: 'sms-v3-preview-isolation/v3', nonce: q.get('nonce'), deploymentId: target.deployment_id,
      applicationSha: target.source_sha, vercelProjectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s', gitCommitRef: target.source_branch,
      signedChallengeIdentity: { host: u.host, deploymentId: target.deployment_id, applicationSha: target.source_sha, nonce: q.get('nonce'), issuedAt: Number(q.get('issuedAt')), signatureVerified: true },
      database: { configuredDatabaseProjectRef: 'ezxanpfagitckpfsnflp', configuredDirectProjectRef: 'ezxanpfagitckpfsnflp', configuredDatabaseName: 'postgres', observedDatabaseName: 'postgres', runtimePrincipal: 'synthetic_role', runtimeClusterFingerprintSha256: 'a'.repeat(64), targetGuardMatched: true, databaseReadOnlyQuerySucceeded: true, transactionReadOnly: true, runtimeWitnessVerified: true },
      storage: { configuredEndpointProjectRef: 'ezxanpfagitckpfsnflp', bucket: 'license-documents-g05-preview', privateBucketMetadataReadSucceeded: true, bucketIsPrivate: true }
    }) };
  }
  const ready = { status: 'ready', database: 'ok' };
  assert.equal((await verifyRuntimeIsolation(target, deployment, ready, { fetcher, env })).productionSeparation, 'PASS');
  for (const key of ['approved_runtime_principal', 'approved_preview_cluster_fingerprint_sha256', 'approved_production_cluster_fingerprint_sha256', 'approved_production_database_ref', 'approved_production_storage_ref']) {
    const missing = { ...target }; delete missing[key];
    await assert.rejects(() => verifyRuntimeIsolation(missing, deployment, ready, { fetcher, env }));
  }
  await assert.rejects(() => verifyRuntimeIsolation(target, deployment, ready, { env, fetcher: async () => ({ status: 200, json: async () => ({}) }) }));
});
