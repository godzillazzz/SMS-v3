const fs = require('node:fs');

const CANONICAL_HOST = 'sms-v3-staging-ten.vercel.app';
const CANDIDATE_HOST = /^sms-v3-staging-[a-z0-9]+-[a-z0-9-]+\.vercel\.app$/i;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
const GIT_SHA = /^[0-9a-f]{40}$/i;
const TARGET_MODES = new Set(['candidate', 'canonical']);

function contractError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertGitSha(value, code) {
  if (!GIT_SHA.test(String(value || ''))) throw contractError(code);
  return String(value).toLowerCase();
}

function normalizeTargetMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!TARGET_MODES.has(mode)) throw contractError('UAT_TARGET_MODE_INVALID');
  return mode;
}

function parseTargetUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw contractError('UAT_TARGET_URL_INVALID');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || (parsed.pathname && parsed.pathname !== '/')
    || parsed.search
    || parsed.hash
  ) {
    throw contractError('UAT_TARGET_URL_INVALID');
  }
  return parsed;
}

function validateTargetScope(targetMode, targetUrl) {
  const mode = normalizeTargetMode(targetMode);
  const parsed = parseTargetUrl(targetUrl);
  const host = parsed.hostname.toLowerCase();

  if (mode === 'canonical') {
    if (host !== CANONICAL_HOST) throw contractError('UAT_CANONICAL_HOST_NOT_APPROVED');
  } else if (host === CANONICAL_HOST || !CANDIDATE_HOST.test(host)) {
    throw contractError('UAT_CANDIDATE_HOST_NOT_APPROVED');
  }

  return { mode, host, url: `https://${host}` };
}

function validateHarnessIdentity({ harnessSha, checkoutSha, githubRefType, githubRefName }) {
  const expected = assertGitSha(harnessSha, 'UAT_HARNESS_SHA_INVALID');
  const checkout = assertGitSha(checkoutSha, 'UAT_CHECKOUT_SHA_INVALID');
  if (checkout !== expected) throw contractError('UAT_HARNESS_SHA_MISMATCH');
  if (githubRefType !== 'tag') throw contractError('UAT_HARNESS_REF_NOT_TRUSTED_TAG');
  if (githubRefName !== `uat-harness-v3-${expected}`) throw contractError('UAT_HARNESS_REF_MISMATCH');
  return { valid: true, harnessSha: expected };
}

function extractApplicationSha(deployment) {
  const raw = [
    deployment?.meta?.githubCommitSha,
    deployment?.gitSource?.sha,
    deployment?.source?.sha
  ].filter((value) => typeof value === 'string' && GIT_SHA.test(value));
  const values = [...new Set(raw.map((value) => value.toLowerCase()))];
  if (values.length === 0) throw contractError('UAT_DEPLOYMENT_APPLICATION_SHA_MISSING');
  if (values.length !== 1) throw contractError('UAT_DEPLOYMENT_APPLICATION_SHA_CONFLICT');
  return values[0];
}

function selectDeploymentIdentityRecord(deployment) {
  if (!deployment || typeof deployment !== 'object') throw contractError('UAT_DEPLOYMENT_RECORD_INVALID');
  const selected = {
    id: deployment.id,
    name: deployment.name,
    projectId: deployment.projectId,
    target: deployment.target,
    readyState: deployment.readyState,
    url: deployment.url
  };
  if (typeof deployment?.meta?.githubCommitSha === 'string') {
    selected.meta = { githubCommitSha: deployment.meta.githubCommitSha };
  }
  if (typeof deployment?.gitSource?.sha === 'string') {
    selected.gitSource = { sha: deployment.gitSource.sha };
  }
  if (typeof deployment?.source?.sha === 'string') {
    selected.source = { sha: deployment.source.sha };
  }
  return selected;
}

