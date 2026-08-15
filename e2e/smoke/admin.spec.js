const { test, expect } = require('../helpers/uat-test');
const { bootstrapAs, getAuditEventsStatus, loginAs } = require('../helpers/uat-auth');
const { authenticatedRequest } = require('../helpers/uat-authenticated-request');
const { hasRoleCredentials, isReportCenterDiagnostic } = require('../helpers/uat-config');
const { navigateTo, startPageMonitor } = require('../helpers/uat-observe');
const { getRoleApiMatrix } = require('../helpers/uat-v3-role-matrix');
const { performAndWaitForHeavyRequest } = require('../helpers/uat-heavy-read-v3');

test.describe.configure({ mode: 'serial' });
test.skip(isReportCenterDiagnostic() || !hasRoleCredentials('ADMIN'), 'ADMIN smoke is outside the selected UAT scope or credentials are unavailable.');

test('ADMIN: dashboard is complete and stable after refresh', async ({ page }) => {
  test.slow();
  const monitor = startPageMonitor(page);
  const { accessToken } = await loginAs(page, 'ADMIN');
  await expect(page.getByRole('region', { name: 'Executive snapshot' })).toBeVisible();
  await expect(page.getByText('ข้อมูลบางส่วนยังไม่พร้อม', { exact: false })).toHaveCount(0);
  await performAndWaitForHeavyRequest(page, '/api/v1/dashboard', () => page.reload({ waitUntil: 'domcontentloaded' }));
  await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();
  const response = await authenticatedRequest('/api/v1/dashboard', { accessToken });
  expect(response.status, 'Dashboard response must succeed after refresh.').toBeGreaterThanOrEqual(200);
  expect(response.status, 'Dashboard response must succeed after refresh.').toBeLessThan(300);
  await expect(page.getByText('ข้อมูลบางส่วนยังไม่พร้อม', { exact: false })).toHaveCount(0);
  monitor.assertClean();
});

test('ADMIN: Schedule, Leave, and License pages load through read endpoints', async ({ page }) => {
  const monitor = startPageMonitor(page);
  const { accessToken } = await bootstrapAs(page, 'ADMIN');
  const contracts = getRoleApiMatrix('ADMIN');
  for (const [label, navigationId] of [['Schedule', 'schedule'], ['Leave', 'leave'], ['License', 'licenses']]) {
    const contract = contracts.find((route) => route.label === label);
    const response = await authenticatedRequest(contract.path, { accessToken });
    expect(response.status, `${label} read contract must return ${contract.expectedStatus}.`).toBe(contract.expectedStatus);
    await navigateTo(page, navigationId);
    await expect(page.getByRole('heading').first(), `${label} page must render.`).toBeVisible();
  }
  monitor.assertClean();
});

test('ADMIN: Audit Log remains read-only and can open an existing detail safely', async ({ page }) => {
  const monitor = startPageMonitor(page);
  const { accessToken } = await bootstrapAs(page, 'ADMIN');
  await expect(getAuditEventsStatus(accessToken)).resolves.toBe(200);
  await navigateTo(page, 'audit');
  const auditPage = page.locator('.audit-compliance-page');
  await expect(auditPage).toBeVisible();
  await expect(auditPage.locator('.audit-skeleton-row')).toHaveCount(0, { timeout: 30_000 });
  await expect(auditPage.getByRole('button', { name: /อนุมัติ|ปฏิเสธ|ลบถาวร|แก้ไข/ })).toHaveCount(0);
  const detailButtons = auditPage.locator('.audit-desktop-table button.audit-preview-link:visible');
  if (await detailButtons.count()) {
    await detailButtons.first().click();
    await expect(page.locator('.audit-preview-panel')).toBeVisible();
  } else {
    await expect(auditPage.getByText('ไม่พบรายการ Audit Log ตามเงื่อนไขที่เลือก', { exact: false })).toBeVisible();
  }
  monitor.assertClean();
});
