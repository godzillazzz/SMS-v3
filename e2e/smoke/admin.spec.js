const { test, expect } = require('../helpers/uat-test');
const { getAuditEventsStatus, loginAs } = require('../helpers/uat-auth');
const { hasRoleCredentials } = require('../helpers/uat-config');
const { automationRequestOptions } = require('../helpers/technical-smoke');
const { expectApiSuccess, navigateTo, startPageMonitor } = require('../helpers/uat-observe');

test.describe.configure({ mode: 'serial' });
test.skip(!hasRoleCredentials('ADMIN'), 'ADMIN authenticated smoke skipped: credentials unavailable.');

test('ADMIN: dashboard is complete and stable after refresh', async ({ page }) => {
  test.slow();
  const monitor = startPageMonitor(page);
  const { accessToken } = await loginAs(page, 'ADMIN');
  await expect(page.getByRole('region', { name: 'Executive snapshot' })).toBeVisible();
  await expect(page.getByText('ข้อมูลบางส่วนยังไม่พร้อม', { exact: false })).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();
  const config = require('../helpers/uat-config').getUatConfig();
  const response = await page.request.get('/api/v1/dashboard', automationRequestOptions(
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 60000 },
    process.env,
    config.baseURL,
    `${config.baseURL}/api/v1/dashboard`
  ));
  expect(response.status(), 'Dashboard response must succeed after refresh.').toBeGreaterThanOrEqual(200);
  expect(response.status(), 'Dashboard response must succeed after refresh.').toBeLessThan(300);
  await expect(page.getByText('ข้อมูลบางส่วนยังไม่พร้อม', { exact: false })).toHaveCount(0);
  monitor.assertClean();
});

test('ADMIN: Schedule, Leave, and License pages load through read endpoints', async ({ page }) => {
  const monitor = startPageMonitor(page);
  await loginAs(page, 'ADMIN');
  await expectApiSuccess(page, '/api/v1/schedule-calendar', () => navigateTo(page, 'schedule'));
  await expectApiSuccess(page, '/api/v1/leave-requests', () => navigateTo(page, 'leave'));
  await expectApiSuccess(page, '/api/v1/licenses', () => navigateTo(page, 'licenses'));
  monitor.assertClean();
});

test('ADMIN: Audit Log remains read-only and can open an existing detail safely', async ({ page }) => {
  const monitor = startPageMonitor(page);
  const { accessToken } = await loginAs(page, 'ADMIN');
  await expect(getAuditEventsStatus(page, accessToken)).resolves.toBe(200);
  await expectApiSuccess(page, '/api/v1/audit-events', () => navigateTo(page, 'audit'));
  const auditPage = page.locator('.audit-compliance-page');
  await expect(auditPage).toBeVisible();
  await expect(auditPage.getByRole('button', { name: /อนุมัติ|ปฏิเสธ|ลบถาวร|แก้ไข/ })).toHaveCount(0);
  const detailButtons = auditPage.getByRole('button', { name: 'ดูรายละเอียด', exact: true });
  if (await detailButtons.count()) {
    await detailButtons.first().click();
    await expect(page.locator('.audit-preview-panel')).toBeVisible();
  } else {
    await expect(auditPage.getByText('ไม่พบรายการ Audit Log ตามเงื่อนไขที่เลือก', { exact: false })).toBeVisible();
  }
  monitor.assertClean();
});
