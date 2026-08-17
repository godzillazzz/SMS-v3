const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateHarnessIdentity,
  validateSourceBranch,
  validateSourceBranchHead,
  validateTargetIdentity,
  validateTargetScope
} = require('../e2e/helpers/uat-target-contract');

const APPLICATION_SHA = 'e672c704c76c9fd53049b89736d56283029da1ea';
const DEPLOYMENT_ID = 'dpl_BXdWNdwFr2MzzPAgtWgyXz7faAuS';
const PROJECT_ID = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
const PROJECT_NAME = 'sms-v3-staging';
const CANDIDATE_URL = 'https://sms-v3-staging-cezup20q5-godzillazz.vercel.app';
const CANONICAL_URL = 'https://sms-v3-staging-ten.vercel.app';
const HARNESS_SHA = '1234567890abcdef1234567890abcdef12345678';
const SOURCE_BRANCH = 'feat/unified-report-center-v1';
const SOURCE_SHA = '725eebc2764168fc5c5d312d53e9b641eef7b803';

function deployment(overrides = {}) {
  return {
    id: DEPLOYMENT_ID,
    url: CANDIDATE_URL.replace(/^https:\/\//, ''),
    name: PROJECT_NAME,
    projectId: PROJECT_ID,
    target: 'production',
    readyState: 'READY',
    meta: { githubCommitSha: APPLICATION_SHA },
    ...overrides
  };
}

function verify(overrides = {}) {
  return validateTargetIdentity({
    targetMode: 'candidate',
    targetUrl: CANDIDATE_URL,
    expectedDeploymentId: DEPLOYMENT_ID,
    applicationSha: APPLICATION_SHA,
    targetDeployment: deployment(),
    expectedDeployment: deployment(),
    expectedProjectId: PROJECT_ID,
    expectedProjectName: PROJECT_NAME,
    ...overrides
  });
}

test('1. correct Candidate URL plus expected deployment passes', () => {
  assert.equal(verify().valid, true);
});

test('2. wrong Candidate deployment fails closed', () => {
  assert.throws(
    () => verify({ targetDeployment: deployment({ id: 'dpl_WrongCandidate123' }) }),
    { code: 'UAT_DEPLOYMENT_ID_MISMATCH' }
  );
});

test('3. correct Canonical URL plus expected promoted deployment passes', () => {
  const canonicalDeployment = deployment({ url: CANONICAL_URL.replace(/^https:\/\//, '') });
  assert.equal(verify({
    targetMode: 'canonical',
    targetUrl: CANONICAL_URL,
    targetDeployment: canonicalDeployment,
    expectedDeployment: canonicalDeployment
  }).valid, true);
});

test('4. Canonical resolving to unexpected deployment fails closed', () => {
  assert.throws(
    () => verify({
      targetMode: 'canonical',
      targetUrl: CANONICAL_URL,
      targetDeployment: deployment({ id: 'dpl_UnexpectedCanonical123', url: CANONICAL_URL.replace(/^https:\/\//, '') }),
      expectedDeployment: deployment({ url: CANONICAL_URL.replace(/^https:\/\//, '') })
    }),
    { code: 'UAT_DEPLOYMENT_ID_MISMATCH' }
  );
});

test('5. correct deployment with wrong Application SHA fails closed', () => {
  assert.throws(
    () => verify({
      targetDeployment: deployment({ meta: { githubCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } })
    }),
    { code: 'UAT_DEPLOYMENT_APPLICATION_SHA_MISMATCH' }
  );
});

test('6. wrong harness SHA fails closed', () => {
  assert.throws(
    () => validateHarnessIdentity({
      harnessSha: HARNESS_SHA,
      checkoutSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      approvedHarnessSha: HARNESS_SHA
    }),
    { code: 'UAT_HARNESS_SHA_MISMATCH' }
  );
  assert.throws(
    () => validateHarnessIdentity({
      harnessSha: HARNESS_SHA,
      checkoutSha: HARNESS_SHA,
      approvedHarnessSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    }),
    { code: 'UAT_HARNESS_SHA_MISMATCH' }
  );
});

test('7. unapproved hostname fails closed', () => {
  assert.throws(
    () => validateTargetScope('candidate', 'https://example.vercel.app'),
    { code: 'UAT_CANDIDATE_HOST_NOT_APPROVED' }
  );
  assert.throws(
    () => validateTargetScope('canonical', 'https://sms-v3-staging-other.vercel.app'),
    { code: 'UAT_CANONICAL_HOST_NOT_APPROVED' }
  );
});

test('trusted harness is bound to checkout and approved branch head SHA', () => {
  assert.equal(validateHarnessIdentity({
    harnessSha: HARNESS_SHA,
    checkoutSha: HARNESS_SHA,
    approvedHarnessSha: HARNESS_SHA
  }).valid, true);
});

test('candidate and canonical modes are distinct rather than hostname aliases', () => {
  assert.equal(validateTargetScope('candidate', CANDIDATE_URL).mode, 'candidate');
  assert.equal(validateTargetScope('canonical', CANONICAL_URL).mode, 'canonical');
  assert.throws(() => validateTargetScope('candidate', CANONICAL_URL), { code: 'UAT_CANDIDATE_HOST_NOT_APPROVED' });
});

test('declared application branch HEAD and source SHA pass together', () => {
  assert.deepEqual(validateSourceBranchHead({
    sourceBranch: SOURCE_BRANCH,
    remoteSourceSha: SOURCE_SHA,
    sourceSha: SOURCE_SHA
  }), { valid: true, sourceBranch: SOURCE_BRANCH, sourceSha: SOURCE_SHA });
});

test('source branch SHA mismatch fails closed', () => {
  assert.throws(
    () => validateSourceBranchHead({
      sourceBranch: SOURCE_BRANCH,
      remoteSourceSha: SOURCE_SHA,
      sourceSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }),
    { code: 'UAT_SOURCE_BRANCH_SHA_MISMATCH' }
  );
});

test('different valid branch identity fails closed', () => {
  assert.throws(
    () => validateSourceBranchHead({
      sourceBranch: 'fix/serverless-database-reliability',
      remoteSourceSha: 'e672c704c76c9fd53049b89736d56283029da1ea',
      sourceSha: SOURCE_SHA
    }),
    { code: 'UAT_SOURCE_BRANCH_SHA_MISMATCH' }
  );
});

test('missing remote branch identity fails closed', () => {
  assert.throws(
    () => validateSourceBranchHead({
      sourceBranch: 'does-not-exist',
      remoteSourceSha: '',
      sourceSha: SOURCE_SHA
    }),
    { code: 'UAT_REMOTE_SOURCE_SHA_INVALID' }
  );
});

test('malformed source branch ref fails closed', () => {
  for (const sourceBranch of ['', '-bad', 'refs/heads/main', 'bad branch', 'bad..branch', 'bad@{ref}']) {
    assert.throws(() => validateSourceBranch(sourceBranch), { code: 'UAT_SOURCE_BRANCH_INVALID' });
  }
});
