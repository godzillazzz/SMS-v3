const test = require('node:test');
const assert = require('node:assert/strict');
const { getUatConfig, normalizeUatMode } = require('../e2e/helpers/uat-config');
const { artifactContainsAnySecret, artifactContainsAuthMaterial, artifactLeakReasons, isForbiddenArtifactPath, isTextArtifactPath, roleSuiteStatus } = require('../e2e/helpers/uat-v3-security');
const { getRoleApiMatrix, getRoleNavigation } = require('../e2e/helpers/uat-v3-role-matrix');
const fs = require('node:fs');
const path = require('node:path');
const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
const observe = fs.readFileSync(path.resolve(__dirname, '../e2e/helpers/uat-observe.js'), 'utf8');
const authenticatedSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/authenticated-v3.spec.js'), 'utf8');
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
  const expectedStatuses = {
    ADMIN: {
      Dashboard: 200, Employees: 200, Schedule: 200, Leave: 200, 'Leave quota': 200,
      License: 200, Users: 200, 'Data Quality': 200, Audit: 200, 'Executive Report': 200,
      'Report summary': 200, 'System settings': 200
    },
    MANAGER: {
      Dashboard: 200, Employees: 200, Schedule: 200, Leave: 200, 'Leave quota': 200,
      License: 200, Users: 200, 'Data Quality': 403, Audit: 403, 'Executive Report': 200,
      'Report summary': 200, 'System settings': 403
    },
    VIEWER: {
      Dashboard: 200, Employees: 200, Schedule: 200, Leave: 403, 'Leave quota': 403,
      License: 403, Users: 403, 'Data Quality': 403, Audit: 403, 'Executive Report': 403,
      'Report summary': 403, 'System settings': 403
    }
  };
  for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
    const routes = getRoleApiMatrix(role, '2026-08');
    assert.ok(routes.length >= 10);
    assert.ok(routes.every((route) => route.readOnly));
    assert.ok(routes.every((route) => route.path.includes('/api/v1/')));
    assert.ok(routes.some((route) => route.label === 'Executive Report'));
    assert.ok(routes.some((route) => route.label === 'Audit'));
    assert.ok(getRoleNavigation(role).required.length > 0);
    assert.deepEqual(
      Object.fromEntries(routes.map((route) => [route.label, route.expectedStatus])),
      expectedStatuses[role]
    );
  }
  assert.equal(getRoleApiMatrix('ADMIN').find((route) => route.label === 'Data Quality').expectedStatus, 200);
  assert.equal(getRoleApiMatrix('MANAGER').find((route) => route.label === 'Data Quality').expectedStatus, 403);
  assert.equal(getRoleApiMatrix('VIEWER').find((route) => route.label === 'Executive Report').expectedStatus, 403);
  for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
    assert.equal(getRoleApiMatrix(role).find((route) => route.label === 'Schedule').expectedStatus, 200);
    assert.ok(getRoleNavigation(role).required.includes('ตารางกะรายเดือน'));
    assert.equal(getRoleNavigation(role).required.includes('Schedule Calendar'), false);
  }
  assert.equal(getRoleApiMatrix('VIEWER').find((route) => route.label === 'Leave').expectedStatus, 403);
  assert.match(observe, /nav\.nav-menu button\.nav-item:visible/);
  assert.match(authenticatedSmoke, /const primaryNavigation = page\.locator\('nav\.nav-menu button\.nav-item:visible'\)/);
  assert.match(authenticatedSmoke, /test\.slow\(\)/);
  assert.match(authenticatedSmoke, /timeout: 60000/);
  assert.match(authenticatedSmoke, /ETIMEDOUT\|timeout/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/admin.spec.js'), 'utf8'), /nav\.nav-menu button\.nav-item:visible/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/roles.spec.js'), 'utf8'), /allowedApiResponses/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/roles.spec.js'), 'utf8'), /allowed dashboard and privileged navigation stay bounded/);
  assert.match(observe, /allowedApiResponses/);
  assert.match(observe, /path: '\/api\/v1\/auth\/refresh'/);
  assert.match(observe, /Unexpected API responses/);
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
  assert.equal(artifactContainsAuthMaterial(Buffer.from('{"accessToken":"eyJhbGciOiJIUzI1NiJ9.payload.signature-value"}')), true);
  assert.equal(artifactContainsAuthMaterial(Buffer.from([0, 1, 2, 3, 4, 5])), false);
  assert.equal(artifactContainsAuthMaterial('{"mode":"technical","roles":{"ADMIN":"SKIPPED"}}'), false);
  assert.equal(artifactContainsAuthMaterial('Report source mentions accessToken without a value.'), false);
  assert.equal(artifactContainsAnySecret('safe report', ['secret-value']), false);
  assert.equal(artifactContainsAnySecret('safe report secret-value', ['secret-value']), true);
  assert.equal(artifactContainsAnySecret('role identity uat-admin@example.test', ['uat-admin@example.test']), false);
  assert.equal(isTextArtifactPath('test-results/uat-results.json'), true);
  assert.equal(isTextArtifactPath('test-results/failure.png'), false);
  assert.deepEqual(artifactLeakReasons('test-results/.auth/admin.json', '{}'), ['FORBIDDEN_PATH']);
  assert.equal(isForbiddenArtifactPath('test-results/playwright/auth-boundary-v3-report.json'), false);
  assert.equal(isForbiddenArtifactPath('test-results/playwright/auth-state.json'), true);
  assert.deepEqual(artifactLeakReasons('test-results/uat-summary.md', 'role=ADMIN status=PASS'), []);
  assert.deepEqual(artifactLeakReasons('test-results/failure.json', '{"accessToken":"eyJhbGciOiJIUzI1NiJ9.payload.signature-value"}'), ['AUTH_MATERIAL']);
  assert.deepEqual(artifactLeakReasons('test-results/failure.png', Buffer.from('{"accessToken":"eyJhbGciOiJIUzI1NiJ9.payload.signature-value"}')), []);
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
