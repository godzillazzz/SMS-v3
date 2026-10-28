import { expect, test } from '@playwright/test';
import { readinessTimeout } from '../support/readiness';

// Owner 2026-10-28: supervisors could not approve leave from the PWA "ลา" tab on mobile.
test('Supervisor in the PWA Leave tab sees the pending request with approve and reject buttons', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const pending = { id: 'leave-1', employeeId: 'emp-1', employee: { id: 'emp-1', employeeCode: 'EMP001', firstName: 'ยุทธนา', lastName: 'ทดสอบ', department: 'WCS' }, leaveType: 'ลาป่วย', employeeNameSnapshot: 'ยุทธนา ทดสอบ', employeeCodeSnapshot: 'EMP001', dayCount: 1, startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-01T00:00:00.000Z', days: 1, reason: 'ไม่สบาย', status: 'PENDING', createdAt: '2026-10-28T03:24:00.000Z' };
  await page.route('**/api/v1/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/api/v1/leave-requests'
      ? { data: [pending], meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 } }
      : { data: [], summary: { total: 0, byType: {} }, meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  let authenticated = false;
  const session = { accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: 'supervisor@example.test', displayName: 'SUPERVISOR Fixture', role: 'SUPERVISOR' } };
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill(authenticated ? { status: 200, contentType: 'application/json', body: JSON.stringify(session) } : { status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) }));
  await page.route('**/api/v1/auth/passkeys/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.route('**/api/v1/auth/login', (route) => { authenticated = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }); });

  await page.goto('/?pwa=1&page=leave');
  await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
  await page.locator('#email').fill('supervisor@example.test');
  await page.locator('#password').fill('fixture-password');
  const login = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/auth/login', { timeout: readinessTimeout() });
  await page.locator('#auth-login-form button[type="submit"]').click();
  expect((await login).status()).toBe(200);

  const card = page.locator('.leave-pending-card');
  await expect(card).toBeVisible({ timeout: readinessTimeout() });
  await expect(card.getByText('ยุทธนา', { exact: false }).first()).toBeVisible();
  await expect(card.getByRole('button', { name: /^อนุมัติ/ }).first()).toBeVisible();
  await expect(card.getByRole('button', { name: /ไม่อนุมัติ/ }).first()).toBeVisible();
});
