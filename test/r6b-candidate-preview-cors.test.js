'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED, safeMethod, origin, verifyEvent, verifyEnvironment, exactCi,
  verifyPr, verifyDeployment, verifyCors, verifyReadiness, verifyDeploymentRecord,
  verifyProduction
} = require('../scripts/ci/r6b-candidate-preview-cors.cjs');

function event(overrides = {}) {
  return {
    action: 'created',
    issue: { number: EXPECTED.prNumber, state: 'open', pull_request: { url: 'https://api.github.com/repos/godzillazzz/SMS-v3/pulls/611' } },
    sender: { login: EXPECTED.owner, id: EXPECTED.ownerId, type: 'User' },
    comment: { id: 10, author_association: 'OWNER', body: EXPECTED.issueComment,
      user: { login: EXPECTED.owner, id: EXPECTED.ownerId, type: 'User' } },
    ...overrides
  };
}
function env(overrides = {}) {
  return {
    GITHUB_REPOSITORY: EXPECTED.repository,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'issue_comment',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: 'f'.repeat(40),
    GITHUB_RUN_ID: '123',
    ...overrides
  };
}
function allowedEnvironment() {
  return {
    name: EXPECTED.environment,
    can_admins_bypass: false,
    protection_rules: [{
      type: 'required_reviewers',
      reviewers: [{ type: 'User', reviewer: { login: EXPECTED.owner, id: EXPECTED.ownerId } }]
    }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }
  };
}
function deployment(overrides = {}) {
  return {
    id: EXPECTED.deploymentId,
    name: 'sms-v3-staging',
    projectId: EXPECTED.projectId,
    url: new URL(EXPECTED.previewUrl).hostname,
    target: null,
    readyState: 'READY',
    meta: {
      githubCommitSha: EXPECTED.candidateSha,
      githubCommitRef: EXPECTED.candidateBranch,
      githubOrg: 'godzillazzz',
      githubRepo: 'SMS-v3'
    },
    ...overrides
  };
}

test('accepts only the exact Owner command on the trusted main issue_comment event', () => {
  assert.equal(verifyEvent(event(), env()), 10);
  assert.throws(() => verifyEvent(event({ sender: { login: 'attacker', id: 1, type: 'User' } }), env()),
    { code: 'OWNER_IDENTITY_REQUIRED' });
  assert.throws(() => verifyEvent(event({ comment: { ...event().comment, body: '/sms-v3-preview-check' } }), env()),
    { code: 'EXACT_OWNER_COMMAND_REQUIRED' });
  assert.throws(() => verifyEvent(event({ issue: { number: 611, state: 'open' } }), env()),
    { code: 'OWNER_PR_COMMENT_REQUIRED' });
  assert.throws(() => verifyEvent(event(), env({ GITHUB_REF: 'refs/heads/feature/untrusted' })),
    { code: 'TRUSTED_MAIN_EVENT_REQUIRED' });
});

test('requires the Hosted UAT Owner reviewer and a single main-only deployment policy', () => {
  verifyEnvironment(allowedEnvironment(), {
    total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }]
  });
  const noReview = allowedEnvironment();
  noReview.protection_rules = [];
  assert.throws(() => verifyEnvironment(noReview, {
    total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }]
  }), { code: 'HUMAN_OWNER_REVIEW_REQUIRED' });
  assert.throws(() => verifyEnvironment(allowedEnvironment(), {
    total_count: 1, branch_policies: [{ name: 'fix/serverless-database-reliability', type: 'branch' }]
  }), { code: 'MAIN_ONLY_ENVIRONMENT_REQUIRED' });
  const bypass = allowedEnvironment();
  bypass.can_admins_bypass = true;
  assert.throws(() => verifyEnvironment(bypass, {
    total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }]
  }), { code: 'ENVIRONMENT_IDENTITY_OR_BYPASS_INVALID' });
});

