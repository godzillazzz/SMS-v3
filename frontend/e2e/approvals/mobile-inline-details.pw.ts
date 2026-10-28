import { expect, test, type Page } from '@playwright/test';
import { readinessTimeout } from '../support/readiness';

const item = {
  id: 'attendance-adjustment:11111111-1111-4111-8111-111111111111', requestId: '11111111-1111-4111-8111-111111111111',
  type: 'ATTENDANCE_ADJUSTMENT_REQUEST', title: 'คำขอปรับปรุงเวลา Attendance', status: 'PENDING_ADMIN', sourcePage: 'attendanceSupervisor',
  submittedAt: '2026-10-27T11:28:00.000Z', ageHours: 27, urgency: 'DUE_SOON', sla: { dueSoonHours: 24, overdueHours: 48 },
  employee: { id: 'employee-1', employeeCode: 'UAT-ST-20260902', displayName: 'Sermpong UAT', department: 'WCS' },
  requestedBy: { id: 'user-1', displayName: 'Sermpong UAT', role: 'ADMIN' },
  metadata: { requestType: 'ADJUST_WORK_TIME', workDate: '2026-10-26', revision: 2, reason: 'ทดสอบ', originalCheckInAt: '2026-10-26T00:01:00.000Z', originalCheckOutAt: '2026-10-26T10:02:00.000Z', proposedCheckInAt: '2026-10-26T00:30:00.000Z', proposedCheckOutAt: '2026-10-26T10:30:00.000Z' }
};

async function signIn(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 760 ? 812 : 768 });
  let authenticated = false;
  const session = { accessToken: 'fixture-token', user: { id: 'admin-1', email: 'admin@example.test', displayName: 'ADMIN Fixture', role: 'ADMIN' } };
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth/refresh') return route.fulfill(authenticated ? { status: 200, json: session } : { status: 401, json: { message: 'No session' } });
    if (url.pathname === '/api/v1/auth/passkeys/config') return route.fulfill({ status: 200, json: { enabled: false } });
    if (url.pathname === '/api/v1/auth/login') { authenticated = true; return route.fulfill({ status: 200, json: session }); }
    if (url.pathname === '/api/v1/approval-center/summary') return route.fulfill({ status: 200, json: { summary: { total: 1, byType: { ATTENDANCE_ADJUSTMENT_REQUEST: 1 } } } });
    if (url.pathname === '/api/v1/approval-center') return route.fulfill({ status: 200, json: { data: [item], summary: { total: 1 } } });
    return route.fulfill({ status: 200, json: { data: [], summary: {}, meta: { page: 1, total: 0, totalPages: 0 } } });
  });
  await page.goto('/app');
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await page.locator('#email').fill('admin@example.test');
  await page.locator('#password').fill('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await page.goto('/app/approvals');
  await expect(page.locator('.approval-center-page')).toBeVisible({ timeout: readinessTimeout() });
  if (width < 760) {
    const mobileQueue = page.locator('.approval-queue-mobile');
    await expect(mobileQueue.getByText('26 ต.ค. 2569 · ทดสอบ', { exact: true })).toBeVisible();
    await expect(mobileQueue.getByRole('button', { name: 'ดูรายละเอียด' })).toHaveCount(0);
  }
}

test('mobile decision panel shows attendance facts inline and omits the detail action', async ({ page }, testInfo) => {
  await signIn(page, 375);
  await page.locator('.approval-queue-mobile').getByRole('button', { name: 'พิจารณา' }).click();
  const panel = page.locator('.approval-decision-panel');
  await expect(panel).toBeVisible();
  for (const value of ['26 ต.ค. 2569', 'แก้ไขเวลาเข้างาน / ออกงาน', 'ฉบับที่ 2', '07:01 → 07:30', '17:02 → 17:30', 'ทดสอบ']) await expect(panel.getByText(value, { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'ดูรายละเอียด' })).toBeHidden();
  await panel.screenshot({ path: testInfo.outputPath('mobile-inline-details.png') });
});

test('desktop approval queue retains its detail action', async ({ page }) => {
  await signIn(page, 1366);
  await expect(page.locator('.approval-queue-desktop').getByRole('button', { name: 'ดูรายละเอียด' })).toBeVisible();
});
