const { test, expect } = require('@playwright/test');
const { loginAs } = require('../helpers/uat-auth');
const { assertNoHorizontalOverflow, captureScreenshot, navigateTo, startPageMonitor } = require('../helpers/uat-observe');

const viewports = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false }
];

for (const viewport of viewports) {
  test(`ADMIN responsive smoke ${viewport.name}`, async ({ page }, testInfo) => {
    const monitor = startPageMonitor(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginAs(page, 'ADMIN');
    await expect(page.getByRole('region', { name: 'Executive snapshot' })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await captureScreenshot(page, testInfo, `uat-admin-dashboard-${viewport.name}`);

    await navigateTo(page, 'บันทึกการใช้งานระบบ');
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
    await captureScreenshot(page, testInfo, `uat-admin-audit-${viewport.name}`);
    monitor.assertClean();
  });
}
