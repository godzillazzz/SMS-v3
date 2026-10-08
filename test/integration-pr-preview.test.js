'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolvePreview, commitPreviewOrigin, main } = require('../scripts/ci/verify-integration-pr-preview');
const { normalizedPreviewOrigin } = require('../scripts/ci/verify-preview-runtime');

const sha = 'ed755ef4b2da013aeb00f73a4c2daf6446f9eff1';
const branch = 'docs/r5a-restore-t12-handoff-20261008';
const origin = 'https://sms-v3-staging-k3mwdpruk-godzillazz.vercel.app';
const creator = { login: 'vercel[bot]', type: 'Bot' };
const deployment = { id: 123, sha, ref: sha, environment: 'Preview', production_environment: false, creator };
const status = { state: 'success', environment: 'Preview', environment_url: origin, target_url: origin, creator };
const source = { sha, branch, repository: 'godzillazzz/SMS-v3', token: 'synthetic-github-token' };
const json = body => ({ status: 200, json: async () => body });
const metadataFetch = (dep = deployment, state = status) => async url => json(url.includes('/statuses?') ? [state] : [dep]);

test('resolves exact-head Vercel commit URL despite a 67-character branch alias', async () => {
  assert.equal(`sms-v3-staging-git-${branch.replaceAll('/', '-')}-godzillazz`.length, 67);
  const calls = [];
  const preview = await resolvePreview({ ...source, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return metadataFetch()(url);
  } });
  assert.deepEqual(preview, { origin, sha, deploymentId: 123 });
  assert.ok(calls[0].url.includes(`sha=${sha}`));
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-github-token');
});

for (const [name, patch] of Object.entries({
  wrongSha: { sha: '0'.repeat(40) }, wrongRef: { ref: 'main' }, production: { production_environment: true },
  wrongEnvironment: { environment: 'Production' }, wrongActor: { creator: { login: 'other[bot]', type: 'Bot' } },
  impersonatedActor: { creator: { login: 'vercel[bot]', type: 'User' } }, unsafeId: { id: '../statuses' }
})) test(`rejects deployment ${name} before following its status`, async () => {
  let calls = 0;
  await assert.rejects(resolvePreview({ ...source, fetchImpl: async () => { calls++; return json([{ ...deployment, ...patch }]); } }), /EXACT_HEAD_VERCEL_PREVIEW_NOT_READY/);
  assert.equal(calls, 1);
});

for (const [name, patch] of Object.entries({ pending: { state: 'pending' }, failed: { state: 'failure' }, inactive: { state: 'inactive' },
  wrongActor: { creator: { login: 'other[bot]', type: 'Bot' } }, production: { environment: 'Production' }
})) test(`does not accept latest status ${name}`, async () => {
  await assert.rejects(resolvePreview({ ...source, fetchImpl: metadataFetch(deployment, { ...status, ...patch }) }), /EXACT_HEAD_VERCEL_PREVIEW_NOT_READY/);
});

test('does not use an older successful status when the latest status failed', async () => {
  await assert.rejects(resolvePreview({ ...source, fetchImpl: async url => json(url.includes('/statuses?') ? [{ ...status, state: 'failure' }, status] : [deployment]) }), /EXACT_HEAD_VERCEL_PREVIEW_NOT_READY/);
});

test('fails closed for absent deployment/provider limit, API error, missing token and wrong repository', async () => {
  await assert.rejects(resolvePreview({ ...source, fetchImpl: async () => json([]) }), /EXACT_HEAD_VERCEL_PREVIEW_NOT_READY/);
  await assert.rejects(resolvePreview({ ...source, fetchImpl: async () => ({ status: 403 }) }), /GITHUB_DEPLOYMENT_HTTP_403/);
  await assert.rejects(resolvePreview({ ...source, token: '' }), /GITHUB_TOKEN_MISSING/);
  await assert.rejects(resolvePreview({ ...source, repository: 'other/repo' }), /PREVIEW_SOURCE_IDENTITY_INVALID/);
  await assert.rejects(resolvePreview({ ...source, sha: 'main' }), /PREVIEW_SOURCE_IDENTITY_INVALID/);
  await assert.rejects(resolvePreview({ ...source, fetchImpl: async () => json({}) }), /GITHUB_DEPLOYMENT_RESPONSE_INVALID/);
});

