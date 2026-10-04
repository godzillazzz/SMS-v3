'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_HOST,
  EXPECTED_PROJECT_ID,
  EXPECTED_SOURCE_REF,
  EXPECTED_SOURCE_SHA,
  EXPECTED_TEAM_ID,
  validateDeployment,
  verifyPreviewDeployment,
} = require('../scripts/ci/verify-g06-preview-deployment');

function deployment(overrides = {}) {
  return {
    uid: 'dpl_0123456789abcdef',
    projectId: EXPECTED_PROJECT_ID,
    target: 'preview',
    readyState: 'READY',
    meta: {
      githubCommitSha: EXPECTED_SOURCE_SHA,
      githubCommitRef: EXPECTED_SOURCE_REF,
    },
    ...overrides,
  };
}

test('accepts only the exact ready Preview deployment for the pinned project and source', () => {
  assert.deepEqual(validateDeployment(deployment()), {
    projectId: EXPECTED_PROJECT_ID,
    deploymentId: 'dpl_0123456789abcdef',
    target: 'preview',
    state: 'READY',
    sourceSha: EXPECTED_SOURCE_SHA,
    sourceRef: EXPECTED_SOURCE_REF,
  });
});

test('rejects a deployment with the wrong target identity', () => {
  assert.throws(() => validateDeployment(deployment({ target: 'production' })), { code: 'VERCEL_TARGET_NOT_PREVIEW' });
  assert.throws(() => validateDeployment(deployment({ projectId: 'other-project' })), { code: 'VERCEL_PROJECT_ID_MISMATCH' });
  assert.throws(() => validateDeployment(deployment({ meta: { githubCommitSha: 'other-sha', githubCommitRef: EXPECTED_SOURCE_REF } })), { code: 'VERCEL_SOURCE_SHA_MISMATCH' });
  assert.throws(() => validateDeployment(deployment({ meta: { githubCommitSha: EXPECTED_SOURCE_SHA, githubCommitRef: 'other-ref' } })), { code: 'VERCEL_SOURCE_REF_MISMATCH' });
  assert.throws(() => validateDeployment(deployment({ readyState: 'BUILDING' })), { code: 'VERCEL_DEPLOYMENT_NOT_READY' });
});

test('looks up only the pinned Preview host with the pinned Vercel team and emits sanitized identity', async () => {
  const token = 'test-vercel-token-never-log';
  const calls = [];
  const logs = [];
  const result = await verifyPreviewDeployment({
    env: {
      VERCEL_TOKEN: token,
      VERCEL_ORG_ID: EXPECTED_TEAM_ID,
      VERCEL_PROJECT_ID: EXPECTED_PROJECT_ID,
    },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify(deployment()), { status: 200 });
    },
    log: (line) => logs.push(String(line)),
    outputPath: null,
  });

  assert.equal(result.deploymentId, 'dpl_0123456789abcdef');
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin, 'https://api.vercel.com');
  assert.equal(requestUrl.pathname, `/v13/deployments/${EXPECTED_HOST}`);
  assert.equal(requestUrl.searchParams.get('teamId'), EXPECTED_TEAM_ID);
  assert.equal(requestUrl.searchParams.get('withGitRepoInfo'), 'true');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.ok(logs.includes('RAW_VERCEL_RESPONSE_EMITTED=false'));
  assert.ok(logs.every((line) => !line.includes(token)));
  assert.ok(logs.every((line) => !line.includes(EXPECTED_HOST)));
});

test('fails closed without exposing Vercel response data', async () => {
  const logs = [];
  await assert.rejects(verifyPreviewDeployment({
    env: {
      VERCEL_TOKEN: 'test-token',
      VERCEL_ORG_ID: EXPECTED_TEAM_ID,
      VERCEL_PROJECT_ID: EXPECTED_PROJECT_ID,
    },
    fetchImpl: async () => new Response(JSON.stringify(deployment({ target: 'production', private: 'must-not-log' })), { status: 200 }),
    log: (line) => logs.push(String(line)),
    outputPath: null,
  }), { code: 'VERCEL_TARGET_NOT_PREVIEW' });
  assert.deepEqual(logs, []);
  assert.equal(EXPECTED_HOST, 'sms-v3-staging-git-codex-g06-time-policy-20261002-godzillazz.vercel.app');
});
