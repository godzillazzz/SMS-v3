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
const env = { UAT_BASE_URL: 'https://sms-v3-staging-fixture-godzillazz.vercel.app', VERCEL_TOKEN: 'synthetic-not-real-token', UAT_EXPECTED_DEPLOYMENT_ID: 'dpl_Fixture123', UAT_SOURCE_SHA: 'a'.repeat(40), UAT_SOURCE_BRANCH: 'test/uat-fixture', GITHUB_TOKEN: 'synthetic-github-read-token', VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-bypass'  };
const approved = { database_target_fingerprint: 'b'.repeat(64), production_database_identity_evidence: 'https://github.com/godzillazzz/SMS-v3/actions/runs/123', production_database_target_fingerprint: 'c'.repeat(64) };
function raw() { return { id: env.UAT_EXPECTED_DEPLOYMENT_ID, projectId: PROJECT_ID, ownerId: TEAM_ID, readyState: 'READY', target: 'preview', url: new URL(env.UAT_BASE_URL).host, meta: { githubCommitSha: env.UAT_SOURCE_SHA, githubCommitRef: env.UAT_SOURCE_BRANCH }, env: { VERCEL_ENV: 'preview', APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'b'.repeat(64), secret: 'must-not-be-output' } }; }
test('identity verification is GET-only exact SHA/ref/team/project and omits sensitive payload', async () => {
  const result = await verifyPreview(async (url, options) => {
    if (String(url).includes('/api/v1/ready')) return { status: 200, json: async () => ({ status: 'ready', database: 'ok' }) };
    assert.equal(url.origin, 'https://api.vercel.com'); assert.equal(url.searchParams.get('teamId'), TEAM_ID);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return { status: 200, json: async () => raw() };
  }, env, async () => ({ origin: env.UAT_BASE_URL, sha: env.UAT_SOURCE_SHA }), approved);
  assert.equal(result.sha, env.UAT_SOURCE_SHA); assert.equal(JSON.stringify(result).includes('must-not-be-output'), false);
  for (const patch of [{ projectId: 'wrong' }, { ownerId: 'wrong' }, { target: 'production' }, { readyState: 'ERROR' }, { meta: { githubCommitSha: 'b'.repeat(40), githubCommitRef: env.UAT_SOURCE_BRANCH } }, { meta: { githubCommitSha: env.UAT_SOURCE_SHA, githubCommitRef: 'wrong' } }, { alias: ['sms-v3-staging-ten.vercel.app'] }]) {
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
