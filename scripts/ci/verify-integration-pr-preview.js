'use strict';

const { verifyPreviewRuntime } = require('./verify-preview-runtime');

const REPOSITORY = 'godzillazzz/SMS-v3';
const COMMIT_PREVIEW_HOST = /^sms-v3-staging-[a-z0-9]{9}-godzillazz\.vercel\.app$/;

function isVercelBot(actor) {
  return actor?.login === 'vercel[bot]' && actor?.type === 'Bot';
}

function commitPreviewOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !COMMIT_PREVIEW_HOST.test(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('COMMIT_PREVIEW_URL_NOT_ALLOWED');
  }
  return url.origin;
}

async function resolvePreview({ sha, branch, repository, token, fetchImpl = globalThis.fetch } = {}) {
  if (repository !== REPOSITORY || !/^[a-f0-9]{40}$/.test(sha || '') || !branch) {
    throw new Error('PREVIEW_SOURCE_IDENTITY_INVALID');
  }
  if (!token) throw new Error('GITHUB_TOKEN_MISSING');
  async function github(path) {
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(20_000)
    });
    if (response.status !== 200) throw new Error(`GITHUB_DEPLOYMENT_HTTP_${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('GITHUB_DEPLOYMENT_RESPONSE_INVALID');
    return body;
  }
  const deployments = await github(`deployments?sha=${sha}&environment=Preview&per_page=100`);
  for (const deployment of deployments) {
    if (deployment.sha !== sha || ![sha, branch].includes(deployment.ref)
        || deployment.environment !== 'Preview' || deployment.production_environment !== false
        || !isVercelBot(deployment.creator) || !Number.isSafeInteger(deployment.id) || deployment.id <= 0) continue;
    const statuses = await github(`deployments/${deployment.id}/statuses?per_page=1`);
    const latest = statuses[0];
    if (latest?.state !== 'success' || latest.environment !== 'Preview' || !isVercelBot(latest.creator)) continue;
    const origin = commitPreviewOrigin(latest.environment_url);
    if (latest.target_url && commitPreviewOrigin(latest.target_url) !== origin) throw new Error('PREVIEW_STATUS_URL_MISMATCH');
    return { origin, sha, deploymentId: deployment.id };
  }
  throw new Error('EXACT_HEAD_VERCEL_PREVIEW_NOT_READY');
}

async function main({ env = process.env, fetchImpl = globalThis.fetch, log = console.log, error = console.error } = {}) {
  try {
    const preview = await resolvePreview({ sha: env.EXPECTED_PR_HEAD_SHA, branch: env.EXPECTED_PR_HEAD_REF,
      repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN, fetchImpl });
    log(`PREVIEW_EXACT_HEAD_SHA=${preview.sha}`);
    log(`PREVIEW_GITHUB_DEPLOYMENT_ID=${preview.deploymentId}`);
    await verifyPreviewRuntime({ baseUrl: preview.origin, verifiedCommitOrigin: preview.origin, env, fetchImpl, log });
    return 0;
  } catch (reason) {
    error(`PREVIEW_RUNTIME_FAILED=${reason.message}`);
    return 1;
  }
}

if (require.main === module) main().then(status => { process.exitCode = status; });
module.exports = { COMMIT_PREVIEW_HOST, commitPreviewOrigin, resolvePreview, main };