async function fetchDeploymentRecord({ idOrUrl, token, teamId, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== 'function') throw contractError('UAT_VERCEL_FETCH_UNAVAILABLE');
  if (!String(token || '').trim()) throw contractError('UAT_VERCEL_TOKEN_MISSING');
  if (!String(teamId || '').trim()) throw contractError('UAT_VERCEL_TEAM_ID_MISSING');

  let lookup;
  const raw = String(idOrUrl || '').trim();
  if (DEPLOYMENT_ID.test(raw)) {
    lookup = raw;
  } else {
    lookup = parseTargetUrl(raw).hostname.toLowerCase();
  }

  const endpoint = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(lookup)}`);
  endpoint.searchParams.set('teamId', teamId);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'sms-v3-uat-target-contract'
      }
    });
  } catch {
    throw contractError('UAT_VERCEL_DEPLOYMENT_LOOKUP_FAILED');
  }
  if (!response?.ok) throw contractError('UAT_VERCEL_DEPLOYMENT_LOOKUP_FAILED');

  let deployment;
  try {
    deployment = await response.json();
  } catch {
    throw contractError('UAT_VERCEL_DEPLOYMENT_JSON_INVALID');
  }
  return selectDeploymentIdentityRecord(deployment);
}

function validateDeploymentRecord(deployment, {
  expectedDeploymentId,
  applicationSha,
  expectedProjectId,
  expectedProjectName
}) {
  if (!deployment || typeof deployment !== 'object') throw contractError('UAT_DEPLOYMENT_RECORD_INVALID');
  if (!DEPLOYMENT_ID.test(String(expectedDeploymentId || ''))) throw contractError('UAT_EXPECTED_DEPLOYMENT_ID_INVALID');
  const expectedSha = assertGitSha(applicationSha, 'UAT_APPLICATION_SHA_INVALID');

  if (deployment.id !== expectedDeploymentId) throw contractError('UAT_DEPLOYMENT_ID_MISMATCH');
  if (deployment.name !== expectedProjectName) throw contractError('UAT_DEPLOYMENT_PROJECT_NAME_MISMATCH');
  if (deployment.projectId && deployment.projectId !== expectedProjectId) throw contractError('UAT_DEPLOYMENT_PROJECT_ID_MISMATCH');
  if (deployment.target !== 'production') throw contractError('UAT_DEPLOYMENT_TARGET_NOT_PRODUCTION');
  if (deployment.readyState !== 'READY') throw contractError('UAT_DEPLOYMENT_NOT_READY');
  if (extractApplicationSha(deployment) !== expectedSha) throw contractError('UAT_APPLICATION_SHA_MISMATCH');

  return { valid: true, deploymentId: deployment.id, applicationSha: expectedSha };
}

function validateTargetIdentity({
  targetMode,
  targetUrl,
  expectedDeploymentId,
  applicationSha,
  targetDeployment,
  expectedDeployment,
  expectedProjectId,
  expectedProjectName
}) {
  const scope = validateTargetScope(targetMode, targetUrl);
  validateDeploymentRecord(targetDeployment, {
    expectedDeploymentId,
    applicationSha,
    expectedProjectId,
    expectedProjectName
  });
  validateDeploymentRecord(expectedDeployment, {
    expectedDeploymentId,
    applicationSha,
    expectedProjectId,
    expectedProjectName
  });
  if (targetDeployment.id !== expectedDeployment.id) throw contractError('UAT_TARGET_DEPLOYMENT_IDENTITY_MISMATCH');
  return {
    valid: true,
    targetMode: scope.mode,
    targetHost: scope.host,
    deploymentId: expectedDeploymentId,
    applicationSha: String(applicationSha).toLowerCase()
  };
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    throw contractError('UAT_DEPLOYMENT_INSPECT_JSON_INVALID');
  }
}

async function main() {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'scope') {
      const [targetMode, targetUrl] = args;
      const result = validateTargetScope(targetMode, targetUrl);
      process.stdout.write(`UAT_TARGET_SCOPE=PASS mode=${result.mode} host=${result.host}\n`);
    } else if (command === 'harness') {
      const [harnessSha, checkoutSha, githubRefType, githubRefName] = args;
      const result = validateHarnessIdentity({ harnessSha, checkoutSha, githubRefType, githubRefName });
      process.stdout.write(`UAT_HARNESS_IDENTITY=PASS sha=${result.harnessSha}\n`);
    } else if (command === 'fetch') {
      const [idOrUrl, outputFile, teamId] = args;
      if (!outputFile) throw contractError('UAT_VERCEL_OUTPUT_FILE_MISSING');
      const record = await fetchDeploymentRecord({
        idOrUrl,
        token: process.env.VERCEL_TOKEN,
        teamId
      });
      fs.writeFileSync(outputFile, JSON.stringify(record));
      process.stdout.write('UAT_VERCEL_DEPLOYMENT_LOOKUP=PASS\n');
    } else if (command === 'verify') {
      const [targetMode, targetUrl, expectedDeploymentId, applicationSha, targetFile, expectedFile, expectedProjectId, expectedProjectName] = args;
      const result = validateTargetIdentity({
        targetMode,
        targetUrl,
        expectedDeploymentId,
        applicationSha,
        targetDeployment: readJson(targetFile),
        expectedDeployment: readJson(expectedFile),
        expectedProjectId,
        expectedProjectName
      });
      process.stdout.write(`UAT_TARGET_IDENTITY=PASS mode=${result.targetMode} deployment=${result.deploymentId} application_sha=${result.applicationSha}\n`);
    } else {
      throw contractError('UAT_TARGET_CONTRACT_COMMAND_INVALID');
    }
  } catch (error) {
    process.stderr.write(`${error.code || error.message || 'UAT_TARGET_CONTRACT_FAILED'}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CANONICAL_HOST,
  CANDIDATE_HOST,
  contractError,
  extractApplicationSha,
  fetchDeploymentRecord,
  normalizeTargetMode,
  parseTargetUrl,
  selectDeploymentIdentityRecord,
  validateDeploymentRecord,
  validateHarnessIdentity,
  validateTargetIdentity,
  validateTargetScope
};
