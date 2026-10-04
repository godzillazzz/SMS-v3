'use strict';

const EXPECTED_HOST = 'sms-v3-staging-git-codex-g06-time-policy-20261002-godzillazz.vercel.app';
const EXPECTED_PROJECT_ID = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
const EXPECTED_TEAM_ID = 'team_nemCExHbZ8EAhSgsvefHPAEz';
const EXPECTED_SOURCE_SHA = 'e12c28c339c6d420c6db13b02aa1ddffb2c3e5ba';
const EXPECTED_SOURCE_REF = 'codex/g06-time-policy-20261002';

function safeFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function deploymentSource(payload) {
  return {
    projectId: typeof payload?.projectId === 'string' ? payload.projectId : '',
    deploymentId: typeof payload?.uid === 'string' ? payload.uid : typeof payload?.id === 'string' ? payload.id : '',
    target: typeof payload?.target === 'string' ? payload.target : '',
    state: typeof payload?.readyState === 'string' ? payload.readyState : typeof payload?.state === 'string' ? payload.state : '',
    sourceSha: typeof payload?.meta?.githubCommitSha === 'string' ? payload.meta.githubCommitSha : '',
    sourceRef: typeof payload?.meta?.githubCommitRef === 'string' ? payload.meta.githubCommitRef : '',
  };
}

function validateDeployment(payload) {
  const identity = deploymentSource(payload);
  if (identity.projectId !== EXPECTED_PROJECT_ID) throw safeFailure('VERCEL_PROJECT_ID_MISMATCH');
  if (!/^dpl_[A-Za-z0-9]+$/.test(identity.deploymentId)) throw safeFailure('VERCEL_DEPLOYMENT_ID_INVALID');
  if (identity.target !== 'preview') throw safeFailure('VERCEL_TARGET_NOT_PREVIEW');
  if (identity.state !== 'READY') throw safeFailure('VERCEL_DEPLOYMENT_NOT_READY');
  if (identity.sourceSha !== EXPECTED_SOURCE_SHA) throw safeFailure('VERCEL_SOURCE_SHA_MISMATCH');
  if (identity.sourceRef !== EXPECTED_SOURCE_REF) throw safeFailure('VERCEL_SOURCE_REF_MISMATCH');
  return identity;
}

async function verifyPreviewDeployment({ env = process.env, fetchImpl = fetch, log = console.log, outputPath = process.env.GITHUB_OUTPUT } = {}) {
  if (!env.VERCEL_TOKEN) throw safeFailure('VERCEL_TOKEN_MISSING');
  if (env.VERCEL_PROJECT_ID !== EXPECTED_PROJECT_ID) throw safeFailure('VERCEL_PROJECT_ID_MISMATCH');
  if (env.VERCEL_ORG_ID !== EXPECTED_TEAM_ID) throw safeFailure('VERCEL_ORG_ID_MISMATCH');

  const endpoint = new URL(`/v13/deployments/${EXPECTED_HOST}`, 'https://api.vercel.com');
  endpoint.searchParams.set('teamId', EXPECTED_TEAM_ID);
  endpoint.searchParams.set('withGitRepoInfo', 'true');
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw safeFailure('VERCEL_LOOKUP_FAILED');
  }
  if (!response.ok) throw safeFailure(`VERCEL_LOOKUP_HTTP_${response.status}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw safeFailure('VERCEL_RESPONSE_INVALID');
  }

  const identity = validateDeployment(payload);
  const lines = [
    `preview_deployment_id=${identity.deploymentId}`,
    'preview_project_identity=PASS',
    'preview_source_identity=PASS',
    'preview_target=PREVIEW',
    'preview_ready=PASS',
  ];
  log(`PREVIEW_DEPLOYMENT_ID=${identity.deploymentId}`);
  log('PREVIEW_PROJECT_ID_MATCH=PASS');
  log('PREVIEW_NATIVE_SOURCE_SHA_MATCH=PASS');
  log('PREVIEW_NATIVE_SOURCE_REF_MATCH=PASS');
  log('PREVIEW_TARGET=PREVIEW');
  log('PREVIEW_READY=PASS');
  log('RAW_VERCEL_RESPONSE_EMITTED=false');
  if (outputPath) require('node:fs').appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
  return identity;
}

async function main() {
  try {
    await verifyPreviewDeployment();
    return 0;
  } catch (error) {
    const code = /^[A-Z0-9_]{1,64}$/.test(error?.code || '') ? error.code : 'VERCEL_LOOKUP_FAILED';
    console.error(`G06 Preview deployment verification failed closed: ${code}`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  EXPECTED_HOST,
  EXPECTED_PROJECT_ID,
  EXPECTED_SOURCE_REF,
  EXPECTED_SOURCE_SHA,
  EXPECTED_TEAM_ID,
  deploymentSource,
  validateDeployment,
  verifyPreviewDeployment,
};
