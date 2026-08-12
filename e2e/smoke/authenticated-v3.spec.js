const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { getUatConfig } = require('../helpers/uat-config');
const { automationRequestOptions } = require('../helpers/technical-smoke');
const { assertNoHorizontalOverflow, captureScreenshot, navigateTo, startPageMonitor } = require('../helpers/uat-observe');
const { getRoleApiMatrix, getRoleNavigation } = require('../helpers/uat-v3-role-matrix');

const authenticatedMode = () => String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function openNavigation(page) {
  const menuButton = page.getByRole('button', { name: 'เปิดเมนู', exact: true });
  if (await menuButton.isVisible()) await menuButton.click();
}

async function expectNavigation(page, role) {
  await openNavigation(page);
  const contract = getRoleNavigation(role);
  for (const label of contract.required) {
    await expect(page.getByRole('button', { name: new RegExp(escapeRegExp(label)) }).first(), `${role} navigation must expose ${label}.`).toBeVisible();
  }
  for (const label of contract.forbidden) {
    await expect(page.getByRole('button', { name: new RegExp(escapeRegExp(label)) }), `${role} navigation must hide ${label}.`).toHaveCount(0);
  }
}

async function requestRoleMatrix(page, role, token) {
  const config = getUatConfig();
  for (const route of getRoleApiMatrix(role)) {
    const response = await page.request.get(route.path, automationRequestOptions(
      { headers: { Authorization: `Bearer ${token}` } },
      process.env,
      config.baseURL,
      `${config.baseURL}${route.path}`
    ));
    expect(response.status(), `${role} ${route.label} read contract must return ${route.expectedStatus}.`).toBe(route.expectedStatus);
  }
}

const rolePageSets = {
  ADMIN: ['Dashboard', 'ข้อมูลพนักงาน', 'Schedule Calendar', 'คำขอลา', 'รออนุมัติ', 'ใบอนุญาต รปภ.', 'คุณภาพข้อมูล', 'บันทึกการใช้งานระบบ', 'รายงานผู้บริหาร'],
  MANAGER: ['Dashboard', 'ข้อมูลพนักงาน', 'Schedule Calendar', 'คำขอลา', 'รออนุมัติ', 'ใบอนุญาต รปภ.', 'รายงานผู้บริหาร'],
  VIEWER: ['Dashboard', 'ข้อมูลพนักงาน', 'Schedule Calendar', 'คำขอลา']
};

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
      const { accessToken } = await loginAs(page, role);
      await requestRoleMatrix(page, role, accessToken);
    });

    test(`V3 ${role}: navigation and protected pages`, async ({ page }) => {
      test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
      const monitor = startPageMonitor(page);
      await loginAs(page, role);
      await expectNavigation(page, role);
      for (const label of rolePageSets[role]) {
        await navigateTo(page, label);
        await expect(page.getByRole('heading').first(), `${role} ${label} must render a page heading.`).toBeVisible();
      }
      monitor.assertClean();
    });
  });
}

for (const role of ['ADMIN', 'MANAGER']) {
  test(`V3 ${role}: authenticated responsive smoke`, async ({ page }, testInfo) => {
    test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
    const monitor = startPageMonitor(page);
    const pages = role === 'ADMIN' ? ['Dashboard', 'Schedule Calendar', 'คุณภาพข้อมูล', 'บันทึกการใช้งานระบบ', 'รายงานผู้บริหาร'] : ['Dashboard', 'Schedule Calendar', 'รายงานผู้บริหาร'];
    for (const viewport of [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1440', width: 1440, height: 900 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginAs(page, role);
      for (const label of pages) {
        await navigateTo(page, label);
        await expect(page.getByRole('heading').first()).toBeVisible();
        await assertNoHorizontalOverflow(page);
      }
      await captureScreenshot(page, testInfo, `v3-${role.toLowerCase()}-${viewport.name}`);
    }
    monitor.assertClean();
  });
}
