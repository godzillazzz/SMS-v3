import { expect, test, type Page, type TestInfo } from '@playwright/test';

const leaveTypes = [
  { id: 'leave-vacation', code: 'VACATION', name: 'ลาพักร้อน', quotaBucket: 'VACATION', isActive: true, isSystem: true, sortOrder: 1 },
  { id: 'leave-unpaid', code: 'UNPAID', name: 'ลาไม่รับค่าจ้าง', quotaBucket: 'NONE', isActive: true, isSystem: false, sortOrder: 2 }
];
const employee = { id: 'fixture-employee-alpha', employeeCode: 'E-100', firstName: 'อัลฟา', lastName: 'ตัวอย่าง', displayName: 'อัลฟา ตัวอย่าง', isActive: true };

function annualSummary(employeeId: string) {
  return { linked: true, employeeId, quotaYear: 2026, entitlement: { sickLeave: 30, personalLeave: 3, vacationLeave: 6 }, used: { sickLeave: 4, personalLeave: 1, vacationLeave: 4 }, remaining: { sickLeave: 26, personalLeave: 2, vacationLeave: 2 } };
}

async function openLeaveForm(page: Page, role: 'MANAGER' | 'VIEWER', testInfo: TestInfo) {
  const requests: Array<{ method: string; pathname: string; url: string; body?: unknown }> = [];
  const submitted: unknown[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const record: { method: string; pathname: string; url: string; body?: unknown } = { method: request.method(), pathname, url: `${pathname}${url.search}` };
    if (request.method() !== 'GET' && request.postData()) {
      try { record.body = JSON.parse(request.postData() || '{}'); } catch { record.body = request.postData(); }
    }
    requests.push(record);
    if (pathname === '/api/v1/auth/refresh') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) });
    if (pathname === '/api/v1/auth/passkeys/config') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) });
    if (pathname === '/api/v1/auth/login') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-leave-token', user: { id: role === 'VIEWER' ? employee.id : 'fixture-manager', email: `${role.toLowerCase()}@example.test`, displayName: role === 'VIEWER' ? employee.displayName : 'หัวหน้างานทดสอบ', role } }) });
    if (pathname === '/api/v1/leave-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: annualSummary(employee.id) }) });
    if (pathname === '/api/v1/leave-types') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: leaveTypes }) });
    if (pathname === '/api/v1/leave-policy') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { sickAttachmentRequiredAfterDays: 3, managerRetroactiveOnBehalfEnabled: true, managerRetroactiveMaxDaysBack: 0 } }) });
    if (pathname === '/api/v1/employees') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: url.searchParams.get('search') ? [employee] : [], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }) });
    if (pathname === '/api/v1/leave-quotas') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ employeeId: employee.id, quotaYear: 2026, vacationLeave: 6, vacationLeaveUsed: 4, vacationLeaveRemaining: 2 }], meta: { page: 1, pageSize: 100, total: 1, totalPages: 1, quotaYear: 2026 } }) });
    if (pathname === '/api/v1/leave-requests' && request.method() === 'POST') {
      const body = record.body as unknown;
      submitted.push(body);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ data: { id: 'fixture-leave-request', ...(body as object), status: 'PENDING' } }) });
    }
    if (pathname === '/api/v1/leave-requests/pending-count') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { total: 0 } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], summary: {}, meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }) });
  });

  await page.goto('/app/leave');
  await expect(page.locator('.nexus-public[data-design="sms-command-nexus-full-bleed"]')).toBeVisible();
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await page.locator('#email').fill(`${role.toLowerCase()}@example.test`);
  await page.locator('#password').fill('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'คำขอลา', exact: true })).toBeVisible();
  await expect(page.locator('.leave-submit-card')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`t13-leave-${role.toLowerCase()}-form.png`), fullPage: true });
  return { requests, submitted, errors };
}

async function fillRequiredLeaveFields(page: Page, startDate: string, endDate = startDate) {
  await page.getByLabel(/ประเภทการลา/).selectOption('VACATION');
  await page.getByLabel(/วันที่เริ่มต้น/).fill(startDate);
  await page.getByLabel(/วันที่สิ้นสุด/).fill(endDate);
  await page.getByLabel(/ผู้ปฏิบัติงานแทน/).fill('พนักงานสำรอง');
}

test('manager searches an employee and sees server-authoritative quota with an advisory only', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { requests, submitted, errors } = await openLeaveForm(page, 'MANAGER', testInfo);
  const employeeSearch = page.getByRole('combobox', { name: /พนักงาน/ });
  await employeeSearch.fill('Alpha');
  await expect(page.getByRole('option', { name: 'E-100 · อัลฟา ตัวอย่าง' })).toBeVisible();
  await page.getByRole('option', { name: 'E-100 · อัลฟา ตัวอย่าง' }).click();
  await fillRequiredLeaveFields(page, '2026-12-01', '2026-12-03');
  const quota = page.locator('.leave-request-quota');
  await expect(quota).toContainText('สิทธิ์ทั้งหมด');
  await expect(quota).toContainText('6 วัน');
  await expect(quota).toContainText('4 วัน');
  await expect(quota).toContainText('2 วัน');
  await expect(quota.getByRole('status')).toContainText('เป็นคำเตือนเท่านั้น');
  const submit = page.getByRole('button', { name: /ยืนยันและส่งคำขอลา/ });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('ส่งคำขอลาสำเร็จแล้ว')).toBeVisible();
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({ employeeId: employee.id, leaveType: 'VACATION', startDate: '2026-12-01', endDate: '2026-12-03' });
  expect(requests.some((entry) => entry.method === 'GET' && entry.url.includes('/leave-quotas?') && entry.url.includes(`employeeId=${employee.id}`))).toBe(true);
  expect(requests.filter((entry) => entry.method === 'POST' && entry.pathname !== '/api/v1/auth/login')).toEqual(expect.arrayContaining([expect.objectContaining({ pathname: '/api/v1/leave-requests' })]));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
  expect(errors).toEqual([]);
});

test('employee form locks identity and omits employeeId from the request at mobile width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { requests, submitted, errors } = await openLeaveForm(page, 'VIEWER', testInfo);
  await expect(page.getByRole('combobox', { name: /พนักงาน/ })).toHaveCount(0);
  await expect(page.locator('.leave-self-employee')).toContainText('อัลฟา ตัวอย่าง');
  await fillRequiredLeaveFields(page, '2026-10-10');
  const quota = page.locator('.leave-request-quota');
  await expect(quota).toContainText('6 วัน');
  await expect(quota).toContainText('4 วัน');
  await expect(quota).toContainText('2 วัน');
  await page.getByRole('button', { name: /ยืนยันและส่งคำขอลา/ }).click();
  await expect(page.getByText('ส่งคำขอลาสำเร็จแล้ว')).toBeVisible();
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).not.toHaveProperty('employeeId');
  expect(submitted[0]).toMatchObject({ leaveType: 'VACATION', startDate: '2026-10-10', endDate: '2026-10-10' });
  expect(requests.filter((entry) => entry.method === 'POST' && entry.pathname !== '/api/v1/auth/login')).toEqual(expect.arrayContaining([expect.objectContaining({ pathname: '/api/v1/leave-requests' })]));
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(errors).toEqual([]);
});
