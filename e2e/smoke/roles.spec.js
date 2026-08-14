const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { hasRoleCredentials, isReportCenterDiagnostic } = require('../helpers/uat-config');
const { expectApiSuccess, navigateTo, startPageMonitor } = require('../helpers/uat-observe');

for (const role of ['MANAGER', 'VIEWER']) {
  test.describe(`${role} authenticated smoke`, () => {
    test.skip(isReportCenterDiagnostic() || !hasRoleCredentials(role), `${role} smoke is outside the selected UAT scope or credentials are unavailable.`);
    test(`${role}: allowed dashboard and privileged navigation stay bounded`, async ({ page }) => {
      test.slow();
      const monitor = startPageMonitor(page, {
        allowedApiResponses: role === 'VIEWER' ? [{ path: '/api/v1/licenses', status: 403 }] : []
      });
      await loginAs(page, role);
      await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();
      await expect(page.getByRole('button', { name: /บันทึกการใช้งานระบบ/ })).toHaveCount(0);

      if (role === 'MANAGER') {
        await expectApiSuccess(page, '/api/v1/schedule-calendar', () => navigateTo(page, 'schedule'));
      } else {
        await expect(page.getByRole('button', { name: /ใบอนุญาต รปภ\./ })).toHaveCount(0);
      }

      monitor.assertClean();
    });
  });
}