test('requires exact successful candidate CI and rejects mismatched or failed runs', () => {
  const run = {
    id: EXPECTED.candidateCiRun,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    head_sha: EXPECTED.candidateSha,
    head_branch: EXPECTED.candidateBranch,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success'
  };
  assert.equal(exactCi({ workflow_runs: [run] }, EXPECTED.candidateSha,
    EXPECTED.candidateBranch, 'workflow_dispatch', EXPECTED.candidateCiRun), EXPECTED.candidateCiRun);
  assert.throws(() => exactCi({ workflow_runs: [{ ...run, conclusion: 'failure' }] },
    EXPECTED.candidateSha, EXPECTED.candidateBranch, 'workflow_dispatch', EXPECTED.candidateCiRun),
  { code: 'EXACT_HEAD_CI_REQUIRED' });
  assert.throws(() => exactCi({ workflow_runs: [{ ...run, event: 'pull_request' }] },
    EXPECTED.candidateSha, EXPECTED.candidateBranch, 'workflow_dispatch', EXPECTED.candidateCiRun),
  { code: 'EXACT_HEAD_CI_REQUIRED' });
});

test('rejects candidate PR drift and production-target Preview identities', () => {
  const pr = {
    number: EXPECTED.prNumber, state: 'open', draft: true,
    head: { ref: EXPECTED.candidateBranch, sha: EXPECTED.candidateSha },
    base: { ref: 'codex/r6b-review-base-r5b-20261011', sha: EXPECTED.frozenProductionSha }
  };
  verifyPr(pr, EXPECTED.candidateSha, 'f'.repeat(40));
  assert.throws(() => verifyPr({ ...pr, draft: false }, EXPECTED.candidateSha, 'f'.repeat(40)),
    { code: 'CANDIDATE_PR_IDENTITY_MISMATCH' });
  assert.throws(() => verifyDeployment(deployment({ target: 'production' }), deployment()),
    { code: 'NATIVE_PREVIEW_IDENTITY_MISMATCH' });
  assert.throws(() => verifyDeploymentRecord(deployment({ meta: { githubCommitSha: '0'.repeat(40) } }), EXPECTED.deploymentId),
    { code: 'NATIVE_PREVIEW_IDENTITY_MISMATCH' });
});

test('uses only HTTPS origins and refuses HTTP mutation methods', () => {
  assert.equal(origin(EXPECTED.trustedOrigin), EXPECTED.trustedOrigin);
  assert.throws(() => origin('https://user:pass@sms-v3-staging-ten.vercel.app'), { code: 'ORIGIN_INVALID' });
  assert.throws(() => safeMethod('POST'), { code: 'UNSAFE_METHOD_REJECTED' });
  assert.throws(() => safeMethod('DELETE'), { code: 'UNSAFE_METHOD_REJECTED' });
  assert.doesNotThrow(() => safeMethod('GET'));
  assert.doesNotThrow(() => safeMethod('OPTIONS'));
});

test('checks credentialed trusted CORS and rejects untrusted origins', () => {
  const good = {
    status: 204,
    headers: new Headers({
      'access-control-allow-origin': EXPECTED.trustedOrigin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,HEAD',
      'access-control-allow-headers': 'authorization,content-type'
    })
  };
  const rejected = { status: 403, headers: new Headers({}) };
  verifyCors(good, rejected);
  assert.throws(() => verifyCors({ ...good, headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET',
    'access-control-allow-headers': 'authorization,content-type'
  }) }, rejected), { code: 'TRUSTED_CORS_FAILED' });
  assert.throws(() => verifyCors(good, {
    status: 204, headers: new Headers({
      'access-control-allow-origin': EXPECTED.untrustedOrigin,
      'access-control-allow-credentials': 'true'
    })
  }), { code: 'UNTRUSTED_CORS_FAILED' });
});

test('requires successful Health and Database Readiness', () => {
  verifyReadiness({ status: 200 }, { status: 'ok' }, { status: 200 }, { status: 'ready', database: 'ok' });
  assert.throws(() => verifyReadiness({ status: 500 }, {}, { status: 200 }, {}), { code: 'PREVIEW_HEALTH_FAILED' });
  assert.throws(() => verifyReadiness({ status: 200 }, { status: 'ok' }, { status: 200 },
    { status: 'ready', database: 'unavailable' }), { code: 'PREVIEW_READINESS_FAILED' });
});

test('requires frozen Production identity and metadata-verified candidate configuration', () => {
  const production = {
    id: EXPECTED.productionDeploymentId,
    target: 'production',
    readyState: 'READY',
    projectId: EXPECTED.projectId,
    meta: { githubCommitSha: EXPECTED.frozenProductionSha }
  };
  assert.doesNotThrow(() => verifyProduction(production));
  assert.throws(() => verifyProduction({ ...production, meta: { githubCommitSha: EXPECTED.candidateSha } }),
    { code: 'FROZEN_PRODUCTION_IDENTITY_MISMATCH' });
});
