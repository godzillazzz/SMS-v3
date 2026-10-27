import { expect, test, type Page, type Route } from '@playwright/test';

const employees = [
  { id: 'employee-ready', employeeCode: 'E001', firstName: 'กิตติ', lastName: 'พร้อม', department: 'AN1', jobTitle: 'หัวหน้า', isActive: true },
  { id: 'employee-not-ready', employeeCode: 'E002', firstName: 'นภา', lastName: 'ตรวจเพิ่ม', department: 'AN2', jobTitle: 'พนักงาน', isActive: true },
  { id: 'employee-unchecked', employeeCode: 'E003', firstName: 'ปวีณ์', lastName: 'รอตรวจ', department: 'AN3', jobTitle: 'พนักงาน', isActive: false }
];

async function mockPersonnelApis(page: Page) {
  const methods: string[] = [];
  const readinessRequests: string[] = [];
  await page.route('**/api/v1/employees**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    methods.push(request.method());
    if (url.pathname.endsWith('/readiness/center')) {
      readinessRequests.push(request.method());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], summary: { total: 0, ready: 0, notReady: 0 }, limitedTo: 50 }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: employees,
        meta: { page: 1, pageSize: 10, total: employees.length, totalPages: 1, departments: ['AN1', 'AN2', 'AN3'], summary: { total: employees.length, active: 2, incomplete: 0 } }
      })
    });
  });
  return { methods, readinessRequests };
}

test('personnel readiness presentation is removed and the desktop directory remains usable', async ({ page }) => {
  const { methods, readinessRequests } = await mockPersonnelApis(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/e2e/personnel/fixture.html');

  const personnelRows = page.locator('.personnel-table-card table tbody tr[data-personnel-id]');
  await expect(personnelRows).toHaveCount(employees.length);
  await expect(personnelRows).toContainText(['กิตติ พร้อม', 'นภา ตรวจเพิ่ม', 'ปวีณ์ รอตรวจ']);
  await expect(page.getByTestId('readiness-summary')).toHaveCount(0);
  await expect(page.locator('.attendance-readiness-center, [data-readiness-status]')).toHaveCount(0);
  await expect(page.getByText('ความพร้อมก่อนเริ่มลงเวลา')).toHaveCount(0);
  await expect(page.locator('.personnel-table thead')).not.toContainText('ความพร้อม');
  const firstRowTop = await page.locator('.personnel-table-card table tbody tr[data-personnel-id]').first().evaluate((row) => row.getBoundingClientRect().top + window.scrollY);
  expect(firstRowTop).toBeLessThan(900);
  expect(methods).toEqual(['GET']);
  expect(readinessRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
});

test('personnel readiness presentation stays removed on mobile without horizontal page overflow', async ({ page }) => {
  const { methods, readinessRequests } = await mockPersonnelApis(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/e2e/personnel/fixture.html');

  await expect(page.locator('.personnel-mobile-record')).toHaveCount(3);
  await expect(page.locator('.attendance-readiness-center, .personnel-mobile-readiness, [data-readiness-status]')).toHaveCount(0);
  await expect(page.getByText('ความพร้อมก่อนเริ่มลงเวลา')).toHaveCount(0);
  expect(methods).toEqual(['GET']);
  expect(readinessRequests).toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(pageErrors).toEqual([]);
});
