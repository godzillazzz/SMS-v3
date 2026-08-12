const test = require('node:test');
const assert = require('node:assert/strict');
const { getUatConfig, normalizeUatMode } = require('../e2e/helpers/uat-config');
const { artifactContainsAnySecret, artifactContainsAuthMaterial, isForbiddenArtifactPath, roleSuiteStatus } = require('../e2e/helpers/uat-v3-security');
const { getRoleApiMatrix, getRoleNavigation } = require('../e2e/helpers/uat-v3-role-matrix');
const workflow = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
const testPassword = ['uat', 'test', 'only', 'secret'].join('-');

const baseEnvironment = { UAT_BASE_URL: 'https://candidate.example.test' };

test('V3 supports explicit technical and authenticated modes', () => {
  assert.equal(normalizeUatMode(undefined), 'technical');
  assert.equal(normalizeUatMode('technical'), 'technical');
  assert.equal(normalizeUatMode('AUTHENTICATED'), 'authenticated');
  assert.throws(() => normalizeUatMode('unknown'), { code: 'UAT_MODE_INVALID' });
  assert.equal(getUatConfig(baseEnvironment).mode, 'technical');
});

test('authenticated mode requires all three complete role credential pairs', () => {
  assert.throws(
    () => getUatConfig({ ...baseEnvironment, UAT_MODE: 'authenticated' }),
    (error) => error.code === 'UAT_CREDENTIALS_REQUIRED' && error.message === 'UAT_CREDENTIALS_REQUIRED'
  );
  assert.throws(
    () => getUatConfig({ ...baseEnvironment, UAT_MODE: 'authenticated', UAT_ADMIN_EMAIL: 'admin@example.test', UAT_ADMIN_PASSWORD: testPassword }),
    { code: 'UAT_CREDENTIALS_REQUIRED' }
  );
  const config = getUatConfig({
    ...baseEnvironment,
    UAT_MODE: 'authenticated',
    UAT_ADMIN_EMAIL: 'admin@example.test', UAT_ADMIN_PASSWORD: testPassword,
    UAT_MANAGER_EMAIL: 'manager@example.test', UAT_MANAGER_PASSWORD: testPassword,
    UAT_VIEWER_EMAIL: 'viewer@example.test', UAT_VIEWER_PASSWORD: testPassword
  });
  assert.equal(config.mode, 'authenticated');
  assert.equal(config.accounts.ADMIN.configured, true);
  assert.equal(config.accounts.MANAGER.configured, true);
  assert.equal(config.accounts.VIEWER.configured, true);
});

test('V3 role matrix covers read-only current backend contracts', () => {
  for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
    const routes = getRoleApiMatrix(role, '2026-08');
    assert.ok(routes.length >= 10);
    assert.ok(routes.every((route) => route.readOnly));
    assert.ok(routes.every((route) => route.path.includes('/api/v1/')));
    assert.ok(routes.some((route) => route.label === 'Executive Report'));
    assert.ok(routes.some((route) => route.label === 'Audit'));
    assert.ok(getRoleNavigation(role).required.length > 0);
  }
  assert.equal(getRoleApiMatrix('ADMIN').find((route) => route.label === 'Data Quality').expectedStatus, 200);
  assert.equal(getRoleApiMatrix('MANAGER').find((route) => route.label === 'Data Quality').expectedStatus, 403);
  assert.equal(getRoleApiMatrix('VIEWER').find((route) => route.label === 'Executive Report').expectedStatus, 403);
});

test('V3 distinguishes skipped technical mode from blocked authenticated mode', () => {
  assert.equal(roleSuiteStatus({ mode: 'technical', configured: false, failed: false }), 'SKIPPED');
  assert.equal(roleSuiteStatus({ mode: 'authenticated', configured: false, failed: false }), 'BLOCKED');
  assert.equal(roleSuiteStatus({ mode: 'authenticated', configured: true, failed: false }), 'PASS');
  assert.equal(roleSuiteStatus({ mode: 'authenticated', configured: true, failed: true }), 'FAIL');
});

test('V3 artifact safety rejects auth state paths and token-bearing content', () => {
  assert.equal(isForbiddenArtifactPath('test-results/.auth/admin.json'), true);
  assert.equal(isForbiddenArtifactPath('test-results/storageState.json'), true);
  assert.equal(isForbiddenArtifactPath('test-results/uat-summary.md'), false);
  assert.equal(artifactContainsAuthMaterial('{"accessToken":"eyJhbGciOiJIUzI1NiJ9.payload.signature-value"}'), true);
  assert.equal(artifactContainsAuthMaterial('{"mode":"technical","roles":{"ADMIN":"SKIPPED"}}'), false);
  assert.equal(artifactContainsAuthMaterial('Report source mentions accessToken without a value.'), false);
  assert.equal(artifactContainsAnySecret('safe report', ['secret-value']), false);
  assert.equal(artifactContainsAnySecret('safe report secret-value', ['secret-value']), true);
});

test('V3 workflow exposes explicit mode and least-privilege credential contract', () => {
  assert.match(workflow, /uat_mode:/);
  assert.match(workflow, /default:\s*technical/);
  assert.match(workflow, /type:\s*choice/);
  assert.match(workflow, /- technical/);
  assert.match(workflow, /- authenticated/);
  assert.match(workflow, /technical-smoke:\r?\n\s+if:\s+\$\{\{ inputs\.uat_mode == 'technical' \}\}/);
  assert.match(workflow, /authenticated-uat:\r?\n\s+if:\s+\$\{\{ inputs\.uat_mode == 'authenticated' \}\}/);
  const technicalJob = workflow.match(/\r?\n  technical-smoke:\r?\n([\s\S]*?)(?=\r?\n  authenticated-uat:)/)?.[1];
  const authenticatedJob = workflow.match(/\r?\n  authenticated-uat:\r?\n([\s\S]*)$/)?.[1];
  assert.ok(technicalJob);
  assert.ok(authenticatedJob);
  assert.doesNotMatch(technicalJob, /environment:\s*production-sms-v3-staging/);
  assert.match(authenticatedJob, /environment:\s*production-sms-v3-staging/);
  for (const name of ['UAT_ADMIN_EMAIL', 'UAT_ADMIN_PASSWORD', 'UAT_MANAGER_EMAIL', 'UAT_MANAGER_PASSWORD', 'UAT_VIEWER_EMAIL', 'UAT_VIEWER_PASSWORD']) {
    assert.doesNotMatch(technicalJob, new RegExp(`\\b${name}\\b`));
    assert.match(authenticatedJob, new RegExp(`\\b${name}\\b`));
  }
  assert.match(authenticatedJob, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(workflow, /test\/automated-uat-v3-authenticated/);
  const forbiddenWorkflowSecrets = [
    ['DATABASE', 'URL'],
    ['DIRECT', 'URL'],
    ['JWT', 'SECRET'],
    ['VERCEL', 'TOKEN'],
    ['VERCEL', 'ORG', 'ID'],
    ['VERCEL', 'PROJECT', 'ID']
  ].map((parts) => parts.join('_'));
  for (const name of forbiddenWorkflowSecrets) assert.doesNotMatch(workflow, new RegExp(`\\b${name}\\b`));
});