test('rejects canonical, foreign host, redirects encoded as URL data and mismatched status URLs', async () => {
  for (const url of ['https://sms-v3-staging-ten.vercel.app', 'https://example.invalid', `${origin}/path`, `${origin}?token=x`, `${origin}#hash`, origin.replace('https:', 'http:'), origin.replace('https://', 'https://user:password@')]) {
    assert.throws(() => commitPreviewOrigin(url), /COMMIT_PREVIEW_URL_NOT_ALLOWED/);
  }
  await assert.rejects(resolvePreview({ ...source, fetchImpl: metadataFetch(deployment, { ...status, target_url: 'https://sms-v3-staging-1venkdc5s-godzillazz.vercel.app' }) }), /PREVIEW_STATUS_URL_MISMATCH/);
  assert.throws(() => normalizedPreviewOrigin(origin), /PREVIEW_URL_NOT_ALLOWED/);
  assert.throws(() => normalizedPreviewOrigin('https://sms-v3-staging-ten.vercel.app', 'https://sms-v3-staging-ten.vercel.app'), /PREVIEW_URL_NOT_ALLOWED/);
});

test('wrapper retains health/readiness/trusted and untrusted CORS and separates credentials', async () => {
  const calls = [];
  const env = { GITHUB_REPOSITORY: source.repository, EXPECTED_PR_HEAD_SHA: sha, EXPECTED_PR_HEAD_REF: branch,
    GITHUB_TOKEN: source.token, VERCEL_AUTOMATION_BYPASS_SECRET: 'synthetic-preview-bypass' };
  const code = await main({ env, log: () => {}, error: () => {}, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers['x-vercel-protection-bypass'], undefined);
      return metadataFetch()(url);
    }
    assert.ok(url.startsWith(origin));
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers['x-vercel-protection-bypass'], env.VERCEL_AUTOMATION_BYPASS_SECRET);
    assert.equal(options.redirect, 'manual');
    if (options.method === 'OPTIONS') return { status: options.headers.Origin === origin ? 204 : 403,
      headers: new Headers(options.headers.Origin === origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {}) };
    return json(url.endsWith('/ready') ? { status: 'ready', database: 'ok' } : { status: 'ok' });
  } });
  assert.equal(code, 0);
  assert.equal(calls.length, 6);
});

test('wrapper fails instead of skipping when provider has no successful Preview', async () => {
  const errors = [];
  assert.equal(await main({ env: { GITHUB_REPOSITORY: source.repository, EXPECTED_PR_HEAD_SHA: sha,
    EXPECTED_PR_HEAD_REF: branch, GITHUB_TOKEN: source.token }, fetchImpl: async () => json([]), error: text => errors.push(text) }), 1);
  assert.deepEqual(errors, ['PREVIEW_RUNTIME_FAILED=EXACT_HEAD_VERCEL_PREVIEW_NOT_READY']);
});

test('CI pins the actual PR head and keeps the required integration Preview gate', () => {
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /deployments: read/);
  assert.match(ci, /EXPECTED_PR_HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(ci, /EXPECTED_PR_HEAD_REF: \$\{\{ github.head_ref \}\}/);
  assert.match(ci, /if: github.event_name == 'pull_request' && github.base_ref == 'fix\/serverless-database-reliability'/);
  assert.match(ci, /node scripts\/ci\/verify-integration-pr-preview.js/);
  assert.doesNotMatch(ci, /continue-on-error/);
});
