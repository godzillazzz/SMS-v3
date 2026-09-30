'use strict';

const deploymentIdPattern = /^dpl_[A-Za-z0-9]+$/;
const teamIdPattern = /^team_[A-Za-z0-9]+$/;

async function getVercelDeploymentRecord({ deploymentId, teamId, token, fetchImpl = globalThis.fetch }) {
  if (!deploymentIdPattern.test(deploymentId || '')) throw new Error('Vercel API deployment ID is invalid');
  if (!teamIdPattern.test(teamId || '')) throw new Error('Vercel API team ID is invalid');
  if (!token) throw new Error('Vercel API credential is unavailable');
  if (typeof fetchImpl !== 'function') throw new Error('Vercel API fetch implementation is unavailable');

  const url = `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}?teamId=${encodeURIComponent(teamId)}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Vercel API deployment lookup failed');
  }
  if (!response.ok) throw new Error(`Vercel API deployment lookup returned HTTP ${response.status}`);

  let record;
  try {
    const body = await response.json();
    record = body.deployment || body;
  } catch {
    throw new Error('Vercel API deployment response was not valid JSON');
  }
  if (!record || typeof record !== 'object' || !deploymentIdPattern.test(record.id || '')) {
    throw new Error('Vercel API deployment response did not contain a valid deployment record');
  }
  return record;
}

async function inspectVercelDeployment({
  deploymentId,
  teamId,
  token,
  expectedId = deploymentId,
  expectedProjectId,
  expectedCommitSha,
  expectedCommitRef,
  expectedTarget,
  requireReady,
  requireNoAliases,
  fetchImpl = globalThis.fetch,
}) {
  const record = await getVercelDeploymentRecord({ deploymentId, teamId, token, fetchImpl });
  const { inspectDeploymentRecord } = require('./vercel-deployment');
  return inspectDeploymentRecord(JSON.stringify(record), {
    expectedId,
    expectedProjectId,
    expectedCommitSha,
    expectedCommitRef,
    expectedTarget,
    requireReady,
    requireNoAliases,
  });
}

module.exports = { getVercelDeploymentRecord, inspectVercelDeployment };
