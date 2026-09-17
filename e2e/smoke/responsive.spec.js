const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { hasRoleCredentials, isReportCenterDiagnostic } = require('../helpers/uat-config');
const { assertNoHorizontalOverflow, captureScreenshot, navigateTo, startPageMonitor } = require('../helpers/uat-observe');
const { createStageTracker } = require('../helpers/uat-stage');

const viewports = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false }
];

test.skip(isReportCenterDiagnostic() || !hasRoleCredentials('ADMIN'), 'ADMIN responsive smoke is outside the selected UAT scope or credentials are unavailable.');

for (const viewport of viewports) {
  test(`ADMIN responsive smoke ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const monitor = startPageMonitor(page);
    const tracker = createStageTracker({ role: 'ADMIN', testCode: `RESPONSIVE_${viewport.name}`, testInfo });
    try {
      await tracker.run('NAV01_LOGIN', async () => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loginAs(page, 'ADMIN');
      }, { safeApiPath: '/api/v1/dashboard' });
      await tracker.run('NAV03_DASHBOARD', async () => {
        await expect(page.locator('section.dashboard-page-v2[aria-label="Operations Dashboard"]')).toBeVisible();
        await assertNoHorizontalOverflow(page);
        await captureScreenshot(page, testInfo, `uat-admin-dashboard-${viewport.name}`, { fullPage: false });
      }, { safeApiPath: '/api/v1/dashboard' });

      await tracker.run('NAV08_AUDIT', async () => {
        await navigateTo(page, 'audit');
        await expect(page.locator('.audit-compliance-page')).toBeVisible();
        const desktopTable = page.locator('.audit-desktop-table');
        const mobileCards = page.locator('.audit-mobile-cards');
        if (viewport.mobile) {
          await expect(mobileCards).toBeVisible();
          await expect(desktopTable).toBeHidden();
        } else {
          await expect(desktopTable).toBeVisible();
          await expect(mobileCards).toBeHidden();
          await expect(page.locator('.audit-desktop-table table thead')).toBeVisible();
        }
        await assertNoHorizontalOverflow(page);
        await captureScreenshot(page, testInfo, `uat-admin-audit-${viewport.name}`, { fullPage: false });
      });
      await tracker.run('RC15_MONITOR', () => monitor.assertClean());
    } finally {
      await tracker.attach();
    }
  });
}
