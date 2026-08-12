const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { getUatConfig } = require('../helpers/uat-config');
const { automationRequestOptions } = require('../helpers/technical-smoke');
const { assertNoHorizontalOverflow, captureScreenshot, expectPrimaryNavigationItem, navigateTo, openPrimaryNavigation, primaryNavigationItem, startPageMonitor } = require('../helpers/uat-observe');
const { getRoleApiMatrix, getRoleNavigationContract, getRolePageChecks } = require('../helpers/uat-v3-role-matrix');

const authenticatedMode = () => String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';

async function expectNavigation(page, role) {
  await openPrimaryNavigation(page);
  const contract = getRoleNavigationContract(role);
  for (const item of contract.required) {
    await expectPrimaryNavigationItem(page, item.id);
  }
  for (const item of contract.forbidden) {
    await expect(primaryNavigationItem(page, item.id), `${role} navigation must hide ${item.label}.`).toHaveCount(0);
  }
}

async function requestRoleMatrix(page, role, token) {
  const config = getUatConfig();
  for (const route of getRoleApiMatrix(role)) {
    const response = await page.request.get(route.path, automationRequestOptions(
      { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 },
      process.env,
      config.baseURL,
      `${config.baseURL}${route.path}`
    ));
    expect(response.status(), `${role} ${route.label} read contract must return ${route.expectedStatus}.`).toBe(route.expectedStatus);
  }
}

for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
  test.describe(`${role} authenticated V3`, () => {
    test(`V3 ${role}: login and role identity`, async ({ page }, testInfo) => {
      test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
      const monitor = startPageMonitor(page);
      const { accessToken } = await loginAs(page, role);
      expect(accessToken).toEqual(expect.any(String));
      await testInfo.attach('v3-role-status.json', { body: JSON.stringify({ role, login: 'PASS' }), contentType: 'application/json' });
      monitor.assertClean();
    });

    test(`V3 ${role}: read-only API authorization and scope`, async ({ page }) => {
      test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
      test.setTimeout(180_000);
      const { accessToken } = await loginAs(page, role);
      await requestRoleMatrix(page, role, accessToken);
    });

    test(`V3 ${role}: navigation and protected pages`, async ({ page }) => {
      test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
      const monitor = startPageMonitor(page);
      await loginAs(page, role);
      await expectNavigation(page, role);
      for (const item of getRolePageChecks(role)) {
        await navigateTo(page, item.id);
        await expect(page.getByRole('heading').first(), `${role} ${item.label} must render a page heading.`).toBeVisible();
      }
      monitor.assertClean();
    });
  });
}

for (const role of ['ADMIN', 'MANAGER']) {
  test(`V3 ${role}: authenticated responsive smoke`, async ({ page }, testInfo) => {
    test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
    const monitor = startPageMonitor(page);
    const pages = role === 'ADMIN' ? ['dashboard', 'schedule', 'dataQuality', 'audit', 'executiveReport'] : ['dashboard', 'schedule', 'executiveReport'];
    await loginAs(page, role);
    for (const viewport of [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1440', width: 1440, height: 900 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if (viewport.name !== '390') await page.goto('/');
      for (const pageId of pages) {
        await navigateTo(page, pageId);
        await expect(page.getByRole('heading').first()).toBeVisible();
        await assertNoHorizontalOverflow(page);
      }
      await captureScreenshot(page, testInfo, `v3-${role.toLowerCase()}-${viewport.name}`);
    }
    monitor.assertClean();
  });
}
