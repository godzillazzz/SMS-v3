'use strict';

const deploymentIdPattern = /^dpl_[A-Za-z0-9]+$/;

function parseJsonOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Vercel deploy returned empty JSON output');
  try { return JSON.parse(text); } catch { throw new Error('Vercel deploy returned invalid JSON output'); }
}

function deploymentRecord(raw) {
  const parsed = parseJsonOutput(raw);
  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!record || typeof record !== 'object') throw new Error('Vercel deploy JSON did not contain a deployment record');
  const id = record.id || record.deploymentId;
  const url = record.url || record.deploymentUrl;
  if (!deploymentIdPattern.test(id || '')) throw new Error('Vercel deploy JSON did not contain a deployment ID');
  if (typeof url !== 'string' || !url) throw new Error('Vercel deploy JSON did not contain a deployment URL');
  return {
    id,
    url: url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`,
    projectId: record.projectId || '',
    createdAt: record.createdAt || '',
    readyState: record.readyState || record.state || '',
    source: 'prebuilt'
  };
}

function validateDeployment(record, { expectedProjectId, rollbackDeploymentId } = {}) {
  if (expectedProjectId && record.projectId && record.projectId !== expectedProjectId) throw new Error('Vercel deployment project ID mismatch');
  if (rollbackDeploymentId && record.id === rollbackDeploymentId) throw new Error('Vercel deploy returned the rollback target instead of a new deployment');
  return record;
}

function inspectDeploymentRecord(raw, { expectedId, expectedProjectId } = {}) {
  const record = parseJsonOutput(raw);
  if (!record || typeof record !== 'object') throw new Error('Vercel inspect did not return a deployment record');
  if (expectedId && record.id !== expectedId) throw new Error('Vercel inspect deployment ID mismatch');
  if (expectedProjectId && record.projectId && record.projectId !== expectedProjectId) throw new Error('Vercel inspect project ID mismatch');
  return {
    id: record.id || '',
    projectId: record.projectId || '',
    createdAt: record.createdAt || '',
    commitSha: record.meta?.githubCommitSha || record.meta?.githubCommitId || '',
    target: record.target || 'production'
  };
}

function main() {
  const [, , file, expectedProjectId, rollbackDeploymentId] = process.argv;
  const record = validateDeployment(deploymentRecord(require('node:fs').readFileSync(file, 'utf8')), { expectedProjectId, rollbackDeploymentId });
  for (const [key, value] of Object.entries({ deployment_id: record.id, deployment_url: record.url, deployment_created_at: record.createdAt || 'unknown', deployment_ready_state: record.readyState || 'unknown', deployment_source: record.source })) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

if (require.main === module) main();

module.exports = { deploymentRecord, inspectDeploymentRecord, parseJsonOutput, validateDeployment };
