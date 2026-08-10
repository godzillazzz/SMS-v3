const { test, expect } = require('@playwright/test');
const { getAuditEventsStatus, loginAs } = require('../helpers/uat-auth');
const { expectApiSuccess, navigateTo, startPageMonitor } = require('../helpers/uat-observe');

for (const role of ['MANAGER', 'VIEWER']) {
  test(`${role}: allowed dashboard is available and Audit Log stays denied`, async ({ page }) => {
    const monitor = startPageMonitor(page);
    const { accessToken } = await loginAs(page, role);
    await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: /บันทึกการใช้งานระบบ/ })).toHaveCount(0);
    await expect(getAuditEventsStatus(page, accessToken)).resolves.toBe(403);

    if (role === 'MANAGER') {
      await expectApiSuccess(page, '/api/v1/schedules', () => navigateTo(page, 'ตารางกะรายเดือน'));
    } else {
      await expectApiSuccess(page, '/api/v1/licenses', () => navigateTo(page, 'ใบอนุญาต รปภ.'));
      await expect(page.getByRole('button', { name: /แก้ไขใบอนุญาต|ลบใบอนุญาต/ })).toHaveCount(0);
    }

    monitor.assertClean();
  });
}
