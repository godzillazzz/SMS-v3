'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED, projectIsExpected, assertOwnerEvent, verifyEnvironment,
  verifyDeployment, verifyProduction, verifyCi, verifyRuntimeReceipt,
  safeUrl, verifyPlan, client
} = require('../scripts/ci/r6b-exact-deployment-isolation.cjs');

const SHA = 'a'.repeat(40);
const prodDb = 'x'.repeat(20);
const prodStorage = 'y'.repeat(20);
const nonce = 'f'.repeat(32);

function event() {
  const owner = { login: EXPECTED.owner, id: EXPECTED.ownerId, type: 'User' };
  return {
    action: 'created',
    issue: { number: EXPECTED.issue, state: 'open' },
    sender: { ...owner },
    comment: { id: 123, body: EXPECTED.command, author_association: 'OWNER', user: { ...owner } }
  };
}
function env() {
  return {
    GITHUB_REPOSITORY: EXPECTED.repo, GITHUB_EVENT_NAME: 'issue_comment',
    GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: SHA
  };
}
function environment() {
  return {
    name: EXPECTED.environment, can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [{
      type: 'required_reviewers',
      reviewers: [{ type: 'User', reviewer: { login: EXPECTED.owner, id: EXPECTED.ownerId } }]
    }]
  };
}
function policies() {
  return { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
}
function deployment() {
  return {
    id: EXPECTED.deploymentId, name: 'sms-v3-staging',
    project: { id: EXPECTED.projectId }, target: null,
    readyState: 'READY', url: 'sms-v3-staging-abc123-godzillazz.vercel.app',
    meta: {
      githubCommitSha: EXPECTED.integrationSha, githubCommitRef: EXPECTED.integrationBranch,
      githubOrg: 'godzillazzz', githubRepo: 'SMS-v3'
    }
  };
}
function receipt() {
  return {
    contract: 'sms-v3-preview-isolation/v1', nonce, applicationSha: EXPECTED.integrationSha,
    database: {
      readOnlyQuerySucceeded: true,
      connectionProjectRef: EXPECTED.previewRef,
      directProjectRef: EXPECTED.previewRef,
      connectedProjectRef: EXPECTED.previewRef
    },
    storage: {
      projectRef: EXPECTED.previewRef,
      credentialProjectRef: EXPECTED.previewRef,
      bucket: EXPECTED.previewBucket,
      privateBucketReadSucceeded: true
    }
  };
}
const proof = () => ({
  deploymentVerified: true,
  approvedProductionDatabaseRef: prodDb,
  approvedProductionStorageRef: prodStorage
});
const copy = (obj) => JSON.parse(JSON.stringify(obj));

test('Owner-only main issue command accepts the exact event', () => {
  assert.equal(assertOwnerEvent(event(), env()), 123);
});
test('Reject unrelated issue, PR comment and forged Owner', () => {
  const a = event(); a.issue.number = 611;
  assert.throws(() => assertOwnerEvent(a, env()), /EXACT_OWNER_ISSUE_COMMAND_REQUIRED/);
  const b = event(); b.issue.pull_request = {};
  assert.throws(() => assertOwnerEvent(b, env()), /EXACT_OWNER_ISSUE_COMMAND_REQUIRED/);
  const c = event(); c.sender.id = 2;
  assert.throws(() => assertOwnerEvent(c, env()), /OWNER_IDENTITY_REQUIRED/);
  const d = event(); d.comment.body = '/sms-v3-preview-check';
  assert.throws(() => assertOwnerEvent(d, env()), /EXACT_OWNER_ISSUE_COMMAND_REQUIRED/);
});
test('Reject alternate branch, retry attempt, or untrusted event', () => {
  for (const update of [
    { GITHUB_REF: 'refs/heads/fix/serverless-database-reliability' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_EVENT_NAME: 'pull_request' }
  ]) assert.throws(() => assertOwnerEvent(event(), { ...env(), ...update }), /TRUSTED_MAIN_REQUIRED/);
});
test('Only main with human reviewers, no bypass', () => {
  assert.doesNotThrow(() => verifyEnvironment(environment(), policies()));
  const a = environment(); a.can_admins_bypass = true;
  assert.throws(() => verifyEnvironment(a, policies()), /ENVIRONMENT_BYPASS_REJECTED/);
  const b = environment(); b.protection_rules = [];
  assert.throws(() => verifyEnvironment(b, policies()), /HUMAN_OWNER_APPROVAL_REQUIRED/);
  const c = policies(); c.branch_policies[0].name = '*';
  assert.throws(() => verifyEnvironment(environment(), c), /MAIN_ONLY_ENVIRONMENT_REQUIRED/);
});
test('Strict deployment project identity rejects empty, conflicting and malformed IDs', () => {
  assert.equal(projectIsExpected({ projectId: EXPECTED.projectId }), true);
  assert.equal(projectIsExpected({ project: EXPECTED.projectId }), true);
  assert.equal(projectIsExpected({ project: { id: EXPECTED.projectId } }), true);
  assert.equal(projectIsExpected({ project: { id: EXPECTED.projectId }, projectId: 'wrong' }), false);
  assert.equal(projectIsExpected({ project: {} }), false);
  assert.equal(projectIsExpected({}), false);
});
test('Preview identity requires immutable source, target and READY', () => {
  const d = deployment();
  assert.doesNotThrow(() => verifyDeployment(d, d.url));
  const moved = copy(d); moved.meta.githubCommitSha = SHA;
  assert.throws(() => verifyDeployment(moved, moved.url), /EXACT_PREVIEW_DEPLOYMENT_REQUIRED/);
  const wrong = copy(d); wrong.target = 'production';
  assert.throws(() => verifyDeployment(wrong, wrong.url), /EXACT_PREVIEW_DEPLOYMENT_REQUIRED/);
});
test('Frozen Production SHA and target must match', () => {
  const p = deployment(); p.id = EXPECTED.productionDeploymentId;
  p.target = 'production'; p.meta.githubCommitSha = EXPECTED.productionSha;
  assert.doesNotThrow(() => verifyProduction(p));
  p.target = 'preview';
  assert.throws(() => verifyProduction(p), /FROZEN_PRODUCTION_CHANGED/);
});
test('CI requires exact source and completed success', () => {
  const correct = { id: EXPECTED.ciRunId, name: 'CI', head_sha: EXPECTED.integrationSha,
    head_branch: EXPECTED.integrationBranch, status: 'completed', conclusion: 'success' };
  assert.doesNotThrow(() => verifyCi({ workflow_runs: [correct] }));
  assert.throws(() => verifyCi({ workflow_runs: [{ ...correct, conclusion: 'failure' }] }),
    /EXACT_INTEGRATION_CI_REQUIRED/);
});
test('Fail closed when runtime receipt missing or nonce replayed', () => {
  assert.throws(() => verifyRuntimeReceipt(null, nonce, proof()),
    /RUNTIME_PROBE_MISSING_OR_UNTRUSTED/);
  const x = receipt(); x.nonce = '0'.repeat(32);
  assert.throws(() => verifyRuntimeReceipt(x, nonce, proof()), /RUNTIME_PROBE_MISSING_OR_UNTRUSTED/);
  assert.throws(() => verifyRuntimeReceipt(receipt(), nonce, { ...proof(), deploymentVerified: false }),
    /DEPLOYMENT_PROVENANCE_REQUIRED/);
});
test('No database PASS based on readiness or on URL project alone', () => {
  const x = receipt(); x.database.connectedProjectRef = 'other-project-ref';
  assert.throws(() => verifyRuntimeReceipt(x, nonce, proof()), /RUNTIME_DATABASE_IDENTITY_UNVERIFIED/);
  const y = receipt(); y.database.readOnlyQuerySucceeded = false;
  assert.throws(() => verifyRuntimeReceipt(y, nonce, proof()), /RUNTIME_DATABASE_IDENTITY_UNVERIFIED/);
});
test('No Storage PASS without proven service-role and private bucket GET', () => {
  const x = receipt(); x.storage.credentialProjectRef = 'other-project-ref';
  assert.throws(() => verifyRuntimeReceipt(x, nonce, proof()), /RUNTIME_STORAGE_IDENTITY_UNVERIFIED/);
  const y = receipt(); y.storage.privateBucketReadSucceeded = false;
  assert.throws(() => verifyRuntimeReceipt(y, nonce, proof()), /RUNTIME_STORAGE_IDENTITY_UNVERIFIED/);
});
test('No isolation PASS without independently approved distinct Production refs', () => {
  assert.throws(() => verifyRuntimeReceipt(receipt(), nonce, { deploymentVerified: true }),
    /PRODUCTION_SEPARATION_UNVERIFIED/);
  const same = { ...proof(), approvedProductionStorageRef: EXPECTED.previewRef };
  assert.throws(() => verifyRuntimeReceipt(receipt(), nonce, same), /PRODUCTION_SEPARATION_UNVERIFIED/);
});
test('Only complete non-secret runtime and external Production evidence can pass', () => {
  const result = verifyRuntimeReceipt(receipt(), nonce, proof());
  assert.deepEqual(result, { database: 'PASS', storage: 'PASS', productionSeparation: 'PASS' });
});
test('Plan is tied to exact owner comment, main SHA and deployment', () => {
  const plan = { version: 1, commentId: 123, mainSha: SHA,
    integrationSha: EXPECTED.integrationSha, deploymentId: EXPECTED.deploymentId };
  assert.doesNotThrow(() => verifyPlan(plan, event(), env()));
  assert.throws(() => verifyPlan({ ...plan, mainSha: 'b'.repeat(40) }, event(), env()),
    /PLAN_TAMPERED/);
});
test('URL and request client reject unsafe method, secrets and redirects', async () => {
  assert.equal(safeUrl('https://preview.example.com', 'preview.example.com').hostname, 'preview.example.com');
  assert.throws(() => safeUrl('https://secret@preview.example.com', 'preview.example.com'), /UNSAFE_URL/);
  const api = client({}, async () => ({ status: 302 }));
  await assert.rejects(() => api.request('https://preview.example.com', {}, 'POST'), /UNSAFE_METHOD/);
  await assert.rejects(() => api.request('https://preview.example.com', {}, 'GET'), /REDIRECT_REJECTED/);
});
