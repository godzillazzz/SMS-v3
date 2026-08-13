const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateHarnessIdentity,
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

function deployment(overrides = {}) {
  return {
    id: DEPLOYMENT_ID,
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
  assert.equal(verify({ targetMode: 'canonical', targetUrl: CANONICAL_URL }).valid, true);
});

test('4. Canonical resolving to unexpected deployment fails closed', () => {
  assert.throws(
    () => verify({
      targetMode: 'canonical',
      targetUrl: CANONICAL_URL,
      targetDeployment: deployment({ id: 'dpl_UnexpectedCanonical123' })
    }),
    { code: 'UAT_DEPLOYMENT_ID_MISMATCH' }
  );
});

test('5. correct deployment with wrong Application SHA fails closed', () => {
  assert.throws(
    () => verify({
      targetDeployment: deployment({ meta: { githubCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } })
    }),
    { code: 'UAT_APPLICATION_SHA_MISMATCH' }
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
