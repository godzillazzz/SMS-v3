'use strict';

const EXPECTED = Object.freeze({
  previewUrl: 'https://sms-v3-staging-cdudcqwl5-godzillazz.vercel.app',
  deploymentId: 'dpl_CrAgeJxHdqaq2FBziFTPGuBB3w9v',
  projectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  teamId: 'team_nemCExHbZ8EAhSgsvefHPAEz',
  controlSha: 'e3ff848f0b5aa0e8f15887bef02ce81e6a9b165b',
  sourceBranch: 'fix/serverless-database-reliability',
  frozenApplicationSha: '77641a2657aa4fd05276afe645dd32648f5cc56b',
  untrustedOrigin: 'https://untrusted.invalid'
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertFixedInputs(env) {
  if (env.PREVIEW_URL !== EXPECTED.previewUrl) fail('PREVIEW_URL_MISMATCH');
  if (env.EXPECTED_DEPLOYMENT_ID !== EXPECTED.deploymentId) fail('DEPLOYMENT_ID_INPUT_MISMATCH');
  if (env.CONTROL_SHA !== EXPECTED.controlSha) fail('CONTROL_SHA_INPUT_MISMATCH');
  if (env.SOURCE_BRANCH !== EXPECTED.sourceBranch) fail('SOURCE_BRANCH_INPUT_MISMATCH');
  if (env.FROZEN_APPLICATION_SHA !== EXPECTED.frozenApplicationSha) fail('APPLICATION_SHA_INPUT_MISMATCH');
  if (!env.VERCEL_TOKEN) fail('VERCEL_TOKEN_MISSING');
  if (!env.VERCEL_AUTOMATION_BYPASS_SECRET) fail('PREVIEW_PROTECTION_CREDENTIAL_MISSING');
}

async function readJson(response, code) {
  try {
    return await response.json();
  } catch {
    fail(code);
  }
}

async function request(fetchImpl, url, method, headers) {
  try {
    return await fetchImpl(url, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    fail(method === 'GET' && url.startsWith('https://api.vercel.com/')
      ? 'VERCEL_API_GET_FAILED'
      : 'PREVIEW_REQUEST_FAILED');
  }
}

function actualPreviewHostname(value) {
  try {
    const url = new URL(value.startsWith('https://') ? value : 'https://' + value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
        || url.search || url.hash) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function verifyDeploymentIdentity(env, fetchImpl) {
  const projectUrl = 'https://api.vercel.com/v9/projects/' + encodeURIComponent(EXPECTED.projectId)
    + '?teamId=' + encodeURIComponent(EXPECTED.teamId);
  const projectResponse = await request(fetchImpl, projectUrl, 'GET', {
    Authorization: 'Bearer ' + env.VERCEL_TOKEN,
    Accept: 'application/json'
  });
  if (projectResponse.status !== 200) fail('VERCEL_PROJECT_GET_NOT_200');
  const project = await readJson(projectResponse, 'VERCEL_PROJECT_JSON_INVALID');
  if (project.id !== EXPECTED.projectId || project.accountId !== EXPECTED.teamId) {
    fail('VERCEL_PROJECT_OR_TEAM_MISMATCH');
  }
  if (typeof project.autoAssignCustomDomains !== 'boolean' || project.autoAssignCustomDomains !== false) {
    fail('AUTO_ASSIGN_CUSTOM_DOMAINS_NOT_VERIFIED_FALSE');
  }

  const deploymentUrl = 'https://api.vercel.com/v13/deployments/'
    + encodeURIComponent(EXPECTED.deploymentId) + '?teamId=' + encodeURIComponent(EXPECTED.teamId)
    + '&withGitRepoInfo=true';
  const deploymentResponse = await request(fetchImpl, deploymentUrl, 'GET', {
    Authorization: 'Bearer ' + env.VERCEL_TOKEN,
    Accept: 'application/json'
  });
  if (deploymentResponse.status !== 200) fail('VERCEL_DEPLOYMENT_GET_NOT_200');
  const deployment = await readJson(deploymentResponse, 'VERCEL_DEPLOYMENT_JSON_INVALID');
  const meta = deployment.meta || {};
  if (deployment.id !== EXPECTED.deploymentId || deployment.projectId !== EXPECTED.projectId
      || deployment.target !== null
      || (deployment.readyState || deployment.state) !== 'READY'
      || actualPreviewHostname(deployment.url) !== new URL(EXPECTED.previewUrl).hostname
      || meta.githubCommitSha !== EXPECTED.controlSha
      || meta.githubCommitRef !== EXPECTED.sourceBranch
      || meta.githubOrg !== 'godzillazzz'
      || meta.githubRepo !== 'SMS-v3'
      || (deployment.ownerId && deployment.ownerId !== EXPECTED.teamId)) {
    fail('VERCEL_DEPLOYMENT_IDENTITY_MISMATCH');
  }
  return { projectId: project.id, teamId: project.accountId, deploymentId: deployment.id };
}

function headerList(headers, name) {
  return String(headers.get(name) || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
}

async function verifyRuntimeAndCors(env, fetchImpl, log) {
  const origin = new URL(EXPECTED.previewUrl).origin;
  const bypass = { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET };

  const health = await request(fetchImpl, origin + '/api/v1/health', 'GET', bypass);
  if (health.status !== 200) fail('PREVIEW_HEALTH_NOT_200');
  const healthBody = await readJson(health, 'PREVIEW_HEALTH_JSON_INVALID');
  if (healthBody.status !== 'ok') fail('PREVIEW_HEALTH_BODY_INVALID');
  log('PREVIEW_HEALTH=PASS HTTP=200');

  const ready = await request(fetchImpl, origin + '/api/v1/ready', 'GET', bypass);
  if (ready.status !== 200) fail('PREVIEW_READINESS_NOT_200');
  const readyBody = await readJson(ready, 'PREVIEW_READINESS_JSON_INVALID');
  if (readyBody.status !== 'ready' || readyBody.database !== 'ok') {
    fail('PREVIEW_DATABASE_READINESS_INVALID');
  }
  log('PREVIEW_DATABASE_READINESS=PASS HTTP=200 DATABASE=ok');

  const preflightHeaders = {
    ...bypass,
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type'
  };
  const trusted = await request(fetchImpl, origin + '/api/v1/auth/login', 'OPTIONS', preflightHeaders);
  if (trusted.status !== 204
      || trusted.headers.get('access-control-allow-origin') !== origin
      || trusted.headers.get('access-control-allow-credentials') !== 'true'
      || !headerList(trusted.headers, 'access-control-allow-methods').includes('post')
      || !headerList(trusted.headers, 'access-control-allow-headers').includes('authorization')
      || !headerList(trusted.headers, 'access-control-allow-headers').includes('content-type')) {
    fail('PREVIEW_TRUSTED_CORS_FAILED');
  }
  log('PREVIEW_TRUSTED_CORS=PASS HTTP=204 ALLOW_ORIGIN=' + origin
    + ' ALLOW_CREDENTIALS=true ALLOW_METHOD=POST ALLOW_HEADERS=authorization,content-type');

  const untrusted = await request(fetchImpl, origin + '/api/v1/auth/login', 'OPTIONS', {
    ...bypass,
    Origin: EXPECTED.untrustedOrigin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type'
  });
  if (untrusted.status !== 403 || untrusted.headers.get('access-control-allow-origin') !== null) {
    fail('PREVIEW_UNTRUSTED_CORS_FAILED');
  }
  log('PREVIEW_UNTRUSTED_CORS=PASS HTTP=403 ALLOW_ORIGIN=absent');
}

async function verifyR5BPreviewCors({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  assertFixedInputs(env);
  const identity = await verifyDeploymentIdentity(env, fetchImpl);
  log('PREVIEW_IDENTITY=PASS PROJECT=' + identity.projectId
    + ' TEAM=' + identity.teamId + ' DEPLOYMENT=' + identity.deploymentId
    + ' CONTROL_SHA=' + EXPECTED.controlSha);
  log('VERCEL_CONFIG=PASS AUTO_ASSIGN_CUSTOM_DOMAINS=false');
  await verifyRuntimeAndCors(env, fetchImpl, log);
  log('BUSINESS_MUTATIONS=NOT_EXECUTED METHODS=GET,OPTIONS');
  return { identity: 'PASS', health: 'PASS', readinessDatabase: 'PASS', trustedCors: 'PASS', untrustedCors: 'PASS' };
}

if (require.main === module) {
  verifyR5BPreviewCors().catch((error) => {
    console.error('R5B_PREVIEW_READONLY_CHECK=FAIL_' + (error?.code || 'UNEXPECTED'));
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED, verifyR5BPreviewCors };
