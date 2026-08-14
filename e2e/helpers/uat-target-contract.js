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

function validateSourceBranch(value) {
  const branch = String(value || '');
  if (
    !branch
    || branch.startsWith('-')
    || branch.startsWith('refs/')
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.endsWith('.')
    || branch.includes('..')
    || branch.includes('//')
    || branch.includes('@{')
    || /[\u0000-\u0020~^:?*\[\]\\]/.test(branch)
    || !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    throw contractError('UAT_SOURCE_BRANCH_INVALID');
  }
  return branch;
}

function validateSourceBranchHead({ sourceBranch, remoteSourceSha, sourceSha }) {
  const branch = validateSourceBranch(sourceBranch);
  const remote = assertGitSha(remoteSourceSha, 'UAT_REMOTE_SOURCE_SHA_INVALID');
  const expected = assertGitSha(sourceSha, 'UAT_SOURCE_SHA_INVALID');
  if (remote !== expected) throw contractError('UAT_SOURCE_BRANCH_SHA_MISMATCH');
  return { valid: true, sourceBranch: branch, sourceSha: expected };
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

function extractDeploymentHostname(deployment) {
  const rawUrl = String(deployment?.url || '');
  if (!rawUrl) throw contractError('UAT_DEPLOYMENT_URL_MISSING');
  let parsed;
  try {
    parsed = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw contractError('UAT_DEPLOYMENT_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/') {
    throw contractError('UAT_DEPLOYMENT_URL_INVALID');
  }
  return parsed.hostname.toLowerCase();
}

function validateDeploymentGitRef(deployment, expectedGitRef) {
  const expectedRef = String(expectedGitRef || '').trim();
  if (!expectedRef) return;
  const refs = [deployment?.meta?.githubCommitRef, deployment?.gitSource?.ref]
    .filter((value) => typeof value === 'string' && value.length > 0);
  if (refs.length === 0) throw contractError('UAT_DEPLOYMENT_GIT_REF_MISSING');
  if (new Set(refs).size !== 1) throw contractError('UAT_DEPLOYMENT_GIT_REF_CONFLICT');
  if (refs[0] !== expectedRef) throw contractError('UAT_DEPLOYMENT_GIT_REF_MISMATCH');
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

function validateHarnessIdentity({ harnessSha, checkoutSha, approvedHarnessSha }) {
  const expected = assertGitSha(harnessSha, 'UAT_HARNESS_SHA_INVALID');
  const checkout = assertGitSha(checkoutSha, 'UAT_CHECKOUT_SHA_INVALID');
  const approved = assertGitSha(approvedHarnessSha, 'UAT_APPROVED_HARNESS_SHA_INVALID');
  if (checkout !== expected || approved !== expected) throw contractError('UAT_HARNESS_SHA_MISMATCH');
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

function validateDeploymentRecord(deployment, {
  expectedDeploymentId,
  applicationSha,
  expectedProjectId,
  expectedProjectName,
  expectedGitRef
}) {
  if (!deployment || typeof deployment !== 'object') throw contractError('UAT_DEPLOYMENT_RECORD_INVALID');
  if (!DEPLOYMENT_ID.test(String(expectedDeploymentId || ''))) throw contractError('UAT_EXPECTED_DEPLOYMENT_ID_INVALID');
  const expectedSha = assertGitSha(applicationSha, 'UAT_APPLICATION_SHA_INVALID');

  if (deployment.id !== expectedDeploymentId) throw contractError('UAT_DEPLOYMENT_ID_MISMATCH');
  extractDeploymentHostname(deployment);
  if (deployment.name !== expectedProjectName) throw contractError('UAT_DEPLOYMENT_PROJECT_NAME_MISMATCH');
  if (!deployment.projectId) throw contractError('UAT_DEPLOYMENT_PROJECT_ID_MISSING');
  if (deployment.projectId !== expectedProjectId) throw contractError('UAT_DEPLOYMENT_PROJECT_ID_MISMATCH');
  if (deployment.target !== 'production') throw contractError('UAT_DEPLOYMENT_TARGET_NOT_PRODUCTION');
  if (deployment.readyState !== 'READY') throw contractError('UAT_DEPLOYMENT_NOT_READY');
  if (extractApplicationSha(deployment) !== expectedSha) throw contractError('UAT_APPLICATION_SHA_MISMATCH');
  validateDeploymentGitRef(deployment, expectedGitRef);

  return {
    valid: true,
    deploymentId: deployment.id,
    applicationSha: expectedSha,
    hostname: extractDeploymentHostname(deployment)
  };
}

function validateTargetIdentity({
  targetMode,
  targetUrl,
  expectedDeploymentId,
  applicationSha,
  targetDeployment,
  expectedDeployment,
  expectedProjectId,
  expectedProjectName,
  expectedGitRef
}) {
  const scope = validateTargetScope(targetMode, targetUrl);
  validateDeploymentRecord(targetDeployment, {
    expectedDeploymentId,
    applicationSha,
    expectedProjectId,
    expectedProjectName,
    expectedGitRef
  });
  validateDeploymentRecord(expectedDeployment, {
    expectedDeploymentId,
    applicationSha,
    expectedProjectId,
    expectedProjectName,
    expectedGitRef
  });
  if (extractDeploymentHostname(targetDeployment) !== scope.host) {
    throw contractError('UAT_TARGET_DEPLOYMENT_HOST_MISMATCH');
  }
  if (extractDeploymentHostname(expectedDeployment) !== scope.host) {
    throw contractError('UAT_EXPECTED_DEPLOYMENT_HOST_MISMATCH');
  }
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

if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'scope') {
      const [targetMode, targetUrl] = args;
      const result = validateTargetScope(targetMode, targetUrl);
      process.stdout.write(`UAT_TARGET_SCOPE=PASS mode=${result.mode} host=${result.host}\n`);
    } else if (command === 'harness') {
      const [harnessSha, checkoutSha, approvedHarnessSha] = args;
      const result = validateHarnessIdentity({ harnessSha, checkoutSha, approvedHarnessSha });
      process.stdout.write(`UAT_HARNESS_IDENTITY=PASS sha=${result.harnessSha}\n`);
    } else if (command === 'source-branch') {
      const [sourceBranch] = args;
      const result = validateSourceBranch(sourceBranch);
      process.stdout.write(`UAT_SOURCE_BRANCH=PASS branch=${result}\n`);
    } else if (command === 'source-head') {
      const [sourceBranch, remoteSourceSha, sourceSha] = args;
      const result = validateSourceBranchHead({ sourceBranch, remoteSourceSha, sourceSha });
      process.stdout.write(`UAT_SOURCE_BRANCH_HEAD=PASS branch=${result.sourceBranch} sha=${result.sourceSha}\n`);
    } else if (command === 'verify') {
      const [targetMode, targetUrl, expectedDeploymentId, applicationSha, targetFile, expectedFile, expectedProjectId, expectedProjectName, expectedGitRef] = args;
      const result = validateTargetIdentity({
        targetMode,
        targetUrl,
        expectedDeploymentId,
        applicationSha,
        targetDeployment: readJson(targetFile),
        expectedDeployment: readJson(expectedFile),
        expectedProjectId,
        expectedProjectName,
        expectedGitRef
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

module.exports = {
  CANONICAL_HOST,
  CANDIDATE_HOST,
  contractError,
  extractApplicationSha,
  extractDeploymentHostname,
  normalizeTargetMode,
  parseTargetUrl,
  validateDeploymentRecord,
  validateDeploymentGitRef,
  validateHarnessIdentity,
  validateSourceBranch,
  validateSourceBranchHead,
  validateTargetIdentity,
  validateTargetScope
};
