const test = require('node:test');
const assert = require('node:assert/strict');
const { validateHarnessIdentity, validateSourceBranchHead, validateTargetIdentity } = require('../e2e/helpers/uat-target-contract');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildSafeUatSummary,
  dashboardWarningState,
  navigationContract,
  previousFailureContracts,
  roleApiContract
} = require('../e2e/helpers/uat-v3-harness');
const {
  artifactLeakFindings,
  artifactLeakReasons,
  scanArtifact
} = require('../e2e/helpers/uat-v3-security');
const { getNavigationItem, getRoleApiMatrix, getRoleNavigationContract, roles } = require('../e2e/helpers/uat-v3-role-matrix');

const read = (filePath) => fs.readFileSync(path.resolve(__dirname, '..', filePath), 'utf8');

test('UAT_V3_HARNESS_PREFLIGHT: role API matrix is one read-only source of truth', () => {
  for (const role of roles) {
    const routes = roleApiContract(role);
    assert.equal(new Set(routes.map((route) => route.label)).size, routes.length);
    assert.ok(routes.every((route) => route.readOnly));
    assert.ok(routes.every((route) => route.path.startsWith('/api/v1/')));
    assert.ok(routes.every((route) => route.source && route.guard));
  }
  assert.equal(getRoleApiMatrix('VIEWER').find((route) => route.label === 'Schedule').expectedStatus, 200);
  assert.equal(getRoleApiMatrix('VIEWER').find((route) => route.label === 'Leave').expectedStatus, 403);
});

