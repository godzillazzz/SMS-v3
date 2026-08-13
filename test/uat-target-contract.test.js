const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchDeploymentRecord,
  selectDeploymentIdentityRecord,
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
const HARNESS_TAG = `uat-harness-v3-${HARNESS_SHA}`;

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

test('6. wrong harness SHA or untrusted harness ref fails closed', () => {
  assert.throws(
    () => validateHarnessIdentity({
      harnessSha: HARNESS_SHA,
      checkoutSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      githubRefType: 'tag',
      githubRefName: HARNESS_TAG
    }),
    { code: 'UAT_HARNESS_SHA_MISMATCH' }
  );
  assert.throws(
    () => validateHarnessIdentity({
      harnessSha: HARNESS_SHA,
      checkoutSha: HARNESS_SHA,
      githubRefType: 'branch',
      githubRefName: 'test/automated-uat-v3-authenticated'
    }),
    { code: 'UAT_HARNESS_REF_NOT_TRUSTED_TAG' }
  );
  assert.throws(
    () => validateHarnessIdentity({
      harnessSha: HARNESS_SHA,
      checkoutSha: HARNESS_SHA,
      githubRefType: 'tag',
      githubRefName: 'uat-harness-v3-wrong'
    }),
    { code: 'UAT_HARNESS_REF_MISMATCH' }
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

test('trusted harness is bound to immutable tag name and checkout SHA', () => {
  assert.equal(validateHarnessIdentity({
    harnessSha: HARNESS_SHA,
    checkoutSha: HARNESS_SHA,
    githubRefType: 'tag',
    githubRefName: HARNESS_TAG
  }).valid, true);
});

test('candidate and canonical modes are distinct rather than hostname aliases', () => {
  assert.equal(validateTargetScope('candidate', CANDIDATE_URL).mode, 'candidate');
  assert.equal(validateTargetScope('canonical', CANONICAL_URL).mode, 'canonical');
  assert.throws(() => validateTargetScope('candidate', CANONICAL_URL), { code: 'UAT_CANDIDATE_HOST_NOT_APPROVED' });
});

test('Vercel API identity selection retains only fields needed for fail-closed validation', () => {
  const selected = selectDeploymentIdentityRecord({
    ...deployment(),
    aliases: ['do-not-copy.example'],
    meta: { githubCommitSha: APPLICATION_SHA, githubCommitMessage: 'not needed' },
    creator: { uid: 'not-needed' }
  });
  assert.deepEqual(selected, {
    id: DEPLOYMENT_ID,
    name: PROJECT_NAME,
    projectId: PROJECT_ID,
    target: 'production',
    readyState: 'READY',
    url: undefined,
    meta: { githubCommitSha: APPLICATION_SHA }
  });
  assert.equal(JSON.stringify(selected).includes('githubCommitMessage'), false);
});

test('Vercel API lookup uses hostname/ID and never returns the bearer token', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers.Authorization });
    return { ok: true, json: async () => deployment() };
  };
  const record = await fetchDeploymentRecord({
    idOrUrl: CANONICAL_URL,
    token: 'secret-vercel-token',
    teamId: 'team_example',
    fetchImpl: fakeFetch
  });
  assert.equal(record.id, DEPLOYMENT_ID);
  assert.match(calls[0].url, /\/v13\/deployments\/sms-v3-staging-ten\.vercel\.app\?teamId=team_example$/);
  assert.equal(calls[0].authorization, 'Bearer secret-vercel-token');
  assert.equal(JSON.stringify(record).includes('secret-vercel-token'), false);
});
