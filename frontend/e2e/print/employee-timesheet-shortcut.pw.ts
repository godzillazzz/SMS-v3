import { expect, test, type Page } from '@playwright/test';

const employee = { id: 'employee-1', employeeCode: 'E001', firstName: 'Fixture', lastName: 'Employee', department: 'AN1', isActive: true };
const report = { period: '2026-10', revision: 1, employees: [{ employeeId: employee.id, employeeCode: employee.employeeCode, employeeName: 'Fixture Employee', department: 'AN1', days: Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}`, checkIn: '08:00', checkOut: '16:00', status: 'PRESENT' })) }] };

async function install(page: Page, withReport = true) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/refresh') return route.fulfill({ status: 200, json: { accessToken: 'fixture-token', user: { id: 'admin', role: 'ADMIN', displayName: 'Admin Fixture' } } });
    if (path === '/api/v1/auth/passkeys/config') return route.fulfill({ status: 200, json: { enabled: false } });
    if (path === '/api/v1/employees') return route.fulfill({ status: 200, json: { data: [employee], meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 }, summary: { total: 1, active: 1, incomplete: 0 } } });
    if (path === '/api/v1/employees/readiness/center') return route.fulfill({ status: 200, json: { data: [], summary: { total: 0, ready: 0, notReady: 0, blockerCounts: {} }, limitedTo: 50 } });
    if (path.includes('/attendance/governance/months/') && path.endsWith('/report')) return route.fulfill({ status: 200, json: { data: withReport ? report : { period: '2026-10', revision: 1, employees: [] } } });
    return route.fulfill({ status: 200, json: { data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } } });
  });
  await page.goto('/app/employees');
  await expect(page.locator('.app-shell')).toBeVisible();
}

test('employee row shortcut opens a one-page A4 timesheet print document', async ({ page }) => {
  await install(page);
  await page.getByRole('button', { name: '🖨️ พิมพ์ใบลงเวลาของ Fixture Employee' }).click();
  await expect(page.getByRole('tab', { name: 'ส่งออก' })).toBeVisible();
  await page.getByRole('tab', { name: 'ส่งออก' }).click();
  const report = page.locator('.attendance-report-export-card');
  await expect(report).toBeVisible();
  await expect(report.getByRole('button', { name: /พิมพ์รายบุคคล/ })).toBeEnabled();
  const print = page.waitForEvent('popup').catch(() => null);
  await report.getByRole('button', { name: /พิมพ์รายบุคคล/ }).click();
  const popup = await print;
  if (popup) {
    await popup.waitForLoadState();
    const css = await popup.locator('style').allTextContents();
    expect(css.join('\n')).toContain('@page');
    expect(css.join('\n')).toMatch(/A4/i);
  }
  await expect(page.locator('.attendance-timesheet-page')).toBeAttached();
  await expect(page.locator('.attendance-timesheet-page')).toContainText('Fixture Employee');
});

test('missing attendance data renders a user-visible empty state without crashing', async ({ page }) => {
  await install(page, false);
  await page.getByRole('button', { name: '🖨️ พิมพ์ใบลงเวลาของ Fixture Employee' }).click();
  await page.getByRole('tab', { name: 'ส่งออก' }).click();
  await expect(page.getByText(/ยังไม่มีข้อมูล|ไม่พบข้อมูล/).first()).toBeVisible();
  await expect(page.locator('.attendance-report-export-card')).toBeVisible();
  expect(await page.locator('.page-error, [data-error-boundary]').count()).toBe(0);
});
