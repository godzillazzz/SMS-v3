const test = require('node:test');
const assert = require('node:assert/strict');
const { getUatConfig, normalizeUatMode } = require('../e2e/helpers/uat-config');
const { artifactContainsAnySecret, artifactContainsAuthMaterial, artifactLeakReasons, isForbiddenArtifactPath, isTextArtifactPath, roleSuiteStatus, scanArtifact } = require('../e2e/helpers/uat-v3-security');
const { getRoleApiMatrix, getRoleNavigation } = require('../e2e/helpers/uat-v3-role-matrix');
const fs = require('node:fs');
const path = require('node:path');
const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
const observe = fs.readFileSync(path.resolve(__dirname, '../e2e/helpers/uat-observe.js'), 'utf8');
const authenticatedSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/authenticated-v3.spec.js'), 'utf8');
const adminSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/admin.spec.js'), 'utf8');
const authenticatedRequest = fs.readFileSync(path.resolve(__dirname, '../e2e/helpers/uat-authenticated-request.js'), 'utf8');
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
  assert.match(observe, /nav\.nav-menu/);
  assert.match(observe, /button\.nav-item:visible/);
  assert.match(authenticatedSmoke, /getRoleNavigationContract/);
  assert.match(authenticatedSmoke, /test\.setTimeout\(180_000\)/);
  assert.match(authenticatedRequest, /timeout = 60_000/);
  assert.doesNotMatch(authenticatedSmoke, /page\.request/);
  assert.doesNotMatch(adminSmoke, /page\.request/);
  assert.doesNotMatch(adminSmoke, /expectApiSuccess/);
  assert.match(adminSmoke, /getRoleApiMatrix\('ADMIN'\)/);
  assert.match(adminSmoke, /\.audit-skeleton-row/);
  assert.match(adminSmoke, /\.audit-desktop-table button\.audit-preview-link:visible/);
  assert.match(authenticatedSmoke, /data-personnel-id/);
  assert.match(authenticatedSmoke, /button\.lifecycle-action:visible/);
  assert.match(authenticatedSmoke, /UAT_API_REQUEST_FAILED/);
  assert.doesNotMatch(authenticatedSmoke, /waitForTimeout\(250\)/);
  assert.match(adminSmoke, /\['Schedule', 'schedule'\]/);
  assert.match(adminSmoke, /\['Leave', 'leave'\]/);
  assert.match(adminSmoke, /\['License', 'licenses'\]/);
  assert.match(adminSmoke, /navigateTo\(page, navigationId\)/);
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
  assert.equal(artifactContainsAnySecret('role identity uat-admin@example.test', ['uat-admin@example.test']), true);
  assert.equal(isTextArtifactPath('test-results/uat-results.json'), true);
  assert.equal(isTextArtifactPath('test-results/failure.png'), false);
  assert.deepEqual(artifactLeakReasons('test-results/.auth/admin.json', '{}'), ['AUTH_STATE_FILE']);
  assert.equal(isForbiddenArtifactPath('test-results/playwright/auth-boundary-v3-report.json'), false);
  assert.equal(isForbiddenArtifactPath('test-results/playwright/auth-state.json'), true);
  assert.deepEqual(artifactLeakReasons('test-results/uat-summary.md', 'role=ADMIN status=PASS'), []);
  assert.deepEqual(artifactLeakReasons('test-results/failure.json', '{"accessToken":"eyJhbGciOiJIUzI1NiJ9.payload.signature-value"}'), ['ACCESS_TOKEN_PATTERN']);
  assert.deepEqual(artifactLeakReasons('test-results/failure.png', Buffer.from('{"accessToken":"eyJhbGciOiJIUzI1NiJ9.payload.signature-value"}')), []);
  assert.deepEqual(artifactLeakReasons('test-results/uat-summary.md', 'DATABASE_URL=<redacted>'), []);
  assert.deepEqual(artifactLeakReasons('test-results/uat-summary.md', 'DATABASE_URL=postgresql://user:password@host/db'), ['OTHER_AUTH_MATERIAL']);
  assert.deepEqual(artifactLeakReasons('test-results/uat-summary.md', 'password=<redacted>'), []);
  assert.deepEqual(artifactLeakReasons('test-results/uat-summary.md', 'password=actual-non-redacted-value'), ['PASSWORD_VALUE']);
  assert.deepEqual(artifactLeakReasons('test-results/uat-summary.md', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature-value'), ['AUTHORIZATION_HEADER']);
  assert.deepEqual(artifactLeakReasons('test-results/uat-summary.md', 'identity=uat-admin@example.test', { emailValues: ['uat-admin@example.test'] }), ['UAT_EMAIL_VALUE']);
  assert.deepEqual(scanArtifact('test-results/uat-summary.md', 'mode=AUTHENTICATED role=ADMIN status=PASS'), { path: 'test-results/uat-summary.md', categories: [], safe: true });
});

