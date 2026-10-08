import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function signIn(page: Page, target: string, role: 'ADMIN' | 'MANAGER' | 'SUPERVISOR') {
  await page.route('**/api/v1/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/api/v1/schedule-calendar'
      ? { data: { dates: [], employees: [], approval: { status: 'DRAFT' } }, meta: { page: 1, total: 0, pageSize: 20, totalPages: 0 } }
      : { data: [], summary: { total: 0, byType: {} }, meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) }));
  await page.route('**/api/v1/auth/passkeys/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: `${role.toLowerCase()}@example.test`, displayName: `${role} Fixture`, role } })
  }));

  await page.goto(target);
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await page.locator('#email').fill(`${role.toLowerCase()}@example.test`);
  await page.locator('#password').fill('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
}

test('Admin can open schedule approvals from the native sidebar on desktop', async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, '/app/roster/approvals', 'ADMIN');
  await expect(page.getByRole('button', { name: 'อนุมัติตารางกะ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'อนุมัติคำขอลา' })).toBeVisible();
  await page.getByRole('button', { name: 'อนุมัติตารางกะ' }).click();
  await expect(page.getByRole('heading', { name: 'อนุมัติตารางกะ' })).toBeVisible();
  await expect(page).toHaveURL('/app/roster/approvals');
  await page.screenshot({ path: testInfo.outputPath('approval-native-schedule-desktop.png'), fullPage: true });
});

test('Supervisor can open both native approval queues from the mobile drawer', async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, '/app/leave/approvals', 'SUPERVISOR');
  await page.getByRole('button', { name: 'เปิดเมนูหลัก' }).click();
  await expect(page.getByRole('button', { name: 'อนุมัติตารางกะ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'อนุมัติคำขอลา' })).toBeVisible();
  await page.getByRole('button', { name: 'อนุมัติตารางกะ' }).click();
  await expect(page.getByRole('heading', { name: 'อนุมัติตารางกะ' })).toBeVisible();
  await page.getByRole('button', { name: 'เปิดเมนูหลัก' }).click();
  await page.getByRole('button', { name: 'อนุมัติคำขอลา' }).click();
  await expect(page.getByRole('heading', { name: 'อนุมัติคำขอลา' })).toBeVisible();
  await expect(page).toHaveURL('/app/leave/approvals');
  await page.screenshot({ path: testInfo.outputPath('approval-native-leave-mobile.png'), fullPage: true });
});

test('Manager retains leave review while schedule review stays limited to existing reviewer roles', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, '/app/leave/approvals', 'MANAGER');
  await expect(page.getByRole('heading', { name: 'อนุมัติคำขอลา' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'อนุมัติคำขอลา' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'อนุมัติตารางกะ' })).toHaveCount(0);
});
