const test = require('node:test');
const assert = require('node:assert/strict');
const { deploymentRecord, inspectDeploymentRecord, validateDeployment } = require('../scripts/ci/vercel-deployment');

test('parses the deployment ID and URL from Vercel JSON output', () => {
  assert.deepEqual(deploymentRecord(JSON.stringify({ status: 'ok', deployment: { id: 'dpl_new123', url: 'sms-v3-staging-new.vercel.app', projectId: 'prj_expected', createdAt: 123, readyState: 'READY', target: 'production' } })), {
    id: 'dpl_new123', url: 'https://sms-v3-staging-new.vercel.app', projectId: 'prj_expected', createdAt: 123, readyState: 'READY', target: 'production', source: 'prebuilt'
  });
});

test('rejects a reused rollback deployment and mismatched project', () => {
  const record = deploymentRecord(JSON.stringify({ deployment: { id: 'dpl_old', url: 'sms-v3-staging-old.vercel.app', projectId: 'prj_expected' } }));
  assert.throws(() => validateDeployment(record, { expectedProjectId: 'prj_expected', rollbackDeploymentId: 'dpl_old' }), /rollback target/);
  assert.throws(() => validateDeployment(record, { expectedProjectId: 'prj_other' }), /project ID mismatch/);
});

test('rejects malformed or incomplete deployment output', () => {
  assert.throws(() => deploymentRecord('not-json'), /invalid JSON/);
  assert.throws(() => deploymentRecord(JSON.stringify({ url: 'sms-v3-staging.vercel.app' })), /deployment ID/);
  assert.throws(() => deploymentRecord(JSON.stringify({ id: 'dep_wrong', url: 'sms-v3-staging.vercel.app' })), /deployment ID/);
});

test('validates inspection identity against the captured deployment and native source', () => {
  assert.deepEqual(inspectDeploymentRecord(JSON.stringify({ id: 'dpl_new123', projectId: 'prj_expected', createdAt: 456, readyState: 'READY', target: 'production', alias: [], aliasAssigned: false, gitSource: { type: 'github', ref: 'release/ref' }, meta: { githubCommitSha: 'abc123', githubCommitRef: 'release/ref' } }), { expectedId: 'dpl_new123', expectedProjectId: 'prj_expected', expectedCommitSha: 'abc123', expectedCommitRef: 'release/ref', expectedTarget: 'production', requireReady: true, requireNoAliases: true }), {
    id: 'dpl_new123', projectId: 'prj_expected', createdAt: 456, commitSha: 'abc123', commitRef: 'release/ref', target: 'production', readyState: 'READY', aliasAssigned: false, aliases: []
  });
  assert.throws(() => inspectDeploymentRecord(JSON.stringify({ id: 'dpl_other' }), { expectedId: 'dpl_new123' }), /deployment ID mismatch/);
  assert.throws(() => inspectDeploymentRecord(JSON.stringify({ id: 'dpl_new123', projectId: 'prj_expected', target: 'production', readyState: 'READY', meta: { githubCommitSha: 'abc123', githubCommitRef: 'HEAD' } }), { expectedCommitSha: 'abc123', expectedCommitRef: 'release/ref' }), /githubCommitRef mismatch/);
  assert.throws(() => inspectDeploymentRecord(JSON.stringify({ id: 'dpl_new123', projectId: 'prj_expected', target: 'production', readyState: 'BUILDING', meta: { githubCommitSha: 'abc123', githubCommitRef: 'release/ref' } }), { requireReady: true }), /not READY/);
});
