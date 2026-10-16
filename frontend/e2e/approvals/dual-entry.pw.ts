import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function signIn(page: Page, target: string, role: 'ADMIN' | 'MANAGER' | 'SUPERVISOR') {
  await page.route('**/api/v1/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/api/v1/schedule-calendar'
      ? { data: { dates: [], employees: [], approval: { status: 'DRAFT' } }, meta: { page: 1, total: 0, pageSize: 20, totalPages: 0 } }
      : { data: [], summary: { total: 0, byType: {} }, meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  let authenticated = false;
  const session = { accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: `${role.toLowerCase()}@example.test`, displayName: `${role} Fixture`, role } };
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill(authenticated
    ? { status: 200, contentType: 'application/json', body: JSON.stringify(session) }
    : { status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) }));
  await page.route('**/api/v1/auth/passkeys/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.route('**/api/v1/auth/login', (route) => {
    authenticated = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session)
    });
  });

  await page.goto(target);
  // Wait for the real lazy login surface; filling its Suspense fallback can lose input.
  await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
  await page.locator('#email').fill(`${role.toLowerCase()}@example.test`);
  await page.locator('#password').fill('fixture-password');
  const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST');
  await page.locator('#auth-login-form button[type="submit"]').click();
  expect((await loginResponse).status()).toBe(200);
}

test('Admin sees no schedule-approval sidebar shortcut and can use Approval Center on desktop', async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, '/app', 'ADMIN');
  await expect(page.locator('[data-navigation-id="approvals"]')).toHaveCount(0);
  await page.locator('[data-navigation-id="approvalCenter"]').click();
  await expect(page.getByRole('heading', { name: 'ศูนย์อนุมัติคำขอ' })).toBeVisible();
  await expect(page.locator('.approval-center-page')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('approval-native-schedule-desktop.png'), fullPage: true });
});

test('Supervisor sees no schedule-approval sidebar shortcut on mobile and can use Approval Center', async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, '/app', 'SUPERVISOR');
  await page.getByRole('button', { name: 'เปิดเมนูหลัก' }).click();
  await expect(page.locator('[data-navigation-id="approvals"]')).toHaveCount(0);
  await page.locator('[data-navigation-id="approvalCenter"]').click();
  await expect(page.getByRole('heading', { name: 'ศูนย์อนุมัติคำขอ' })).toBeVisible();
  await expect(page.locator('.approval-center-page')).toBeVisible();
  await page.goto('/app/leave/approvals');
  await expect(page).toHaveURL('/app/leave/approvals');
  await expect(page.getByRole('heading', { name: 'อนุมัติคำขอลา' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'อนุมัติคำขอลา' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('approval-native-leave-mobile.png'), fullPage: true });
});

test('Manager retains leave review while schedule review stays limited to existing reviewer roles', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, '/app/approvals?type=LEAVE', 'MANAGER');
  await expect(page.getByRole('heading', { name: 'ศูนย์อนุมัติคำขอ' })).toBeVisible();
  await expect(page.getByRole('button', { name: /ลา/ }).first()).toBeVisible();
  await expect(page.locator('[data-navigation-id="approvals"]')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="leavePending"]')).toBeVisible();
  await page.locator('[data-navigation-id="leavePending"]').click();
  await expect(page).toHaveURL('/app/leave/approvals');
  await expect(page.getByRole('heading', { name: 'อนุมัติคำขอลา' })).toBeVisible();
});
