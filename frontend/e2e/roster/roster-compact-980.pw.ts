import { expect, test, type Page } from '@playwright/test';
import { readinessTimeout } from '../support/readiness';

// Regression for Owner screenshot (2026-10-28): landscape mobile browser/Desktop-site uses about 980 CSS px.
test('980px roster cells show only D/N/AL/OFF codes, with time and MANUAL retained as non-text metadata', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 980, height: 520 });
  const row = {
    id: 'employee-1', employeeCode: 'EMP017', firstName: 'พนักงาน', lastName: 'ทดสอบ', department: 'AN1',
    shifts: [
      { id: 'shift-1', workDate: '2026-10-01', source: 'SMS_V3', locked: true, startTime: '19:00', endTime: '07:00', shiftType: { code: 'N', name: 'Night Shift' } },
      { id: 'shift-2', workDate: '2026-10-02', source: 'SMS_V3', startTime: '00:00', endTime: '00:00', shiftType: { code: 'OFF', name: 'Day Off' } }
    ]
  };
  let authenticated = false;
  const session = { accessToken: 'fixture-access-token', user: { id: 'admin-1', email: 'admin@example.test', displayName: 'ADMIN Fixture', role: 'ADMIN' } };
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/auth/refresh') return route.fulfill(authenticated ? { status: 200, json: session } : { status: 401, json: { message: 'No active session' } });
    if (url.pathname === '/api/v1/auth/passkeys/config') return route.fulfill({ status: 200, json: { enabled: false } });
    if (url.pathname === '/api/v1/auth/login') { authenticated = true; return route.fulfill({ status: 200, json: session }); }
    if (url.pathname === '/api/v1/schedule-calendar') return route.fulfill({ status: 200, json: { data: { dates: ['2026-10-01', '2026-10-02'], employees: [row], approval: { status: 'DRAFT' } }, meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
    return route.fulfill({ status: 200, json: { data: [], summary: {}, meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } });
  });
  await page.goto('/app/roster?month=2026-10');
  await expect(page.locator('.nexus-onescreen #auth-login-form')).toBeVisible({ timeout: readinessTimeout() });
  await page.locator('#email').fill('admin@example.test');
  await page.locator('#password').fill('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: readinessTimeout() });
  await expect(page.getByRole('heading', { name: 'ตารางกะรายเดือน' })).toBeVisible({ timeout: readinessTimeout() });

  const grid = page.locator('.schedule-grid');
  await expect(grid.locator('.calendar-shift b')).toHaveText(['N', 'OFF']);
  await expect(grid.locator('.schedule-time')).toHaveCount(1);
  await expect(grid.locator('.schedule-time')).toBeHidden();
  const manualLabels = grid.getByText('MANUAL', { exact: true });
  await expect(manualLabels).toHaveCount(2);
  await expect(manualLabels.first()).toHaveCSS('font-size', '0px');
  await expect(grid.locator('.calendar-shift').first()).toHaveAttribute('title', /19:00.*07:00/);
  await grid.screenshot({ path: testInfo.outputPath('roster-980-code-only.png') });
});
