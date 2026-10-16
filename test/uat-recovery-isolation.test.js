'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Module = require('node:module');
const { verifyRuntimeIsolation } = require('../e2e/uat-v3/database-isolation');
const { verifyTrust, verifyHostedGovernance, paths } = require('../scripts/ci/verify-uat-v3-trust');
const { parseAndNormalize, targetFingerprint } = require('../src/utils/database-target-identity');
const { verifyPreviewDatabaseTarget } = require('../src/services/runtime-database-target-guard.service');
const synthetic = { VERCEL_ENV: 'preview', DATABASE_URL: 'postgresql://synthetic:synthetic@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres', DIRECT_URL: 'postgresql://synthetic:synthetic@db.synthetic-project.supabase.co:5432/postgres' };
// Provider identities are synthetic; no network or credentials are used.
synthetic.DATABASE_URL = synthetic.DATABASE_URL.replace('synthetic:synthetic@aws-', 'synthetic.synthetic-project:synthetic@aws-');
const fingerprint = parseAndNormalize(synthetic).fingerprint;
const previewFingerprint = targetFingerprint({ provider: 'supabase', projectRef: 'ezxanpfagitckpfsnflp', database: 'postgres' });
const target = { authorized: true, database_isolation_verified: true, database_target_fingerprint: previewFingerprint, production_database_target_fingerprint: 'c'.repeat(64), preview_database_cluster_fingerprint_sha256: 'a'.repeat(64), production_database_cluster_fingerprint_sha256: 'b'.repeat(64), preview_runtime_principal: 'postgres' };
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

function loadPrismaWithRuntimeEnv(runtimeEnv) {
  const modulePath = require.resolve('../src/config/prisma');
  const cachedModule = require.cache[modulePath];
  const keys = ['VERCEL_ENV', 'DATABASE_URL', 'DIRECT_URL', 'APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT', 'NODE_ENV'];
  const previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalLoad = Module._load;
  let constructorCount = 0;
  class StubPrismaClient {
    constructor(options) { constructorCount++; this.options = options; }
    $on() {}
  }

  try {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(runtimeEnv, key)) process.env[key] = runtimeEnv[key];
      else delete process.env[key];
    }
    delete require.cache[modulePath];
    Module._load = function loadWithStub(request, parent, isMain) {
      if (request === '@prisma/client') return { PrismaClient: StubPrismaClient };
      return originalLoad.call(this, request, parent, isMain);
    };
    let client;
    let error;
    try { client = require(modulePath); } catch (caught) { error = caught; }
    return { client, error, constructorCount };
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
    if (cachedModule) require.cache[modulePath] = cachedModule;
    for (const key of keys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
}

test('Prisma runtime blocks Preview without a matching fingerprint before client creation and leaves Production unchanged', () => {
  const missing = { ...synthetic };
  delete missing.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT;
  const missingResult = loadPrismaWithRuntimeEnv(missing);
  assert.equal(missingResult.error?.code, 'PREVIEW_DATABASE_TARGET_GUARD_FAILED');
  assert.equal(missingResult.constructorCount, 0);

  const wrongResult = loadPrismaWithRuntimeEnv({ ...synthetic, APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'b'.repeat(64) });
  assert.equal(wrongResult.error?.code, 'PREVIEW_DATABASE_TARGET_GUARD_FAILED');
  assert.equal(wrongResult.constructorCount, 0);

  const approvedResult = loadPrismaWithRuntimeEnv({ ...synthetic, APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: fingerprint });
  assert.equal(approvedResult.error, undefined);
  assert.equal(approvedResult.constructorCount, 1);

  const productionResult = loadPrismaWithRuntimeEnv({ ...synthetic, VERCEL_ENV: 'production' });
  assert.equal(productionResult.error, undefined);
  assert.equal(productionResult.constructorCount, 1);
});

test('signed runtime receipt binds exact deployment, Preview DB cluster and independent Production witness', () => {
  const expected = {
    host: 'sms-v3-staging-fixture-godzillazz.vercel.app',
    nonce: 'f'.repeat(32), sha: 'c'.repeat(40),
    deploymentId: 'dpl_Fixture123',
    ref: 'fix/serverless-database-reliability',
    issuedAt: 1792000000000
  };
  const receipt = {
    contract: 'sms-v3-preview-isolation/v3',
    nonce: expected.nonce,
    deploymentId: expected.deploymentId,
    applicationSha: expected.sha,
    vercelProjectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
    gitCommitRef: expected.ref,
    signedChallengeIdentity: {
      host: expected.host, deploymentId: expected.deploymentId,
      applicationSha: expected.sha, nonce: expected.nonce,
      issuedAt: expected.issuedAt, signatureVerified: true
    },
    database: {
      configuredDatabaseProjectRef: 'ezxanpfagitckpfsnflp',
      configuredDirectProjectRef: 'ezxanpfagitckpfsnflp',
      configuredDatabaseName: 'postgres', observedDatabaseName: 'postgres',
      runtimePrincipal: 'postgres', runtimeClusterFingerprintSha256: 'a'.repeat(64),
      targetGuardMatched: true,
      databaseReadOnlyQuerySucceeded: true, transactionReadOnly: true, runtimeWitnessVerified: true
    },
    storage: {
      configuredEndpointProjectRef: 'ezxanpfagitckpfsnflp',
      bucket: 'license-documents-g05-preview',
      privateBucketMetadataReadSucceeded: true, bucketIsPrivate: true
    }
  };
  assert.equal(verifyRuntimeIsolation(target, receipt, expected).productionDistinct, true);
  assert.throws(() => verifyRuntimeIsolation({ ...target, authorized: false }, receipt, expected));
  assert.throws(() => verifyRuntimeIsolation(target, { ...receipt, nonce: '0'.repeat(32) }, expected));
  assert.throws(() => verifyRuntimeIsolation(target, { ...receipt, applicationSha: '0'.repeat(40) }, expected));
  assert.throws(() => verifyRuntimeIsolation(target, { ...receipt, signedChallengeIdentity: { ...receipt.signedChallengeIdentity, signatureVerified: false } }, expected));
  assert.throws(() => verifyRuntimeIsolation(target, { ...receipt, database: { ...receipt.database, runtimeClusterFingerprintSha256: 'd'.repeat(64) } }, expected));
  assert.throws(() => verifyRuntimeIsolation({ ...target, database_target_fingerprint: 'd'.repeat(64) }, receipt, expected));
  assert.throws(() => verifyRuntimeIsolation(target, { ...receipt, database: { ...receipt.database, logicalTargetFingerprint: previewFingerprint } }, expected));
  assert.throws(() => verifyRuntimeIsolation(target, { ...receipt, database: { ...receipt.database, transactionReadOnly: false } }, expected));
  assert.throws(() => verifyRuntimeIsolation(target, { ...receipt, storage: { ...receipt.storage, bucketIsPrivate: false } }, expected));
  assert.throws(() => verifyRuntimeIsolation({ ...target, production_database_cluster_fingerprint_sha256: 'a'.repeat(64) }, receipt, expected));
  assert.throws(() => verifyRuntimeIsolation(target, { ...receipt, secret: 'synthetic-never-expose' }, expected));
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
  assert.equal(config.authorized, true); assert.equal(config.database_isolation_verified, true);
  assert.equal(config.database_isolation_evidence, 'https://github.com/godzillazzz/SMS-v3/actions/runs/38833567905');
  assert.equal(config.source_sha, 'ffba53f90b1787a071657c21ee162609c8f80254');
  assert.equal(config.deployment_id, 'dpl_G7yzbgCE1457aV6zgft47hS99BNf');
});
