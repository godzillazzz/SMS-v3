const { test, expect } = require('../helpers/uat-test');
const { getAuditEventsStatus, loginAs } = require('../helpers/uat-auth');
const { getUatConfig, hasRoleCredentials } = require('../helpers/uat-config');
const { automationRequestOptions } = require('../helpers/technical-smoke');
const { expectApiSuccess, navigateTo, startPageMonitor } = require('../helpers/uat-observe');

for (const role of ['MANAGER', 'VIEWER']) {
  test.describe(`${role} authenticated smoke`, () => {
    test.skip(!hasRoleCredentials(role), `${role} authenticated smoke skipped: credentials unavailable.`);
    test(`${role}: allowed dashboard is available and Audit Log stays denied`, async ({ page }) => {
      const monitor = startPageMonitor(page);
      const { accessToken } = await loginAs(page, role);
      await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();
      await expect(page.getByRole('button', { name: /บันทึกการใช้งานระบบ/ })).toHaveCount(0);
      await expect(getAuditEventsStatus(page, accessToken)).resolves.toBe(403);

      if (role === 'MANAGER') {
        await expectApiSuccess(page, '/api/v1/schedule-calendar', () => navigateTo(page, 'ตารางกะรายเดือน'));
      } else {
        const config = getUatConfig();
        const response = await page.request.get('/api/v1/licenses?page=1&pageSize=20', automationRequestOptions(
          { headers: { Authorization: `Bearer ${accessToken}` } },
          process.env,
          config.baseURL,
          `${config.baseURL}/api/v1/licenses?page=1&pageSize=20`
        ));
        expect(response.status()).toBe(403);
        await expect(page.getByRole('button', { name: /ใบอนุญาต รปภ\./ })).toHaveCount(0);
      }

      monitor.assertClean();
    });
  });
}
