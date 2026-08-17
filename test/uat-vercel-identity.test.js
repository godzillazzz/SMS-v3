const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  assertSuccessfulHttpStatus,
  normalizeDeploymentIdentity,
  parseDeploymentResponse
} = require('../e2e/helpers/uat-vercel-identity');
const {
  classifyDeploymentIdentity,
  resolveDeploymentApplicationSha,
  validateDeploymentRecord,
  validateSourceBranchHead,
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
const SANITIZER_PATH = path.resolve(__dirname, '../e2e/helpers/uat-vercel-identity.js');

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

function runSanitize(inputPath, outputPath) {
  return spawnSync(process.execPath, [SANITIZER_PATH, 'sanitize', inputPath, outputPath], {
    encoding: 'utf8'
  });
}

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-uat-identity-'));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('REST meta.githubCommitSha is normalized and validated', () => {
  const raw = rawRecord({ gitSource: undefined });
  assert.equal(validate(normalizeDeploymentIdentity(raw)).valid, true);
});

test('REST gitSource.sha is accepted when meta SHA is absent', () => {
  const raw = rawRecord({ meta: { githubCommitRef: SOURCE_BRANCH }, gitSource: { sha: APPLICATION_SHA, ref: SOURCE_BRANCH } });
  assert.equal(validate(normalizeDeploymentIdentity(raw)).valid, true);
});

test('clean CLI gitCommitSha and HEAD are normalized and accepted', () => {
  const normalized = normalizeDeploymentIdentity(rawRecord({
    meta: { gitCommitSha: APPLICATION_SHA, gitCommitRef: 'HEAD' },
    gitSource: undefined
  }));
  assert.equal(normalized.meta.gitCommitSha, APPLICATION_SHA);
  assert.equal(normalized.meta.gitCommitRef, 'HEAD');
  assert.deepEqual(classifyDeploymentIdentity(normalized), {
    deploymentClass: 'CLEAN_CLI_EXACT_SHA',
    ref: 'HEAD'
  });
  assert.equal(validate(normalized).valid, true);
});

test('Vercel production-target CLI metadata encoded as githubCommitRef HEAD is accepted as clean CLI exact SHA', () => {
  const normalized = normalizeDeploymentIdentity(rawRecord({
    meta: { githubCommitSha: APPLICATION_SHA, githubCommitRef: 'HEAD' },
    gitSource: undefined
  }));
  assert.deepEqual(classifyDeploymentIdentity(normalized), {
    deploymentClass: 'CLEAN_CLI_EXACT_SHA',
    ref: 'HEAD'
  });
  assert.equal(validate(normalized).valid, true);
});

test('clean CLI ref survives sanitization without retaining raw metadata', () => {
  const normalized = normalizeDeploymentIdentity(rawRecord({
    meta: {
      gitCommitSha: APPLICATION_SHA,
      gitCommitRef: 'HEAD',
      gitRemoteUrl: 'not-retained'
    },
    gitSource: undefined
  }));
  assert.deepEqual(normalized.meta, {
    gitCommitSha: APPLICATION_SHA,
    gitCommitRef: 'HEAD'
  });
  assert.equal('gitRemoteUrl' in normalized.meta, false);
});

test('clean CLI SHA and HEAD remain bound to the independent source branch HEAD', () => {
  const normalized = normalizeDeploymentIdentity(rawRecord({
    meta: { gitCommitSha: APPLICATION_SHA, gitCommitRef: 'HEAD' },
    gitSource: undefined
  }));
  assert.equal(validate(normalized).valid, true);
  assert.throws(
    () => validateSourceBranchHead({
      sourceBranch: SOURCE_BRANCH,
      remoteSourceSha: OTHER_SHA,
      sourceSha: APPLICATION_SHA
    }),
    { code: 'UAT_SOURCE_BRANCH_SHA_MISMATCH' }
  );
});

test('clean CLI ref missing fails closed', () => {
  assert.throws(
    () => validate(identity({
      meta: { gitCommitSha: APPLICATION_SHA },
      gitSource: undefined
    })),
    { code: 'UAT_DEPLOYMENT_GIT_REF_MISSING' }
  );
});

test('clean CLI arbitrary refs fail closed', () => {
  for (const ref of ['main', 'detached', 'refs/heads/main', 'foo', 'HEAD~1']) {
    assert.throws(
      () => validate(identity({
        meta: { gitCommitSha: APPLICATION_SHA, gitCommitRef: ref },
        gitSource: undefined
      })),
      { code: 'UAT_DEPLOYMENT_GIT_REF_INVALID' }
    );
  }
});

