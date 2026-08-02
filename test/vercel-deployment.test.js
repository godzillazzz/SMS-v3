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

test('validates inspection identity against the captured deployment', () => {
  assert.deepEqual(inspectDeploymentRecord(JSON.stringify({ id: 'dpl_new123', projectId: 'prj_expected', createdAt: 456, target: 'production', meta: { githubCommitSha: 'abc123' } }), { expectedId: 'dpl_new123', expectedProjectId: 'prj_expected' }), {
    id: 'dpl_new123', projectId: 'prj_expected', createdAt: 456, commitSha: 'abc123', target: 'production'
  });
  assert.throws(() => inspectDeploymentRecord(JSON.stringify({ id: 'dpl_other' }), { expectedId: 'dpl_new123' }), /deployment ID mismatch/);
});