test('V3 workflow exposes explicit mode and least-privilege credential contract', () => {
  assert.match(workflow, /uat_harness_sha:/);
  assert.match(workflow, /Exact trusted UAT harness SHA pinned by immutable/);
  assert.match(workflow, /UAT_APPLICATION_ROOT:/);
  assert.match(workflow, /path: application-under-test/);
  assert.match(workflow, /git -C application-under-test rev-parse HEAD/);
  assert.match(workflow, /GITHUB_REF_TYPE: \$\{\{ github\.ref_type \}\}/);
  assert.match(workflow, /uat-target-contract\.js harness/);
  assert.match(workflow, /origin\/fix\/employee-lifecycle-transaction-reliability\)" != "\$SOURCE_SHA"/);
  assert.match(workflow, /GITHUB_REF_NAME: \$\{\{ github\.ref_name \}\}/);
  assert.match(workflow, /\[\[ "\$DEPLOYMENT_ID" =~ \^dpl_/);
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
  assert.match(technicalJob, /environment:\s*production-sms-v3-staging/);
  assert.match(authenticatedJob, /environment:\s*production-sms-v3-staging/);
  for (const name of ['UAT_ADMIN_EMAIL', 'UAT_ADMIN_PASSWORD', 'UAT_MANAGER_EMAIL', 'UAT_MANAGER_PASSWORD', 'UAT_VIEWER_EMAIL', 'UAT_VIEWER_PASSWORD']) {
    assert.doesNotMatch(technicalJob, new RegExp(`\\b${name}\\b`));
    assert.match(authenticatedJob, new RegExp(`\\b${name}\\b`));
  }
  assert.match(authenticatedJob, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(workflow, /uat-harness-v3-<sha>/);
  assert.match(authenticatedSmoke, /Employee Lifecycle management, history, state, and preflight/);
  assert.match(authenticatedSmoke, /Employee Lifecycle history is read-only and mutations are forbidden/);
  assert.match(authenticatedSmoke, /Employee Lifecycle history and mutations are forbidden/);
  const forbiddenWorkflowSecrets = [
    ['DATABASE', 'URL'],
    ['DIRECT', 'URL'],
    ['JWT', 'SECRET']
  ].map((parts) => parts.join('_'));
  for (const name of forbiddenWorkflowSecrets) assert.doesNotMatch(workflow, new RegExp(`\\b${name}\\b`));

  assert.match(workflow, /target_mode:/);
  assert.match(workflow, /- candidate/);
  assert.match(workflow, /- canonical/);
  assert.match(workflow, /uat-target-contract\.js scope/);
  assert.match(workflow, /uat-target-contract\.js verify/);
  assert.match(workflow, /uat-target-contract\.js fetch "\$TARGET_URL"/);
  assert.match(workflow, /uat-target-contract\.js fetch "\$DEPLOYMENT_ID"/);
  assert.equal((workflow.match(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/g) || []).length, 2);
  const authenticatedRunStep = workflow.match(/- name: Run authenticated UAT V3[\s\S]*?(?=\r?\n      - name: Publish authenticated UAT summary)/)?.[0] || '';
  const technicalRunStep = workflow.match(/- name: Run technical UAT V3 without credentials[\s\S]*?(?=\r?\n      - name: Publish technical UAT summary)/)?.[0] || '';
  assert.doesNotMatch(authenticatedRunStep, /VERCEL_TOKEN/);
  assert.doesNotMatch(technicalRunStep, /VERCEL_TOKEN/);});
