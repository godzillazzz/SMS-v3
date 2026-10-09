'use strict';
const { PROJECT_ID, TEAM_ID, previewUrl, fail } = require('../../e2e/uat-v3/config');
const { resolvePreview } = require('./verify-integration-pr-preview');
const { normalizeDeploymentIdentity } = require('../../e2e/uat-v3/vercel-identity');
async function verifyPreview(fetcher = fetch, env = process.env, resolve = resolvePreview) {
  const origin = previewUrl(env.UAT_BASE_URL);
  if (!env.VERCEL_TOKEN || !/^dpl_[A-Za-z0-9]+$/.test(env.UAT_EXPECTED_DEPLOYMENT_ID || '') || !/^[a-f0-9]{40}$/.test(env.UAT_SOURCE_SHA || '')) fail('UAT_PREVIEW_CONFIGURATION_REQUIRED');
  const url = new URL(`https://api.vercel.com/v13/deployments/${env.UAT_EXPECTED_DEPLOYMENT_ID}`);
  url.searchParams.set('teamId', TEAM_ID); url.searchParams.set('withGitRepoInfo', 'true');
  const response = await fetcher(url, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(15000) });
  if (response.status !== 200) fail('UAT_PREVIEW_IDENTITY_FAILED');
  const raw = await response.json(); const identity = normalizeDeploymentIdentity(raw);
  const sha = identity.meta?.githubCommitSha || identity.gitSource?.sha;
  const ref = identity.meta?.githubCommitRef || identity.gitSource?.ref;
  if (identity.id !== env.UAT_EXPECTED_DEPLOYMENT_ID || identity.projectId !== PROJECT_ID || (raw.ownerId || raw.teamId) !== TEAM_ID || identity.readyState !== 'READY' || identity.target === 'production' || identity.environment === 'production' || sha !== env.UAT_SOURCE_SHA || ref !== env.UAT_SOURCE_BRANCH || 'https://' + identity.url !== origin) fail('UAT_PREVIEW_IDENTITY_FAILED');
  // Never infer Preview from an absent Vercel target. Reuse the existing
  // authoritative Vercel-bot GitHub deployment environment contract instead.
  const nativePreview = await resolve({ sha: env.UAT_SOURCE_SHA, branch: env.UAT_SOURCE_BRANCH, repository: 'godzillazzz/SMS-v3', token: env.GITHUB_TOKEN, fetchImpl: fetcher });
  if (nativePreview.origin !== origin || nativePreview.sha !== sha) fail('UAT_PREVIEW_ENVIRONMENT_UNVERIFIED');
  if (identity.aliases?.some((alias) => ['sms-v3-staging-ten.vercel.app', 'sms-v3-staging-godzillazzz.vercel.app'].includes(alias))) fail('UAT_CANONICAL_TARGET_FORBIDDEN');
  return { deployment: identity.id, project: PROJECT_ID, sha, ref, state: 'READY', environment: 'preview' };
}
if (require.main === module) verifyPreview().then((evidence) => process.stdout.write(JSON.stringify(evidence) + '\n')).catch(() => { process.stderr.write('UAT_PREVIEW_IDENTITY_FAILED\n'); process.exitCode = 1; });
module.exports = { verifyPreview };
