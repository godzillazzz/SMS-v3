const { test, expect, installUnauthenticatedRefreshBoundary } = require('../helpers/uat-test');
const { isReportCenterDiagnostic } = require('../helpers/uat-config');
const { scrubLoginCredentialDom } = require('../helpers/uat-auth');
const { assertNoHorizontalOverflow, captureScreenshot, startPageMonitor } = require('../helpers/uat-observe');
const { createStageTracker } = require('../helpers/uat-stage');
const {
  assertExpectedStatus,
  assertReadiness,
  classifyOriginBehavior,
  extractViteAssets,
  readJsonResponse,
  readResponseBody,
  automationRequestOptions
} = require('../helpers/technical-smoke');

const viewports = [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 }
];

test.skip(isReportCenterDiagnostic(), 'Technical browser smoke is outside the selected UAT scope.');

test('TECHNICAL: HTTP health, readiness, Vite assets, and audit authorization boundary', async ({ page }, testInfo) => {
  const monitor = startPageMonitor(page);
  const technicalSummary = {
    sourceSha: process.env.UAT_SOURCE_SHA || 'not supplied',
    harnessSha: process.env.UAT_HARNESS_SHA || 'not supplied',
    expectedDeploymentId: process.env.UAT_EXPECTED_DEPLOYMENT_ID || 'not supplied',
    root: 'PASS',
    login: 'PASS',
    health: 'PASS',
    ready: [],
    viteAssets: 'PASS',
    unexpectedNext: 'NONE',
    auditAuthorization: 'PASS',
    origin: 'UNKNOWN'
  };
  const root = await page.goto('/');
  expect(root, 'Root response must exist.').not.toBeNull();
  assertExpectedStatus(root.status(), 200, 'ROOT_HTTP_FAILED');
  const rootHtml = await page.content();
  const assets = extractViteAssets(rootHtml);
  for (const asset of assets) {
    const response = await page.request.get(asset, automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, asset));
    await readResponseBody(response);
    assertExpectedStatus(response.status(), 200, 'VITE_ASSET_HTTP_FAILED');
  }

  const login = await page.request.get('/login', automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, '/login'));
  await readResponseBody(login);
  assertExpectedStatus(login.status(), 200, 'LOGIN_HTTP_FAILED');
  const refresh = await page.request.post('/api/v1/auth/refresh', automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, '/api/v1/auth/refresh'));
  await readResponseBody(refresh);
  assertExpectedStatus(refresh.status(), 403, 'REFRESH_AUTHORIZATION_BOUNDARY_FAILED');
  const health = await page.request.get('/api/v1/health', automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, '/api/v1/health'));
  await readJsonResponse(health, 'HEALTH_PAYLOAD_INVALID');
  assertExpectedStatus(health.status(), 200, 'HEALTH_HTTP_FAILED');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const ready = await page.request.get('/api/v1/ready', automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, '/api/v1/ready'));
    assertExpectedStatus(ready.status(), 200, 'READINESS_HTTP_FAILED');
    assertReadiness(await readJsonResponse(ready, 'READINESS_PAYLOAD_INVALID'));
    technicalSummary.ready.push('PASS');
  }

  const auditEvents = await page.request.get('/api/v1/audit-events?page=1&pageSize=1', automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, '/api/v1/audit-events?page=1&pageSize=1'));
  const auditBody = await readResponseBody(auditEvents);
  assertExpectedStatus(auditEvents.status(), 401, 'AUDIT_AUTHORIZATION_BOUNDARY_FAILED');
  technicalSummary.origin = classifyOriginBehavior({
    targetUrl: process.env.UAT_BASE_URL,
    status: auditEvents.status(),
    body: auditBody
  });
  await testInfo.attach('technical-summary.json', {
    body: Buffer.from(JSON.stringify(technicalSummary)),
    contentType: 'application/json'
  });
  monitor.assertClean();
});

for (const viewport of viewports) {
  test(`TECHNICAL: login page browser smoke ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const monitor = startPageMonitor(page);
    const tracker = createStageTracker({ role: 'TECHNICAL', testCode: `LOGIN_${viewport.name}`, testInfo });
    await installUnauthenticatedRefreshBoundary(page);
    try {
      await tracker.run('NAV01_LOGIN', async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const response = await page.goto('/login');
        expect(response, 'Login response must exist.').not.toBeNull();
        assertExpectedStatus(response.status(), 200, 'LOGIN_HTTP_FAILED');
        extractViteAssets(await page.content());

        const form = page.locator('form.login-form');
        await expect(form).toBeVisible({ timeout: 15_000 });
        const email = form.getByLabel('อีเมล', { exact: true });
        const password = form.getByLabel('รหัสผ่าน', { exact: true });
        const submit = form.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true });
        await expect(email).toBeVisible({ timeout: 15_000 });
        await expect(password).toBeVisible({ timeout: 15_000 });
        await expect(submit).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.full-loader')).toHaveCount(0);
        for (const control of [email, password, submit]) {
          const box = await control.boundingBox();
          expect(box, 'Primary login control must have a viewport box.').not.toBeNull();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        }
        await assertNoHorizontalOverflow(page);
        await scrubLoginCredentialDom(page);
        await captureScreenshot(page, testInfo, `technical-login-${viewport.name}`, { allowLoginForm: true, fullPage: false });
      }, { safeApiPath: '/api/v1/auth/refresh', safeStatus: 403, safeErrorCode: 'UAT_UI_LOGIN_RENDER_FAILED' });
      await tracker.run('RC15_MONITOR', () => monitor.assertClean());
    } finally {
      const renderState = await page.evaluate(() => ({
        readyState: document.readyState,
        pathname: window.location.pathname,
        fullLoaderCount: document.querySelectorAll('.full-loader').length,
        loginFormCount: document.querySelectorAll('form.login-form').length,
        rootChildCount: document.querySelector('#root')?.childElementCount ?? -1,
        moduleScriptCount: document.querySelectorAll('script[type="module"][src]').length,
        resourceScriptCount: performance.getEntriesByType('resource').filter((entry) => entry.initiatorType === 'script').length,
        refreshBoundaryInstalled: Boolean(window.__uatTechnicalRefreshBoundaryInstalled),
        refreshBoundaryHits: Number(window.__uatTechnicalRefreshBoundaryHits || 0)
      })).catch(() => ({ evaluationFailed: true }));
      await testInfo.attach(`technical-login-render-state-${viewport.name}.json`, {
        body: JSON.stringify(renderState),
        contentType: 'application/json'
      });
      await testInfo.attach(`technical-login-monitor-${viewport.name}.json`, {
        body: JSON.stringify(monitor.safeEvidence()),
        contentType: 'application/json'
      });
      await tracker.attach();
    }
  });
}
