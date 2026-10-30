import { expect, test, type Page } from '@playwright/test';

const employees = [
  { id: '11111111-1111-4111-8111-111111111111', employeeCode: 'EMP001', firstName: 'สมชาย', lastName: 'ใจดี', displayName: 'สมชาย ใจดี', department: 'ANO', isActive: true },
  { id: '22222222-2222-4222-8222-222222222222', employeeCode: 'EMP002', firstName: 'สมหญิง', lastName: 'รักงาน', displayName: 'สมหญิง รักงาน', department: 'WCS', isActive: true }
];

async function signIn(page: Page, monthPrintRequests: string[]) {
  await page.route('**/api/v1/**', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, total: 0, pageSize: 20, totalPages: 1 } }) }));
  const executiveReport = {
    period: { year: 2026, month: 10, startDate: '2026-10-01', endDate: '2026-10-31', label: 'ตุลาคม 2569' },
    scope: { departmentName: 'ทุกหน่วยงาน', allowsDepartmentFilter: true, availableDepartments: ['ANO', 'WCS'] },
    executiveSummary: [], workforce: { totalEmployees: 2, activeEmployees: 2, byDepartment: [] }, schedule: { assignmentCount: 0, periodNote: '' },
    leave: { totalRequests: 0, statusCounts: {}, byType: [], overlapRule: '' },
    license: { expired: 0, expiringWithin30Days: 0, validBeyond30Days: 0, pendingReview: 0, asOfDate: '2026-10-30' },
    dataQuality: { total: 0, critical: 0, warning: 0, info: 0, categories: [] }, managementAttention: [], generatedAt: '2026-10-30T00:00:00.000Z'
  };
  await page.route('**/api/v1/executive-report**', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: executiveReport }) }));
  await page.route('**/api/v1/employees?**', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: employees, meta: { page: 1, total: 2, pageSize: 100, totalPages: 1 } }) }));
  await page.route('**/api/v1/attendance/supervisor/month-print?**', (request) => {
    monthPrintRequests.push(request.request().url());
    const url = new URL(request.request().url());
    const selectedDate = url.searchParams.get('selectedDate') || '2026-10-01';
    const id = url.searchParams.get('employeeId');
    const rows = employees.filter((employee) => !id || employee.id === id).map((employee) => ({ id: employee.id, employeeCode: employee.employeeCode, employeeName: employee.displayName, department: employee.department, days: [] }));
    return request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { generatedAt: new Date().toISOString(), monthStart: `${selectedDate.slice(0, 8)}01`, selectedDate, scope: { role: 'ADMIN' }, employees: rows } }) });
  });
  await page.route('**/api/v1/auth/refresh', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: 'admin@example.test', displayName: 'ADMIN Fixture', role: 'ADMIN' } }) }));
  await page.route('**/api/v1/auth/passkeys/config', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.addInitScript(() => { window.print = () => { (window as unknown as { __printed?: number }).__printed = ((window as unknown as { __printed?: number }).__printed || 0) + 1; }; });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
  test(`report center export tab fits ${viewport.width}px and prints the chosen employee`, async ({ page }) => {
    const monthPrintRequests: string[] = [];
    await page.setViewportSize(viewport);
    await signIn(page, monthPrintRequests);
    page.on('pageerror', (error) => console.log('PAGEERROR', String(error).slice(0, 300)));
    await page.goto('/app');
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
    await page.goto('/app/reports');
    const exportTab = page.locator('#report-tab-export');
    await expect(exportTab).toBeVisible({ timeout: 10_000 });
    await exportTab.click();
    const panel = page.locator('#report-panel-export');
    // ADMIN sees 5 groups: schedule, personnel, attendance, patrol (owner item 10, 30 Oct 2026), executive.
    await expect(panel.locator('.report-center-export-group')).toHaveCount(5);
    await expect(panel.locator('#export-group-patrol')).toHaveText('การตรวจจุด');
    for (const title of ['รายงานการตรวจจุดประจำวัน', 'รายงานการตรวจจุดรายแผนก', 'รายงานการตรวจจุดทุกแผนก']) await expect(panel.getByRole('heading', { name: title })).toBeVisible();
    for (const title of ['ส่งออกตารางกะ', 'พิมพ์ทะเบียนพนักงาน', 'พิมพ์ทะเบียนใบอนุญาต รปภ.', 'รายงานการลงเวลารายบุคคลของ รปภ.', 'รายงานการลงเวลารายบุคคลทั้งหมด']) {
      await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const cardOverflow = await panel.locator('.report-center-export-card').evaluateAll((cards) => cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length);
    expect(cardOverflow).toBe(0);

    const select = panel.getByLabel('เลือกพนักงานสำหรับพิมพ์รายบุคคล');
    const single = panel.getByRole('button', { name: 'พิมพ์รายบุคคล', exact: true });
    await expect(single).toBeDisabled();
    await expect(select.locator('option')).toHaveCount(3);
    await select.selectOption(employees[1].id);
    await expect(single).toBeEnabled();
    await single.click();
    await expect.poll(() => monthPrintRequests.length).toBe(1);
    expect(new URL(monthPrintRequests[0]).searchParams.get('employeeId')).toBe(employees[1].id);
    await expect(panel.locator('[role="alert"]')).toHaveCount(0);
    await page.screenshot({ path: `test-results/report-center-export-${viewport.width}.png`, fullPage: true });
  });
}
