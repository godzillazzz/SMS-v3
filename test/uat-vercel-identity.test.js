const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertSuccessfulHttpStatus,
  normalizeDeploymentIdentity,
  parseDeploymentResponse
} = require('../e2e/helpers/uat-vercel-identity');
const {
  validateDeploymentRecord,
  validateTargetIdentity
} = require('../e2e/helpers/uat-target-contract');

const APPLICATION_SHA = '725eebc2764168fc5c5d312d53e9b641eef7b803';
const OTHER_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DEPLOYMENT_ID = 'dpl_Bo9XUZriHS9yThHhFX4GvSbeVe14';
const OTHER_DEPLOYMENT_ID = 'dpl_OtherDeployment123';
const PROJECT_ID = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
const PROJECT_NAME = 'sms-v3-staging';
const HOST = 'sms-v3-staging-5pef2ffup-godzillazz.vercel.app';
const SOURCE_BRANCH = 'feat/unified-report-center-v1';

function rawRecord(overrides = {}) {
  return {
    id: DEPLOYMENT_ID,
    url: HOST,
    name: PROJECT_NAME,
    project: { id: PROJECT_ID },
    target: 'production',
    readyState: 'READY',
    meta: {
      githubCommitSha: APPLICATION_SHA,
      githubCommitRef: SOURCE_BRANCH,
      githubCommitOrg: 'godzillazzz',
      githubCommitRepo: 'SMS-v3'
    },
    gitSource: { sha: APPLICATION_SHA, ref: SOURCE_BRANCH },
    ...overrides
  };
}

function identity(overrides = {}) {
  return normalizeDeploymentIdentity(rawRecord(overrides));
}

function validate(record, overrides = {}) {
  return validateDeploymentRecord(record, {
    expectedDeploymentId: DEPLOYMENT_ID,
    applicationSha: APPLICATION_SHA,
    expectedProjectId: PROJECT_ID,
    expectedProjectName: PROJECT_NAME,
    expectedGitRef: SOURCE_BRANCH,
    ...overrides
  });
}

test('REST meta.githubCommitSha is normalized and validated', () => {
  const raw = rawRecord({ gitSource: undefined });
  assert.equal(validate(normalizeDeploymentIdentity(raw)).valid, true);
});

test('REST gitSource.sha is accepted when meta SHA is absent', () => {
  const raw = rawRecord({ meta: { githubCommitRef: SOURCE_BRANCH }, gitSource: { sha: APPLICATION_SHA, ref: SOURCE_BRANCH } });
  assert.equal(validate(normalizeDeploymentIdentity(raw)).valid, true);
});

test('matching meta and gitSource SHA values pass', () => {
  assert.equal(validate(identity()).valid, true);
});

test('conflicting supported SHA values fail closed', () => {
  assert.throws(
    () => validate(identity({ gitSource: { sha: OTHER_SHA, ref: SOURCE_BRANCH } })),
    { code: 'UAT_DEPLOYMENT_APPLICATION_SHA_CONFLICT' }
  );
});

test('missing supported SHA values fail closed', () => {
  assert.throws(
    () => validate(identity({ meta: { githubCommitRef: SOURCE_BRANCH }, gitSource: { ref: SOURCE_BRANCH } })),
    { code: 'UAT_DEPLOYMENT_APPLICATION_SHA_MISSING' }
  );
});

test('deployment SHA different from source SHA fails closed', () => {
  assert.throws(
    () => validate(identity({ meta: { githubCommitSha: OTHER_SHA, githubCommitRef: SOURCE_BRANCH }, gitSource: undefined })),
    { code: 'UAT_APPLICATION_SHA_MISMATCH' }
  );
});

test('wrong deployment ID fails closed', () => {
  assert.throws(
    () => validate(identity({ id: OTHER_DEPLOYMENT_ID })),
    { code: 'UAT_DEPLOYMENT_ID_MISMATCH' }
  );
});

test('target hostname lookup and expected ID lookup must be the same deployment', () => {
  const expected = identity();
  assert.throws(
    () => validateTargetIdentity({
      targetMode: 'candidate',
      targetUrl: `https://${HOST}`,
      expectedDeploymentId: DEPLOYMENT_ID,
      applicationSha: APPLICATION_SHA,
      targetDeployment: identity({ id: OTHER_DEPLOYMENT_ID }),
      expectedDeployment: expected,
      expectedProjectId: PROJECT_ID,
      expectedProjectName: PROJECT_NAME,
      expectedGitRef: SOURCE_BRANCH
    }),
    { code: 'UAT_DEPLOYMENT_ID_MISMATCH' }
  );
});

test('wrong project fails closed', () => {
  assert.throws(
    () => validate(identity({ project: { id: 'prj_wrong' } })),
    { code: 'UAT_DEPLOYMENT_PROJECT_ID_MISMATCH' }
  );
});

test('non-production target fails closed', () => {
  assert.throws(
    () => validate(identity({ target: 'preview' })),
    { code: 'UAT_DEPLOYMENT_TARGET_NOT_PRODUCTION' }
  );
});

test('non-ready deployment fails closed', () => {
  assert.throws(
    () => validate(identity({ readyState: 'BUILDING' })),
    { code: 'UAT_DEPLOYMENT_NOT_READY' }
  );
});

test('candidate Git ref must match the declared source branch', () => {
  assert.throws(
    () => validate(identity({ meta: { githubCommitRef: 'main' }, gitSource: { sha: APPLICATION_SHA, ref: 'main' } })),
    { code: 'UAT_DEPLOYMENT_GIT_REF_MISMATCH' }
  );
});

test('malformed deployment response fails closed', () => {
  assert.throws(
    () => parseDeploymentResponse('{not-json'),
    { code: 'UAT_VERCEL_RESPONSE_JSON_INVALID' }
  );
});

test('non-success HTTP status fails closed', () => {
  assert.equal(assertSuccessfulHttpStatus(200), 200);
  assert.throws(() => assertSuccessfulHttpStatus(500), { code: 'UAT_VERCEL_HTTP_STATUS_NOT_OK' });
});

test('normalizer allowlists identity fields and excludes unrelated response data', () => {
  const normalized = normalizeDeploymentIdentity(rawRecord({ token: 'not-a-real-token', deployment: { secret: 'not-retained' } }));
  assert.equal('token' in normalized, false);
  assert.equal('deployment' in normalized, false);
  assert.deepEqual(Object.keys(normalized).sort(), ['gitSource', 'id', 'meta', 'name', 'projectId', 'readyState', 'target', 'url'].sort());
});

test('workflow uses REST v13 retrieval and sanitized identity files in both jobs', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
  const jobs = [
    workflow.match(/\n  technical-smoke:\r?\n([\s\S]*?)(?=\n  authenticated-uat:)/)?.[1],
    workflow.match(/\n  authenticated-uat:\r?\n([\s\S]*)$/)?.[1]
  ];
  for (const job of jobs) {
    assert.ok(job);
    assert.match(job, /api\.vercel\.com\/v13\/deployments/);
    assert.match(job, /--fail/);
    assert.match(job, /withGitRepoInfo=true/);
    assert.match(job, /uat-vercel-identity\.js sanitize/);
    assert.match(job, /DEPLOYMENT_IDENTITY_SOURCE=VERCEL_REST_V13/);
    assert.doesNotMatch(job, /vercel@"\$VERCEL_CLI_VERSION" inspect/);
  }
});
