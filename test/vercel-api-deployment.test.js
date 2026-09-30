'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getVercelDeploymentRecord, inspectVercelDeployment } = require('../scripts/ci/vercel-api-deployment');

const record = {
  id: 'dpl_abc123',
  projectId: 'prj_expected',
  target: 'production',
  readyState: 'READY',
  meta: {
    githubCommitSha: 'a'.repeat(40),
    githubCommitRef: 'fix/serverless-database-reliability',
  },
  aliasAssigned: false,
  alias: [],
};

test('reads Vercel native deployment metadata through the team-scoped REST API', async () => {
  let request;
  const result = await getVercelDeploymentRecord({
    deploymentId: record.id,
    teamId: 'team_expected',
    token: 'test-token',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => record };
    },
  });

  assert.equal(request.url, 'https://api.vercel.com/v13/deployments/dpl_abc123?teamId=team_expected');
  assert.equal(request.init.headers.Authorization, 'Bearer test-token');
  assert.equal(result.meta.githubCommitSha, 'a'.repeat(40));
  assert.equal(result.meta.githubCommitRef, 'fix/serverless-database-reliability');
});

test('verifies native project, SHA/ref, READY target, and no aliases from the API record', async () => {
  const result = await inspectVercelDeployment({
    deploymentId: record.id,
    teamId: 'team_expected',
    token: 'test-token',
    expectedProjectId: 'prj_expected',
    expectedCommitSha: 'a'.repeat(40),
    expectedCommitRef: 'fix/serverless-database-reliability',
    expectedTarget: 'production',
    requireReady: true,
    requireNoAliases: true,
    fetchImpl: async () => ({ ok: true, json: async () => record }),
  });

  assert.equal(result.id, record.id);
  assert.equal(result.projectId, 'prj_expected');
  assert.equal(result.commitSha, 'a'.repeat(40));
  assert.equal(result.commitRef, 'fix/serverless-database-reliability');
  assert.equal(result.aliasAssigned, false);
});

test('fails closed for malformed deployment IDs and does not disclose API error bodies', async () => {
  await assert.rejects(
    getVercelDeploymentRecord({ deploymentId: 'https://outside.invalid', teamId: 'team_expected', token: 'test-token' }),
    /deployment ID is invalid/,
  );
  await assert.rejects(
    getVercelDeploymentRecord({
      deploymentId: record.id,
      teamId: 'team_expected',
      token: 'test-token',
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'sensitive response detail' }) }),
    }),
    (error) => error.message === 'Vercel API deployment lookup returned HTTP 403' && !error.message.includes('sensitive'),
  );
});
