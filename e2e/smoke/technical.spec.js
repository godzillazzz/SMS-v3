const { test, expect } = require('../helpers/uat-test');
const { assertNoHorizontalOverflow, captureScreenshot, startPageMonitor } = require('../helpers/uat-observe');
const {
  assertExpectedStatus,
  assertReadiness,
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

test('TECHNICAL: HTTP health, readiness, Vite assets, and audit authorization boundary', async ({ page }) => {
  const monitor = startPageMonitor(page);
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
  const health = await page.request.get('/api/v1/health', automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, '/api/v1/health'));
  await readJsonResponse(health, 'HEALTH_PAYLOAD_INVALID');
  assertExpectedStatus(health.status(), 200, 'HEALTH_HTTP_FAILED');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const ready = await page.request.get('/api/v1/ready', automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, '/api/v1/ready'));
    assertExpectedStatus(ready.status(), 200, 'READINESS_HTTP_FAILED');
    assertReadiness(await readJsonResponse(ready, 'READINESS_PAYLOAD_INVALID'));
  }

  const auditEvents = await page.request.get('/api/v1/audit-events?page=1&pageSize=1', automationRequestOptions({ timeout: 20_000 }, process.env, process.env.UAT_BASE_URL, '/api/v1/audit-events?page=1&pageSize=1'));
  await readResponseBody(auditEvents);
  assertExpectedStatus(auditEvents.status(), 401, 'AUDIT_AUTHORIZATION_BOUNDARY_FAILED');
  monitor.assertClean();
});

for (const viewport of viewports) {
  test(`TECHNICAL: login page browser smoke ${viewport.name}`, async ({ page }, testInfo) => {
    const monitor = startPageMonitor(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const response = await page.goto('/login');
    expect(response, 'Login response must exist.').not.toBeNull();
    assertExpectedStatus(response.status(), 200, 'LOGIN_HTTP_FAILED');
    extractViteAssets(await page.content());

    const email = page.getByLabel('อีเมล');
    const password = page.getByLabel('รหัสผ่าน');
    const submit = page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true });
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(submit).toBeVisible();
    for (const control of [email, password, submit]) {
      const box = await control.boundingBox();
      expect(box, 'Primary login control must have a viewport box.').not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, testInfo, `technical-login-${viewport.name}`);
    monitor.assertClean();
  });
}
