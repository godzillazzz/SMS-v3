import { expect, test, type Page } from '@playwright/test';

const employees = [
  { id: 'employee-ready', employeeCode: 'E001', firstName: 'กิตติ', lastName: 'พร้อม', department: 'AN1', jobTitle: 'หัวหน้า', isActive: true },
  { id: 'employee-not-ready', employeeCode: 'E002', firstName: 'นภา', lastName: 'ตรวจเพิ่ม', department: 'AN2', jobTitle: 'พนักงาน', isActive: true },
  { id: 'employee-unchecked', employeeCode: 'E003', firstName: 'ปวีณ์', lastName: 'รอตรวจ', department: 'AN3', jobTitle: 'พนักงาน', isActive: false }
];

const readiness = {
  data: [
    { employee: employees[0], status: 'READY', blockers: [], checks: {} },
    { employee: employees[1], status: 'NOT_READY', blockers: [{ code: 'ACCOUNT_REQUIRED', label: 'User Account', detail: 'ยังไม่มีบัญชี' }], checks: {} }
  ],
  summary: { total: 2, ready: 1, notReady: 1, blockerCounts: { ACCOUNT_REQUIRED: 1 } },
  limitedTo: 50
};

async function mockPersonnelApis(page: Page) {
  const methods: string[] = [];
  await page.route('**/api/v1/employees/readiness/center**', async (route) => {
    methods.push(route.request().method());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(readiness) });
  });
  await page.route(/\/api\/v1\/employees\?/, async (route) => {
    methods.push(route.request().method());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: employees,
        meta: { page: 1, pageSize: 10, total: 2, totalPages: 1, departments: ['AN1', 'AN2'], summary: { total: 2, active: 2, incomplete: 0 } }
      })
    });
  });
  return methods;
}

test('readiness summary is collapsed and personnel table stays high on desktop', async ({ page }) => {
  const methods = await mockPersonnelApis(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/e2e/personnel/fixture.html');

  await expect(page.getByTestId('readiness-summary')).toHaveText('พร้อม 1 · ไม่พร้อม 1');
  const details = page.locator('#attendance-readiness-center-details');
  await expect(details).toBeHidden();
  await expect(page.getByRole('button', { name: 'ดูรายละเอียด' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.personnel-table-card table tbody tr[data-personnel-id]').first()).toBeVisible();
  const firstRowTop = await page.locator('.personnel-table-card table tbody tr[data-personnel-id]').first().evaluate((row) => row.getBoundingClientRect().top + window.scrollY);
  expect(firstRowTop).toBeLessThan(900);
  await expect(page.locator('.data-table-desktop [data-personnel-id="employee-ready"] [data-readiness-status="READY"]')).toHaveText('พร้อม');
  await expect(page.locator('.data-table-desktop [data-personnel-id="employee-not-ready"] [data-readiness-status="NOT_READY"]')).toHaveText('ไม่พร้อม');
  await expect(page.locator('.data-table-desktop [data-personnel-id="employee-unchecked"] [data-readiness-status="UNKNOWN"]')).toHaveText('ไม่มีผลตรวจ');

  await page.getByRole('button', { name: 'ดูรายละเอียด' }).click();
  await expect(details).toBeVisible();
  const filterGroup = page.getByRole('group', { name: 'กรองความพร้อม' });
  await filterGroup.getByRole('button', { name: 'ไม่พร้อม' }).click();
  await expect(page.locator('.attendance-readiness-row')).toHaveCount(1);
  await expect(page.locator('.attendance-readiness-row')).toContainText('นภา ตรวจเพิ่ม');
  await expect(page.locator('.attendance-readiness-row')).toContainText('ไม่พร้อม');
  expect(methods.sort()).toEqual(['GET', 'GET']);
  expect(pageErrors).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
});

test('readiness summary and authoritative status remain readable without mobile overflow', async ({ page }) => {
  await mockPersonnelApis(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/e2e/personnel/fixture.html');

  await expect(page.getByTestId('readiness-summary')).toHaveText('พร้อม 1 · ไม่พร้อม 1');
  await expect(page.locator('.personnel-mobile-readiness[data-readiness-status="READY"]')).toHaveText('พร้อม');
  await expect(page.locator('.personnel-mobile-readiness[data-readiness-status="NOT_READY"]')).toHaveText('ไม่พร้อม');
  await expect(page.locator('.personnel-mobile-readiness[data-readiness-status="UNKNOWN"]')).toHaveText('ไม่มีผลตรวจ');
  await page.getByRole('button', { name: 'ดูรายละเอียด' }).click();
  await expect(page.locator('.attendance-readiness-row')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(pageErrors).toEqual([]);
});
