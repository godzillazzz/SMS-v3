const test = require('node:test');
const assert = require('node:assert/strict');
const { getUatConfig, normalizeUatMode } = require('../e2e/helpers/uat-config');
const { artifactContainsAnySecret, artifactContainsAuthMaterial, artifactLeakReasons, isForbiddenArtifactPath, isTextArtifactPath, roleSuiteStatus, sanitizeArtifactContent, scanArtifact } = require('../e2e/helpers/uat-v3-security');
const { getRoleApiMatrix, getRoleNavigation } = require('../e2e/helpers/uat-v3-role-matrix');
const fs = require('node:fs');
const path = require('node:path');
const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/automated-uat-sms-v3-staging.yml'), 'utf8');
const observe = fs.readFileSync(path.resolve(__dirname, '../e2e/helpers/uat-observe.js'), 'utf8');
const authenticatedSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/authenticated-v3.spec.js'), 'utf8');
const playwrightConfig = fs.readFileSync(path.resolve(__dirname, '../playwright.config.js'), 'utf8');
const adminSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/admin.spec.js'), 'utf8');
const rolesSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/roles.spec.js'), 'utf8');
const responsiveSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/responsive.spec.js'), 'utf8');
const technicalSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/technical.spec.js'), 'utf8');
const performanceSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/performance-validation.spec.js'), 'utf8');
const regressionSmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/regression.spec.js'), 'utf8');
const authBoundarySmoke = fs.readFileSync(path.resolve(__dirname, '../e2e/smoke/auth-boundary-v3.spec.js'), 'utf8');
const authenticatedRequest = fs.readFileSync(path.resolve(__dirname, '../e2e/helpers/uat-authenticated-request.js'), 'utf8');
const uatTestFixture = fs.readFileSync(path.resolve(__dirname, '../e2e/helpers/uat-test.js'), 'utf8');
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
      Dashboard: 200, Employees: 200, 'Shift types': 200, Schedule: 200, Leave: 200, 'Leave pending count': 200,
      'Leave quota': 200, License: 200, 'Approval Center': 200, 'Scheduling rules': 200, Users: 200,
      'Personnel masters': 200, 'Data Quality': 200, Audit: 200, 'System Health': 200, 'Security Sites': 200,
      'Executive Report': 200, 'Report summary': 200, 'System settings': 200
    },
    MANAGER: {
      Dashboard: 200, Employees: 200, 'Shift types': 200, Schedule: 200, Leave: 200, 'Leave pending count': 200,
      'Leave quota': 200, License: 200, 'Approval Center': 200, 'Scheduling rules': 200, Users: 200,
      'Personnel masters': 200, 'Data Quality': 403, Audit: 403, 'System Health': 403, 'Security Sites': 403,
      'Executive Report': 200, 'Report summary': 200, 'System settings': 403
    },
    VIEWER: {
      Dashboard: 200, Employees: 200, 'Shift types': 200, Schedule: 200, Leave: 403, 'Leave pending count': 403,
      'Leave quota': 403, License: 403, 'Approval Center': 403, 'Scheduling rules': 200, Users: 403,
      'Personnel masters': 403, 'Data Quality': 403, Audit: 403, 'System Health': 403, 'Security Sites': 403,
      'Executive Report': 403, 'Report summary': 403, 'System settings': 403
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
  assert.equal(getRoleApiMatrix('ADMIN').find((route) => route.label === 'Approval Center').expectedStatus, 200);
  assert.equal(getRoleApiMatrix('MANAGER').find((route) => route.label === 'Personnel masters').expectedStatus, 200);
  assert.equal(getRoleApiMatrix('VIEWER').find((route) => route.label === 'System Health').expectedStatus, 403);
  assert.equal(getRoleNavigation('ADMIN').required.length, 21);
  assert.equal(getRoleNavigation('MANAGER').required.length, 15);
  assert.equal(getRoleNavigation('VIEWER').required.length, 9);
  for (const label of ['ลงเวลา', 'อุปกรณ์ลงเวลา', 'รหัสกะและเวลา', 'ประวัติการลาทั้งหมด', 'กฎการทำงาน']) assert.ok(getRoleNavigation('VIEWER').required.includes(label));
  for (const label of ['ลงเวลาแทนพนักงาน', 'ศูนย์อนุมัติ', 'ผู้ใช้และสิทธิ์', 'รายงานและวิเคราะห์']) assert.ok(getRoleNavigation('MANAGER').required.includes(label));
  for (const label of ['ประสิทธิภาพและสถานะระบบ', 'จุดรักษาความปลอดภัยและ QR', 'ตั้งค่าระบบ']) assert.ok(getRoleNavigation('ADMIN').required.includes(label));
  assert.match(authenticatedSmoke, /Q11 read-only Attendance Production certification/);
  assert.match(authenticatedSmoke, /ATTENDANCE_SELF_TODAY/);
  assert.match(authenticatedSmoke, /ATTENDANCE_SUPERVISOR_DAILY/);
  assert.match(authenticatedSmoke, /ATTENDANCE_DEVICE_ADMIN_OVERVIEW/);
  assert.match(authenticatedSmoke, /ATTENDANCE_GOVERNANCE_READINESS_CLOSED/);
  assert.match(authenticatedSmoke, /method: 'GET_ONLY'/);
  assert.match(observe, /nav\.nav-menu/);
  assert.match(observe, /button\.nav-item:visible/);
  assert.match(observe, /เปิดเมนูหลัก/);
  assert.doesNotMatch(observe, /name: 'เปิดเมนู', exact: true/);
  assert.match(observe, /app-navigation-drawer/);
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
  assert.match(authenticatedSmoke, /button\.data-row-primary-action:visible/);
  assert.match(authenticatedSmoke, /แก้ไขข้อมูลพนักงาน/);
  assert.match(authenticatedSmoke, /บันทึกการแก้ไข/);
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
  const unsafeText = Buffer.from(`password=${testPassword} identity=admin@example.test`);
  const sanitizedText = sanitizeArtifactContent('test-results/playwright/error-context.md', unsafeText, { passwordValues: [testPassword], emailValues: ['admin@example.test'] });
  assert.equal(sanitizedText.includes(Buffer.from(testPassword)), false);
  assert.equal(sanitizedText.includes(Buffer.from('admin@example.test')), false);
  assert.deepEqual(scanArtifact('test-results/playwright/error-context.md', sanitizedText, { passwordValues: [testPassword], emailValues: ['admin@example.test'] }), { path: 'test-results/playwright/error-context.md', categories: [], safe: true });
  const binarySecret = Buffer.from(testPassword);
  const unsanitizedBinary = sanitizeArtifactContent('test-results/playwright/failure.png', binarySecret, { passwordValues: [testPassword] });
  assert.equal(unsanitizedBinary.equals(binarySecret), true);
  assert.equal(scanArtifact('test-results/playwright/failure.png', unsanitizedBinary, { passwordValues: [testPassword] }).safe, false);
});

