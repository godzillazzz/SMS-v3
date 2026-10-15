'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verifyPreview } = require('../scripts/ci/verify-uat-v3-preview');
const { PROJECT_ID, TEAM_ID } = require('../e2e/uat-v3/config');
const workflow = fs.readFileSync('.github/workflows/authenticated-uat-v3-readonly.yml', 'utf8');
test('protected UAT uses trusted main only, owner gate and no PR source checkout', () => {
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.actor == 'godzillazzz'/);
  assert.doesNotMatch(workflow, /pull_request_target|pull_request:|issue_comment:|uat_harness_sha/);
  assert.equal((workflow.match(/ref: \$\{\{ github.sha \}\}/g) || []).length, 2);
  assert.doesNotMatch(workflow, /ref: \$\{\{ inputs\./);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /environment: Hosted UAT/);
  assert.doesNotMatch(workflow, /production-sms-v3-staging/);
  assert.doesNotMatch(workflow.split('  authenticated-readonly:')[0], /secrets\./);
  assert.doesNotMatch(workflow, /permissions:[\s\S]*?write|production_dispatch|deploy-approved|vercel deploy/);
  assert.doesNotMatch(workflow, /run:.*\$\{\{ inputs\./);
  assert.match(workflow, /needs: trusted-target/);
  assert.ok(workflow.includes('UAT_EXPECTED_DEPLOYMENT_ID: ${{ inputs.expected_deployment_id }}'));
  assert.ok(workflow.includes('UAT_SOURCE_SHA: ${{ inputs.source_sha }}'));
  assert.ok(workflow.includes(['permissions:', '  contents: read', '  actions: read', '  deployments: read'].join(String.fromCharCode(10))));
  assert.ok(!workflow.toLowerCase().includes('vercel deploy'));
  assert.match(workflow, /UAT_SUPERVISOR_PASSWORD: \$\{\{ secrets.UAT_SUPERVISOR_PASSWORD \}\}/);
  assert.match(workflow, /success\(\) && steps.uat.outcome == 'success'/);
});
test('reviewed target is disabled, artifact capture is sanitized and no credentials persist', () => {
  const target = JSON.parse(fs.readFileSync('.github/uat/authenticated-readonly-target.json'));
  assert.equal(target.authorized, false); assert.equal(target.database_isolation_verified, false);
  const config = fs.readFileSync('playwright.uat-v3.config.js', 'utf8');
  for (const flag of ['trace', 'screenshot', 'video']) assert.match(config, new RegExp(flag + ": 'off'"));
  assert.doesNotMatch(config, /storageState/);
  assert.match(config, /serviceWorkers: 'block'/);
});
const env = { UAT_BASE_URL: 'https://sms-v3-staging-fixture-godzillazz.vercel.app', VERCEL_TOKEN: 'synthetic-not-real-token', UAT_EXPECTED_DEPLOYMENT_ID: 'dpl_Fixture123', UAT_SOURCE_SHA: 'a'.repeat(40), UAT_SOURCE_BRANCH: 'test/uat-fixture', GITHUB_TOKEN: 'synthetic-github-read-token', VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-bypass', RUNTIME_ISOLATION_PROBE_HMAC_SECRET: 'synthetic-only-hmac-long-enough-for-unit-fixture'  };
const approved = { authorized: true, database_isolation_verified: true, database_target_fingerprint: 'b'.repeat(64), production_database_identity_evidence: 'https://github.com/godzillazzz/SMS-v3/actions/runs/123', production_database_target_fingerprint: 'c'.repeat(64), preview_database_cluster_fingerprint_sha256: 'a'.repeat(64), production_database_cluster_fingerprint_sha256: 'd'.repeat(64), preview_runtime_principal: 'postgres' };
function raw() { return { id: env.UAT_EXPECTED_DEPLOYMENT_ID, projectId: PROJECT_ID, ownerId: TEAM_ID, readyState: 'READY', target: 'preview', url: new URL(env.UAT_BASE_URL).host, meta: { githubCommitSha: env.UAT_SOURCE_SHA, githubCommitRef: env.UAT_SOURCE_BRANCH }, env: { VERCEL_ENV: 'preview', APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'b'.repeat(64), secret: 'must-not-be-output' } }; }
function mockSignedReceipt(url, environment = env, target = approved) {
  const parsed = new URL(url);
  const nonce = parsed.searchParams.get('nonce');
  const sha = parsed.searchParams.get('sha');
  const deploymentId = parsed.searchParams.get('deploymentId');
  const issuedAt = Number(parsed.searchParams.get('issuedAt'));
  return {
    contract: 'sms-v3-preview-isolation/v3', nonce, deploymentId, applicationSha: sha,
    vercelProjectId: PROJECT_ID, gitCommitRef: environment.UAT_SOURCE_BRANCH,
    signedChallengeIdentity: {
      host: parsed.hostname, deploymentId, applicationSha: sha, nonce, issuedAt,
      signatureVerified: true
    },
    database: {
      configuredDatabaseProjectRef: 'ezxanpfagitckpfsnflp',
      configuredDirectProjectRef: 'ezxanpfagitckpfsnflp',
      configuredDatabaseName: 'postgres', observedDatabaseName: 'postgres',
      runtimePrincipal: target.preview_runtime_principal,
      runtimeClusterFingerprintSha256: target.preview_database_cluster_fingerprint_sha256,
      logicalTargetFingerprint: target.database_target_fingerprint,
      targetGuardMatched: true, databaseReadOnlyQuerySucceeded: true,
      transactionReadOnly: true, runtimeWitnessVerified: true
    },
    storage: {
      configuredEndpointProjectRef: 'ezxanpfagitckpfsnflp',
      bucket: 'license-documents-g05-preview',
      privateBucketMetadataReadSucceeded: true, bucketIsPrivate: true
    }
  };
}
test('identity verification is GET-only exact SHA/ref/team/project and omits sensitive payload', async () => {
  const result = await verifyPreview(async (url, options) => {
    if (String(url).includes('/api/v1/ready')) return { status: 200, json: async () => ({ status: 'ready', database: 'ok' }) };
    if (String(url).includes('/api/v1/ops/preview-isolation-attestation')) { assert.equal(options.method, 'GET'); return { status: 200, json: async () => mockSignedReceipt(url) }; }
    assert.equal(url.origin, 'https://api.vercel.com'); assert.equal(url.searchParams.get('teamId'), TEAM_ID);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return { status: 200, json: async () => raw() };
  }, env, async () => ({ origin: env.UAT_BASE_URL, sha: env.UAT_SOURCE_SHA }), approved);
  assert.equal(result.sha, env.UAT_SOURCE_SHA); assert.equal(JSON.stringify(result).includes('must-not-be-output'), false);
  for (const patch of [{ id: 'dpl_Different' }, { projectId: 'wrong' }, { ownerId: 'wrong' }, { target: 'production' }, { readyState: 'ERROR' }, { meta: { githubCommitSha: 'b'.repeat(40), githubCommitRef: env.UAT_SOURCE_BRANCH } }, { meta: { githubCommitSha: env.UAT_SOURCE_SHA, githubCommitRef: 'wrong' } }, { alias: ['sms-v3-staging-ten.vercel.app'] }]) {
    await assert.rejects(() => verifyPreview(async () => ({ status: 200, json: async () => ({ ...raw(), ...patch }) }), env, async () => ({ origin: env.UAT_BASE_URL, sha: env.UAT_SOURCE_SHA }), approved));
  }
});

test('browser selectors use the reviewed Preview application contract, pinned before secrets', () => {
  const spec = fs.readFileSync('e2e/uat-v3/readonly.spec.js', 'utf8');
  const target = JSON.parse(fs.readFileSync('.github/uat/authenticated-readonly-target.json'));
  const { paths } = require('../scripts/ci/verify-uat-v3-trust');
  for (const path of ['frontend/src/main.tsx', 'frontend/src/theme.ts']) {
    assert.ok(paths.includes(path));
    assert.match(target.runtime_guard_file_sha256[path], /^[a-f0-9]{64}$/);
  }
  assert.match(spec, /#auth-login-form input#email/);
  assert.match(spec, /#auth-login-form button\[type="submit"\]/);
  assert.match(spec, /sms-v3-theme/);
});

test('missing Vercel target requires existing authoritative GitHub Preview environment proof', async () => {
  const deployment = { id: 123, sha: env.UAT_SOURCE_SHA, ref: env.UAT_SOURCE_BRANCH, environment: 'Preview', production_environment: false, creator: { login: 'vercel[bot]', type: 'Bot' } };
  const status = { state: 'success', environment: 'Preview', environment_url: env.UAT_BASE_URL, creator: deployment.creator };
  // Existing guard requires a nine-character immutable host.
  const expected = { ...env, UAT_BASE_URL: 'https://sms-v3-staging-123456789-godzillazz.vercel.app' };
  async function fetcher(url, options) {
    assert.equal(options.redirect, 'error');
    if (String(url).includes('/api/v1/ready')) return { status: 200, json: async () => ({ status: 'ready', database: 'ok' }) };
    if (String(url).startsWith('https://api.vercel.com/')) return { status: 200, json: async () => ({ ...raw(), target: null, url: new URL(expected.UAT_BASE_URL).host }) };
    return { status: 200, json: async () => String(url).includes('/statuses?') ? [{ ...status, environment_url: expected.UAT_BASE_URL }] : [deployment] };
  }
  assert.equal((await verifyPreview(fetcher, expected, undefined, approved)).environment, 'preview');
  for (const patch of [{ environment: 'Production' }, { production_environment: true }, { creator: { login: 'untrusted', type: 'User' } }, { sha: 'b'.repeat(40) }]) {
    await assert.rejects(() => verifyPreview(async (url, options) => {
      if (String(url).includes('api.github.com') && !String(url).includes('/statuses?')) return { status: 200, json: async () => [{ ...deployment, ...patch }] };
      return fetcher(url, options);
    }, expected, undefined, approved));
  }
});

test('recovery branch cannot create a Vercel Preview deployment', () => {
  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.equal(config.git?.deploymentEnabled?.['test/uat-v3-authenticated-readonly-20261015'], false);
});
