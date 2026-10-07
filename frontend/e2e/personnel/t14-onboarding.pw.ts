import { expect, test, type Page, type TestInfo } from '@playwright/test';

const employee = { id: 'employee-t14', employeeCode: 'E014', firstName: 'ปวีณ์', lastName: 'พร้อมงาน', department: 'AN1', jobTitle: 'เจ้าหน้าที่', isActive: true };

async function mockApis(page: Page) {
  const requests: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}${url.search}`);
    if (request.method() !== 'GET') return route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture is read-only' }) });
    if (url.pathname === '/api/v1/employees') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [employee], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1, departments: ['AN1'], summary: { total: 1, active: 1, incomplete: 0 } } }) });
    if (url.pathname === '/api/v1/employees/readiness/center') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ employee, status: 'READY', checks: {}, blockers: [] }], summary: { total: 1, ready: 1, notReady: 0, blockerCounts: {} }, limitedTo: 50 }) });
    if (url.pathname === `/api/v1/employees/${employee.id}/change-requests`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    if (url.pathname === `/api/v1/employees/${employee.id}/lifecycle-history`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    if (url.pathname === `/api/v1/employee-reference-photos/employee/${employee.id}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { activePhoto: null, pendingPhoto: null } }) });
    if (url.pathname === '/api/v1/users') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'user-t14', employeeId: employee.id, accountStatus: 'ACTIVE', isActive: true, role: 'ADMIN' }] }) });
    if (url.pathname === '/api/v1/licenses') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'license-t14', employeeId: employee.id, licenseType: 'รปภ.', expiryDate: '2027-06-01', status: 'Active' }], meta: { page: 1, pageSize: 1000, total: 1, totalPages: 1 } }) });
    if (url.pathname === '/api/v1/leave-quotas') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ employeeId: employee.id, quotaYear: 2026, sickLeave: 30, sickLeaveRemaining: 28, personalLeave: 3, personalLeaveRemaining: 3, vacationLeave: 6, vacationLeaveRemaining: 6 }], meta: { page: 1, total: 1, totalPages: 1, quotaYear: 2026 } }) });
    if (url.pathname === `/api/v1/employees/${employee.id}/onboarding-readiness`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { employeeId: employee.id, status: 'NOT_READY', checks: { account: { ready: true }, referencePhoto: { ready: false }, schedule: { ready: true, approvalStatus: 'APPROVED' }, site: { ready: true, name: 'ไซต์ AN1' }, device: { ready: false, activeCount: 0 } }, blockers: [{ code: 'REFERENCE_PHOTO_REQUIRED', label: 'Reference Photo', detail: 'legacy aggregate only' }] } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }) });
  });
  return requests;
}

for (const viewport of [{ width: 1366, height: 768, label: 'desktop' }, { width: 375, height: 812, label: 'mobile' }]) {
  test(`T14 onboarding checklist is readable and server-sourced on ${viewport.label}`, async ({ page }, testInfo: TestInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const requests = await mockApis(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/e2e/personnel/fixture.html');
    await page.locator(`[data-personnel-id="${employee.id}"] .personnel-name-button`).click();

    const dialog = page.getByRole('dialog', { name: 'ปวีณ์ พร้อมงาน' });
    await expect(dialog).toBeVisible();
    const checklist = dialog.getByRole('list', { name: 'รายการเตรียมความพร้อมของพนักงาน' });
    await expect(checklist).toContainText('บัญชีผู้ใช้เชื่อมโยง');
    await expect(checklist).toContainText('ยังใช้งาน 1 รายการ');
    await expect(checklist).toContainText('ป่วย 28 · ธุระ 3 · พักร้อน 6 วัน');
    await expect(checklist).toContainText('จุดรักษาความปลอดภัย');
    await expect(checklist).toContainText('อุปกรณ์ลงเวลาตามสัญญาระบบ');
    await expect(checklist).toContainText('ยังไม่พบ');
    await expect(checklist).not.toContainText('Reference Photo');
    await expect(checklist).not.toContainText('legacy aggregate only');
    await expect(checklist.getByRole('link', { name: 'ไปจัดการ' }).first()).toHaveAttribute('href', `/app/users?employeeId=${employee.id}`);
    await expect(checklist.getByRole('link', { name: 'ไปจัดการ' }).nth(1)).toHaveAttribute('href', `/app/licenses?employeeId=${employee.id}`);
    await expect(checklist.getByRole('link', { name: 'ไปจัดการ' }).nth(2)).toHaveAttribute('href', `/app/leave/quotas?employeeId=${employee.id}&year=2026`);
    await expect(checklist.getByRole('link', { name: 'ไปจัดการ' }).nth(3)).toHaveAttribute('href', `/app/roster?employeeId=${employee.id}`);
    await expect(checklist.getByRole('link', { name: 'ไปจัดการ' }).nth(4)).toHaveAttribute('href', `/app/sites?employeeId=${employee.id}`);
    await expect(checklist.getByRole('link', { name: 'ไปจัดการ' }).nth(5)).toHaveAttribute('href', `/app/devices?employeeId=${employee.id}`);
    await expect(page.locator('.personnel-onboarding-note')).toContainText('แต่ละระบบยังคงตรวจสอบสิทธิ์');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(requests.some((request) => request.includes(`/licenses?page=1&pageSize=1000&employeeStatus=ALL&employeeId=${employee.id}`))).toBe(true);
    expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`t14-onboarding-${viewport.label}.png`), fullPage: true });
  });
}