test('UAT_V3_HARNESS_PREFLIGHT: source audit freezes schedule and protected route guards', () => {
  const scheduleRoutes = read('src/routes/operations.routes.js');
  const qualityRoutes = read('src/routes/data-quality.routes.js');
  const main = read('frontend/src/main.tsx');
  assert.match(scheduleRoutes, /router\.get\('\/schedule-calendar'/);
  assert.doesNotMatch(scheduleRoutes.match(/router\.get\('\/schedule-calendar'[\s\S]*?\n\s*\}\);/)?.[0] || '', /authorize\(/);
  assert.match(scheduleRoutes, /router\.get\('\/audit-events', authorize\('ADMIN'\)/);
  assert.match(scheduleRoutes, /router\.get\('\/executive-report', authorize\('ADMIN', 'MANAGER'\)/);
  assert.match(qualityRoutes, /router\.get\('\/issues', authenticate, authorize\('ADMIN'\)/);
  assert.match(scheduleRoutes, /currentUser\.role === 'VIEWER' && !currentUser\.employeeId/);
  const navigationSource = main.match(/const navigation:[\s\S]*?\n\];/)?.[0] || '';
  assert.match(navigationSource, /id: 'schedule',[\s\S]*?label: 'ตารางกะรายเดือน'/);
  assert.doesNotMatch(navigationSource, /id: 'schedule',[\s\S]*?label: 'Schedule Calendar'/);
});

test('UAT_V3_HARNESS_PREFLIGHT: navigation uses canonical IDs and primary-nav scope', () => {
  for (const role of roles) {
    const contract = navigationContract(role);
    const ids = [...contract.required, ...contract.forbidden].map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(contract.required.every((item) => getNavigationItem(item.id).label === item.label));
  }
  assert.equal(getNavigationItem('schedule').label, 'ตารางกะรายเดือน');
  assert.throws(() => getNavigationItem('Schedule Calendar'), /Unsupported UAT navigation id/);
  const observe = read('e2e/helpers/uat-observe.js');
  assert.match(observe, /nav\.nav-menu/);
  assert.match(observe, /button\.nav-item:visible/);
  assert.match(observe, /toHaveCount\(1\)/);
});

test('UAT_V3_HARNESS_PREFLIGHT: dashboard warning is conditional and sync-independent', () => {
  assert.equal(dashboardWarningState({ partialErrors: [] }), 'HEALTHY_COMPLETE');
  assert.equal(dashboardWarningState({ partialErrors: ['workforce'] }), 'PARTIAL_WARNING');
  assert.equal(dashboardWarningState({}, 'request failed'), 'ERROR');
  const dashboardPage = read('frontend/src/pages/dashboard/DashboardPage.tsx');
  assert.match(dashboardPage, /partialErrors\.length > 0/);
  assert.doesNotMatch(dashboardPage, /dashboard-data-warning.*always/i);
  const admin = read('e2e/smoke/admin.spec.js');
  assert.match(admin, /page\.reload\(\{ waitUntil: 'domcontentloaded' \}\)/);
  assert.match(admin, /Dashboard response must succeed after refresh/);
});

test('UAT_V3_HARNESS_PREFLIGHT: artifact security golden cases block real auth material', () => {
  const password = 'uat-password-value-123';
  const email = 'uat-admin@example.test';
  const bypass = 'vercel-bypass-value-123456789';
  const cases = [
    ['test-results/auth.json', '{"accessToken":"eyJhbGciOiJIUzI1NiJ9.payload.signature-value"}', {}, 'ACCESS_TOKEN_PATTERN'],
    ['test-results/auth.json', '{"refreshToken":"refresh-token-value-123456789"}', {}, 'REFRESH_TOKEN_PATTERN'],
    ['test-results/report.json', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature-value', {}, 'AUTHORIZATION_HEADER'],
    ['test-results/report.json', 'cookies="session-cookie-value-123456789"', {}, 'COOKIE_PATTERN'],
    ['test-results/report.json', '{"cookies":"session-cookie-value-123456789"}', {}, 'COOKIE_PATTERN'],
    ['test-results/report.json', '{"storageState":{"cookies":[]}}', {}, 'AUTH_STATE_FILE'],
    ['test-results/storageState.json', '{}', {}, 'AUTH_STATE_FILE'],
    ['test-results/report.json', `password=${password}`, { passwordValues: [password] }, 'PASSWORD_VALUE'],
    ['test-results/report.json', email, { emailValues: [email] }, 'UAT_EMAIL_VALUE'],
    ['test-results/report.json', bypass, { bypassSecret: bypass }, 'BYPASS_SECRET']
  ];
  for (const [filePath, content, options, category] of cases) {
    assert.ok(artifactLeakFindings(filePath, content, options).includes(category), `${category} must be blocked`);
  }
  assert.deepEqual(artifactLeakReasons('test-results/report.md', 'DATABASE_URL=<redacted>'), []);
  assert.deepEqual(artifactLeakReasons('test-results/report.md', 'DIRECT_URL=[REDACTED]'), []);
  assert.deepEqual(artifactLeakReasons('test-results/report.md', 'PASSWORD=***'), []);
  assert.deepEqual(artifactLeakReasons('test-results/report.json', '{"password":"actual-non-redacted-value"}'), ['PASSWORD_VALUE']);
  assert.deepEqual(artifactLeakReasons('test-results/report.json', '{"DATABASE_URL":"postgresql://user:password@host/db"}'), ['OTHER_AUTH_MATERIAL']);
  assert.deepEqual(artifactLeakReasons('test-results/report.md', 'role=ADMIN status=PASS HTTP=200 path=/dashboard'), []);
  assert.deepEqual(artifactLeakFindings('test-results/report.png', Buffer.from('{"accessToken":"token-value"}')), []);
});

test('UAT_V3_HARNESS_PREFLIGHT: artifact diagnostics expose only path and safe category', () => {
  const email = 'uat-admin@example.test';
  const password = 'uat-password-value-123';
  const finding = scanArtifact('test-results/report.json', `email=${email} password=${password}`, { emailValues: [email], passwordValues: [password] });
  assert.deepEqual(finding.categories, ['PASSWORD_VALUE', 'UAT_EMAIL_VALUE']);
  assert.equal(finding.path, 'test-results/report.json');
  assert.equal(JSON.stringify(finding).includes(email), false);
  assert.equal(JSON.stringify(finding).includes(password), false);
  assert.deepEqual(scanArtifact('test-results/safe.json', '{"role":"ADMIN","login":"PASS"}'), { path: 'test-results/safe.json', categories: [], safe: true });
});

test('UAT_V3_HARNESS_PREFLIGHT: safe summary is independent from artifact gate', () => {
  const summary = buildSafeUatSummary({
    mode: 'authenticated',
    sourceSha: 'a'.repeat(40),
    target: 'https://sms-v3-staging-ten.vercel.app',
    roles: {
      ADMIN: { loginReady: 'YES', api: 'PASS', navigation: 'PASS', responsive: 'PASS' },
      MANAGER: { loginReady: 'YES', api: 'PASS', navigation: 'PASS', responsive: 'PASS' },
      VIEWER: { loginReady: 'YES', api: 'PASS', navigation: 'PASS', responsive: 'NOT RUN' }
    },
    errors: { page: 0, console: 0, network: 0 },
    artifactLeakCount: 2,
    tests: { passed: 27, skipped: 0, failed: 2 }
  });
  assert.equal(summary.artifactLeakCount, 2);
  assert.equal(summary.roles.ADMIN.loginReady, 'YES');
  assert.equal(summary.tests.failed, 2);
  assert.equal(JSON.stringify(summary).includes('password'), false);
});

test('UAT_V3_HARNESS_PREFLIGHT: previous failures have deterministic regression contracts', () => {
  assert.equal(previousFailureContracts.length, 9);
  assert.deepEqual(previousFailureContracts.map((entry) => entry.id), [
    'schedule-legacy-label',
    'duplicate-primary-navigation',
    'dashboard-response-race',
    'role-api-old-path',
    'viewer-schedule-contract',
    'wrong-target-timeout',
    'responsive-repeated-login',
    'opaque-artifact-diagnostic',
    'redacted-placeholder'
  ]);
  const authenticated = read('e2e/smoke/authenticated-v3.spec.js');
  const observe = read('e2e/helpers/uat-observe.js');
  assert.doesNotMatch(authenticated, /waitForTimeout\(250\)/);
  assert.match(authenticated, /await loginAs\(page, role\);/);
  assert.match(observe, /const responsePromise = page\.waitForResponse/);
  assert.match(observe, /await trigger\(\);/);
});

test('UAT_V3_HARNESS_PREFLIGHT: authenticated state is temporary and cleaned', () => {
  const session = read('e2e/helpers/uat-session.js');
  const setup = read('e2e/global-setup.js');
  const teardown = read('e2e/global-teardown.js');
  const config = read('playwright.config.js');
  assert.match(session, /os\.tmpdir\(\)/);
  assert.match(setup, /clearRoleSessions\(\)/);
  assert.match(teardown, /clearRoleSessions\(\)/);
  assert.match(config, /trace: process\.env\.UAT_MODE === 'authenticated' \? 'off'/);
  assert.match(config, /video: 'off'/);
});

test('UAT_V3_HARNESS_PREFLIGHT: workflow diagnostics are safe and do not expose raw output', () => {
  const workflow = read('.github/workflows/automated-uat-sms-v3-staging.yml');
  assert.match(workflow, /scanArtifact/);
  assert.match(workflow, /ARTIFACT_SCAN path=.*category=/);
  assert.match(workflow, /UAT_ARTIFACT_LEAK/);
  assert.match(workflow, /ARTIFACT_LEAK_COUNT=0/);
  assert.doesNotMatch(workflow, /VERCEL_BYPASS_ARTIFACT_LEAK/);
  assert.doesNotMatch(workflow, /stdio:\s*'inherit'/);
  assert.doesNotMatch(workflow, /cat .*\.log/);
});

test('UAT_V3_HARNESS_PREFLIGHT: application and harness identities are independent and exact', () => {
  const workflow = read('.github/workflows/automated-uat-sms-v3-staging.yml');
  const regressionContracts = read('e2e/helpers/regression-contracts.js');
  const APPLICATION_SHA = 'e672c704c76c9fd53049b89736d56283029da1ea';
  const DEPLOYMENT_ID = 'dpl_BXdWNdwFr2MzzPAgtWgyXz7faAuS';
  const PROJECT_ID = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
  const PROJECT_NAME = 'sms-v3-staging';
  const HARNESS_SHA = '1234567890abcdef1234567890abcdef12345678';
  const deployment = {
    id: DEPLOYMENT_ID,
    url: 'sms-v3-staging-ten.vercel.app',
    name: PROJECT_NAME,
    projectId: PROJECT_ID,
    target: 'production',
    readyState: 'READY',
    meta: { githubCommitSha: APPLICATION_SHA }
  };

  assert.match(workflow, /target_mode:/);
  assert.match(workflow, /uat_harness_sha:/);
  assert.match(workflow, /source_branch:/);
  assert.match(workflow, /UAT_SOURCE_BRANCH:/);
  assert.match(workflow, /ref: \$\{\{ inputs\.uat_harness_sha \}\}/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_sha \}\}[\s\S]*?path: application-under-test/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$HARNESS_SHA"/);
  assert.match(workflow, /test "\$\(git -C application-under-test rev-parse HEAD\)" = "\$SOURCE_SHA"/);
  assert.match(workflow, /node e2e\/helpers\/uat-target-contract\.js scope/);
  assert.match(workflow, /node e2e\/helpers\/uat-target-contract\.js harness/);
  assert.match(workflow, /node e2e\/helpers\/uat-target-contract\.js source-branch/);
  assert.match(workflow, /node e2e\/helpers\/uat-target-contract\.js source-head/);
  assert.match(workflow, /node e2e\/helpers\/uat-target-contract\.js verify/);
  assert.match(workflow, /api\.vercel\.com\/v13\/deployments/);
  assert.match(workflow, /withGitRepoInfo=true/);
  assert.match(workflow, /uat-vercel-identity\.js sanitize/);
  assert.match(workflow, /--fail/);
  assert.doesNotMatch(workflow, /vercel@"\$VERCEL_CLI_VERSION" inspect/);

  assert.deepEqual(validateHarnessIdentity({
    harnessSha: HARNESS_SHA,
    checkoutSha: HARNESS_SHA,
    approvedHarnessSha: HARNESS_SHA
  }), { valid: true, harnessSha: HARNESS_SHA });

  assert.deepEqual(validateSourceBranchHead({
    sourceBranch: 'feat/unified-report-center-v1',
    remoteSourceSha: '725eebc2764168fc5c5d312d53e9b641eef7b803',
    sourceSha: '725eebc2764168fc5c5d312d53e9b641eef7b803'
  }), {
    valid: true,
    sourceBranch: 'feat/unified-report-center-v1',
    sourceSha: '725eebc2764168fc5c5d312d53e9b641eef7b803'
  });

  assert.deepEqual(validateTargetIdentity({
    targetMode: 'canonical',
    targetUrl: 'https://sms-v3-staging-ten.vercel.app',
    expectedDeploymentId: DEPLOYMENT_ID,
    applicationSha: APPLICATION_SHA,
    targetDeployment: deployment,
    expectedDeployment: deployment,
    expectedProjectId: PROJECT_ID,
    expectedProjectName: PROJECT_NAME
  }), {
    valid: true,
    targetMode: 'canonical',
    targetHost: 'sms-v3-staging-ten.vercel.app',
    deploymentId: DEPLOYMENT_ID,
    applicationSha: APPLICATION_SHA
  });

  assert.match(regressionContracts, /process\.env\.UAT_APPLICATION_ROOT/);
  assert.match(regressionContracts, /EMPLOYEE_LIFECYCLE_ROUTE_CONTRACT_FAILED/);
  assert.match(regressionContracts, /EMPLOYEE_LIFECYCLE_SERVICE_CONTRACT_FAILED/);
  assert.match(regressionContracts, /EMPLOYEE_LIFECYCLE_UI_CONTRACT_FAILED/);
});