test('V3 workflow exposes explicit mode and least-privilege credential contract', () => {
  assert.match(workflow, /uat_harness_sha:/);
  assert.match(workflow, /Exact trusted UAT harness HEAD/);
  assert.match(workflow, /UAT_APPLICATION_ROOT:/);
  assert.match(workflow, /path: application-under-test/);
  assert.match(workflow, /git -C application-under-test rev-parse HEAD/);
  assert.match(workflow, /APPROVED_HARNESS_SHA=/);
  assert.match(workflow, /uat-target-contract\.js harness/);
  assert.match(workflow, /source_branch:/);
  assert.match(workflow, /Exact remote application source branch whose HEAD must equal source_sha/);
  assert.match(workflow, /git check-ref-format --branch "\$SOURCE_BRANCH"/);
  assert.match(workflow, /refs\/heads\/\$SOURCE_BRANCH:refs\/remotes\/origin\/\$SOURCE_BRANCH/);
  assert.match(workflow, /uat-target-contract\.js source-head "\$SOURCE_BRANCH" "\$REMOTE_SOURCE_SHA" "\$SOURCE_SHA"/);
  assert.doesNotMatch(workflow, /fix\/serverless-database-reliability/);
  assert.match(workflow, /APPROVED_HARNESS_SHA="\$\(git rev-parse origin\/test\/q11-production-assurance-sentinel\)"/);
  assert.match(workflow, /\[\[ "\$DEPLOYMENT_ID" =~ \^dpl_/);
  assert.match(workflow, /uat_mode:/);
  assert.match(workflow, /uat_scope:/);
  assert.match(workflow, /default:\s*full/);
  assert.match(workflow, /- report-center-diagnostic/);
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
  assert.match(technicalJob, /continue-on-error: true/);
  assert.match(authenticatedJob, /continue-on-error: true/);
  assert.match(technicalJob, /Upload technical UAT safe diagnostics/);
  assert.match(authenticatedJob, /Upload authenticated UAT safe diagnostics/);
  assert.match(technicalJob, /Enforce technical UAT result/);
  assert.match(authenticatedJob, /Enforce authenticated UAT result/);
  for (const job of [technicalJob, authenticatedJob]) {
    assert.match(job, /SOURCE_BRANCH: \$\{\{ inputs\.source_branch \}\}/);
    assert.match(job, /UAT_SCOPE: \$\{\{ inputs\.uat_scope \}\}/);
    assert.match(job, /git check-ref-format --branch "\$SOURCE_BRANCH"/);
    assert.match(job, /refs\/heads\/\$SOURCE_BRANCH:refs\/remotes\/origin\/\$SOURCE_BRANCH/);
    assert.match(job, /uat-target-contract\.js source-head "\$SOURCE_BRANCH" "\$REMOTE_SOURCE_SHA" "\$SOURCE_SHA"/);
    assert.doesNotMatch(job, /fix\/serverless-database-reliability/);
  }
  for (const name of ['UAT_ADMIN_EMAIL', 'UAT_ADMIN_PASSWORD', 'UAT_MANAGER_EMAIL', 'UAT_MANAGER_PASSWORD', 'UAT_VIEWER_EMAIL', 'UAT_VIEWER_PASSWORD']) {
    assert.doesNotMatch(technicalJob, new RegExp(`\\b${name}\\b`));
    assert.match(authenticatedJob, new RegExp(`\\b${name}\\b`));
  }
  assert.match(authenticatedJob, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(workflow, /test\/q11-production-assurance-sentinel/);
  assert.match(authenticatedSmoke, /Employee Lifecycle management, history, state, and preflight/);
  assert.match(authenticatedSmoke, /Employee Lifecycle history is read-only and mutations are forbidden/);
  assert.match(authenticatedSmoke, /Employee Lifecycle history and mutations are forbidden/);
  const personaPreflightStep = authenticatedJob.match(/- name: Verify G03\.1 Auth personas have existing 2026 annual authority[\s\S]*?(?=\r?\n      - name: Install Playwright Chromium)/)?.[0] || '';
  assert.match(personaPreflightStep, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(personaPreflightStep, /DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/);
  assert.match(personaPreflightStep, /APPROVED_DATABASE_TARGET_FINGERPRINT/);
  const authenticatedWithoutPersonaPreflight = authenticatedJob.replace(personaPreflightStep, '');
  for (const name of ['DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET']) {
    assert.doesNotMatch(technicalJob, new RegExp(`\\b${name}\\b`));
    assert.doesNotMatch(authenticatedWithoutPersonaPreflight, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(personaPreflightStep, /\bJWT_SECRET\b/);

  assert.match(workflow, /target_mode:/);
  assert.match(workflow, /- preview/);
  assert.match(workflow, /- candidate/);
  assert.match(workflow, /- canonical/);
  assert.match(workflow, /uat-target-contract\.js scope/);
  assert.match(workflow, /uat-target-contract\.js verify/);
  assert.match(workflow, /api\.vercel\.com\/v13\/deployments/);
  assert.match(workflow, /withGitRepoInfo=true/);
  assert.match(workflow, /uat-vercel-identity\.js sanitize/);
  assert.match(workflow, /DEPLOYMENT_IDENTITY_SOURCE=VERCEL_REST_V13/);
  assert.doesNotMatch(workflow, /vercel@"\$VERCEL_CLI_VERSION" inspect/);
  assert.equal((workflow.match(/VERCEL_TOKEN: \$\{\{ secrets\.VERCEL_TOKEN \}\}/g) || []).length, 2);
  const authenticatedRunStep = workflow.match(/- name: Run authenticated UAT V3[\s\S]*?(?=\r?\n      - name: Publish authenticated UAT summary)/)?.[0] || '';
  const technicalRunStep = workflow.match(/- name: Run technical UAT V3 without credentials[\s\S]*?(?=\r?\n      - name: Publish technical UAT summary)/)?.[0] || '';
  assert.doesNotMatch(authenticatedRunStep, /VERCEL_TOKEN/);
  assert.doesNotMatch(technicalRunStep, /VERCEL_TOKEN/);
  for (const runStep of [technicalRunStep, authenticatedRunStep]) {
    assert.match(runStep, /sanitizeArtifactContent/);
    assert.match(runStep, /sanitizedContent\.equals\(content\)/);
    assert.match(runStep, /scanArtifact\(relativePath, sanitizedContent/);
  }
});

test('V3 isolates Report Center diagnostics without changing the global timeout', () => {
  assert.match(authenticatedSmoke, /navigation shell/);
  assert.match(authenticatedSmoke, /protected page/);
  assert.match(authenticatedSmoke, /Unified Report Center acceptance/);
  assert.match(authenticatedSmoke, /UAT diagnostic \$\{role\}: dashboard observation/);
  assert.match(authenticatedSmoke, /performAndWaitForHeavyRequest/);
  assert.match(authenticatedSmoke, /requestfinished|performAndWaitForHeavyRequest/);
  assert.match(authenticatedSmoke, /const reportCenterEvidence = monitor\.safeEvidence\(\)/);
  assert.match(authenticatedSmoke, /testInfo\.attach\('v32-page-monitor\.json'/);
  assert.match(observe, /apiFailureCode/);
  assert.match(observe, /DASHBOARD/);
  assert.match(authenticatedSmoke, /test\.setTimeout\(180_000\)/);
  assert.match(playwrightConfig, /timeout: 45_000/);
  assert.doesNotMatch(playwrightConfig, /timeout:\s*180_000/);
  for (const source of [adminSmoke, rolesSmoke, responsiveSmoke, technicalSmoke, regressionSmoke, authBoundarySmoke]) {
    assert.match(source, /isReportCenterDiagnostic\(\)/);
  }
  assert.match(authenticatedSmoke, /Lifecycle coverage is outside the selected UAT scope/);
  assert.match(responsiveSmoke, /test\.setTimeout\(120_000\)/);
  assert.match(responsiveSmoke, /createStageTracker/);
  assert.match(responsiveSmoke, /fullPage: false/);
  assert.match(technicalSmoke, /test\.setTimeout\(60_000\)/);
  assert.match(technicalSmoke, /page\.request\.post\('\/api\/v1\/auth\/refresh'/);
  assert.match(technicalSmoke, /REFRESH_AUTHORIZATION_BOUNDARY_FAILED/);
  assert.match(technicalSmoke, /installUnauthenticatedRefreshBoundary\(page\)/);
  assert.match(technicalSmoke, /form\.login-form/);
  assert.match(technicalSmoke, /form\.locator\('input#password'\)/);
  assert.doesNotMatch(technicalSmoke, /getByLabel\('รหัสผ่าน', \{ exact: true \}\)/);
  assert.match(uatTestFixture, /page\.addInitScript/);
  assert.match(uatTestFixture, /window\.fetch = async/);
  assert.match(uatTestFixture, /url\.pathname === '\/api\/v1\/auth\/refresh'/);
  assert.match(uatTestFixture, /return new Response/);
  assert.match(uatTestFixture, /status: 403/);
  assert.match(uatTestFixture, /__uatTechnicalRefreshBoundaryInstalled/);
  assert.match(uatTestFixture, /__uatTechnicalRefreshBoundaryHits/);
  assert.doesNotMatch(uatTestFixture, /unauthenticatedRefreshBoundaryPages/);
  assert.match(technicalSmoke, /technical-login-render-state-/);
  assert.match(technicalSmoke, /appendSafeLoginRenderDiagnostic/);
  assert.match(technicalSmoke, /UAT_STAGE_DIAGNOSTIC_FILE/);
  assert.match(technicalSmoke, /pathnameIsLogin/);
  assert.match(technicalSmoke, /refreshBoundaryInstalled/);
  assert.match(technicalSmoke, /refreshBoundaryHits/);
  assert.match(technicalSmoke, /monitor\.safeEvidence\(\)/);
  assert.match(technicalSmoke, /toBeVisible\(\{ timeout: 15_000 \}\)/);
  assert.match(technicalSmoke, /fullPage: false/);
  assert.match(observe, /fullPage = true/);
  const refreshReady = performanceSmoke.indexOf("await expect(refreshButton).toBeEnabled({ timeout: 60_000 });");
  const refreshBaseline = performanceSmoke.indexOf("const summaryBeforeRefresh = observer.count('/api/v1/reports/summary');");
  assert.ok(refreshReady >= 0 && refreshReady < refreshBaseline, 'Explicit refresh baseline must be captured after the refresh control is ready.');
});

test('V3 scopes intentional duplicate Report Center export controls semantically', () => {
  const exportStage = authenticatedSmoke.match(/'RC10_EXPORT_CONTROL'[\s\S]*?(?=const executiveCenter)/)?.[0] || '';
  assert.match(exportStage, /\.report-center-export-card/);
  assert.match(exportStage, /filter\(\{ hasText: 'รายงานผู้บริหาร PDF' \}\)/);
  assert.match(exportStage, /\.report-center-quick-export/);
  assert.match(exportStage, /รายงานผู้บริหาร PDF/);
  assert.match(exportStage, /exportCardButton\)\.toHaveCount\(1\)/);
  assert.match(exportStage, /quickExportButton\)\.toHaveCount\(1\)/);
  assert.doesNotMatch(exportStage, /center\.getByRole\('button', \{ name: 'ส่งออก PDF', exact: true \}\)\.toBeVisible/);
  assert.match(authenticatedSmoke, /executiveCenter\.locator\('\.report-center-quick-export'\)/);
  assert.doesNotMatch(exportStage, /\.(first|last|nth)\(/);
});