test('clean CLI SHA mismatch fails before ref acceptance', () => {
  assert.throws(
    () => validate(identity({
      meta: { gitCommitSha: OTHER_SHA, gitCommitRef: 'HEAD' },
      gitSource: undefined
    })),
    { code: 'UAT_DEPLOYMENT_APPLICATION_SHA_MISMATCH' }
  );
});

test('clean CLI malformed SHA fails closed', () => {
  assert.throws(
    () => resolveDeploymentApplicationSha({ meta: { gitCommitSha: 'not-a-sha' } }),
    { code: 'UAT_DEPLOYMENT_APPLICATION_SHA_INVALID' }
  );
});

test('Git integration refs may agree, but CLI and Git refs cannot coexist', () => {
  assert.equal(classifyDeploymentIdentity(identity()).deploymentClass, 'GIT_INTEGRATED');
  assert.throws(
    () => validate(identity({
      meta: {
        githubCommitSha: APPLICATION_SHA,
        githubCommitRef: SOURCE_BRANCH,
        gitCommitSha: APPLICATION_SHA,
        gitCommitRef: 'HEAD'
      },
      gitSource: undefined
    })),
    { code: 'UAT_DEPLOYMENT_GIT_REF_CONFLICT' }
  );
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
    { code: 'UAT_DEPLOYMENT_APPLICATION_SHA_MISMATCH' }
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

test('sanitizer creates an absent destination with exclusive write', () => {
  withTempDirectory((directory) => {
    const inputPath = path.join(directory, 'response.json');
    const outputPath = path.join(directory, 'identity.json');
    fs.writeFileSync(inputPath, JSON.stringify(rawRecord()));
    assert.equal(fs.existsSync(outputPath), false);
    const result = runSanitize(inputPath, outputPath);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).id, DEPLOYMENT_ID);
  });
});

test('sanitizer fails closed and does not overwrite an existing destination', () => {
  withTempDirectory((directory) => {
    const inputPath = path.join(directory, 'response.json');
    const outputPath = path.join(directory, 'identity.json');
    const sentinel = 'existing-identity-content\n';
    fs.writeFileSync(inputPath, JSON.stringify(rawRecord()));
    fs.writeFileSync(outputPath, sentinel);
    const result = runSanitize(inputPath, outputPath);
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.trim(), 'EEXIST');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), sentinel);
  });
});

test('temporary directory supports two independent sanitized outputs and cleanup', () => {
  let directory;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-uat-identity-'));
  try {
    const targetResponse = path.join(directory, 'target-response.json');
    const expectedResponse = path.join(directory, 'expected-response.json');
    const targetIdentity = path.join(directory, 'target-identity.json');
    const expectedIdentity = path.join(directory, 'expected-identity.json');
    fs.writeFileSync(targetResponse, JSON.stringify(rawRecord()));
    fs.writeFileSync(expectedResponse, JSON.stringify(rawRecord()));
    assert.equal(fs.existsSync(targetIdentity), false);
    assert.equal(fs.existsSync(expectedIdentity), false);
    assert.equal(runSanitize(targetResponse, targetIdentity).status, 0);
    assert.equal(runSanitize(expectedResponse, expectedIdentity).status, 0);
    const sanitized = JSON.parse(fs.readFileSync(targetIdentity, 'utf8'));
    assert.equal(sanitized.id, DEPLOYMENT_ID);
    assert.equal('token' in sanitized, false);
    assert.equal('deployment' in sanitized, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(directory), false);
});

test('temporary directory cleanup also runs after sanitizer failure', () => {
  let directory;
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-uat-identity-'));
  try {
    const inputPath = path.join(directory, 'response.json');
    const outputPath = path.join(directory, 'identity.json');
    fs.writeFileSync(inputPath, JSON.stringify(rawRecord()));
    fs.writeFileSync(outputPath, 'existing');
    assert.notEqual(runSanitize(inputPath, outputPath).status, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(directory), false);
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
    assert.match(job, /identity_tmp_dir="\$\(mktemp -d\)"/);
    assert.match(job, /test ! -e "\$target_response"/);
    assert.match(job, /test ! -e "\$target_identity"/);
    assert.match(job, /test -s "\$target_response"/);
    assert.match(job, /test -s "\$target_identity"/);
    assert.match(job, /rm -rf -- "\$identity_tmp_dir"/);
    assert.match(job, /trap cleanup EXIT/);
    assert.doesNotMatch(job, /target_identity="\$\(mktemp\)"/);
    assert.doesNotMatch(job, /expected_identity="\$\(mktemp\)"/);
    assert.doesNotMatch(job, /rm -f "\$target_response"/);
  }
});
