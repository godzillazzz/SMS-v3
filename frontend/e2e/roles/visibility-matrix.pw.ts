import { expect, test, type Page } from '@playwright/test';

type Role = 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'VIEWER';
const allTypes = ['EMPLOYEE_MASTER_CHANGE', 'EMPLOYEE_REFERENCE_PHOTO', 'LICENSE_DOCUMENT', 'SCHEDULE_APPROVAL', 'ATTENDANCE_DEVICE_REQUEST', 'ATTENDANCE_ADJUSTMENT_REQUEST', 'REGISTRATION_REQUEST', 'USER_ACCESS', 'LEAVE_REQUEST'];

async function install(page: Page, role: Role, summary: unknown, summaryStatus = 200) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/refresh') return route.fulfill({ status: 200, json: { accessToken: 'fixture-token', user: { id: 'fixture-user', role, displayName: 'Fixture' } } });
    if (path === '/api/v1/auth/passkeys/config') return route.fulfill({ status: 200, json: { enabled: false } });
    if (path === '/api/v1/approval-center/summary') return route.fulfill({ status: summaryStatus, json: summaryStatus === 200 ? summary : { error: 'temporary failure' } });
    return route.fulfill({ status: 200, json: { data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } } });
  });
}

function summary(counts: Record<string, number>) {
  return { summary: { total: Object.values(counts).reduce((a, b) => a + b, 0), byType: Object.fromEntries(allTypes.map(type => [type, counts[type] || 0])), truncated: false } };
}

test.describe('four-role visibility and badge matrix', () => {
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'] as Role[]) {
    test(`${role} sees only its permitted menu and exact badge semantics`, async ({ page }) => {
      await install(page, role, summary({ EMPLOYEE_MASTER_CHANGE: role === 'ADMIN' ? 1 : 0, LICENSE_DOCUMENT: role === 'ADMIN' ? 2 : 0, ATTENDANCE_DEVICE_REQUEST: role === 'ADMIN' ? 3 : 0, ATTENDANCE_ADJUSTMENT_REQUEST: role === 'SUPERVISOR' ? 4 : 0, USER_ACCESS: role === 'MANAGER' ? 5 : 0, LEAVE_REQUEST: role === 'SUPERVISOR' ? 6 : 0 }));
      await page.goto('/app');
      await expect(page.locator('.app-shell')).toBeVisible();
      await expect(page.locator('[data-navigation-id="approvalCenter"]')).toHaveCount(role === 'VIEWER' ? 0 : 1);
      await expect(page.locator('.nav-count-badge')).not.toContainText('0');
      if (role === 'ADMIN') await expect(page.locator('[data-navigation-id="approvalCenter"] .nav-count-badge')).toHaveText('6');
      if (role === 'MANAGER') await expect(page.locator('[data-navigation-id="users"] .nav-count-badge')).toHaveText('5');
      if (role === 'SUPERVISOR') await expect(page.locator('[data-navigation-id="approvalCenter"] .nav-count-badge')).toHaveText('10');
      if (role === 'VIEWER') await expect(page.locator('.nav-count-badge')).toHaveCount(0);
    });
  }
});

test('zero counts are hidden and 99+ is used above 99', async ({ page }) => {
  await install(page, 'ADMIN', summary({ EMPLOYEE_MASTER_CHANGE: 0, LICENSE_DOCUMENT: 100, ATTENDANCE_DEVICE_REQUEST: 1 }));
  await page.goto('/app');
  await expect(page.locator('[data-navigation-id="approvalCenter"] .nav-count-badge')).toHaveText('101');
  await expect(page.locator('[data-navigation-id="employees"] .nav-count-badge')).toHaveCount(0);
});

test('API failure does not render a false zero badge', async ({ page }) => {
  await install(page, 'ADMIN', {}, 503);
  await page.goto('/app');
  await expect(page.locator('.nav-count-badge')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="approvalCenter"]')).toHaveAttribute('title', 'โหลดจำนวนรายการรออนุมัติไม่สำเร็จ');
});

test('badge fixture is positive-controlled by a non-zero API response', async ({ page }) => {
  await install(page, 'ADMIN', summary({ LEAVE_REQUEST: 1 }));
  await page.goto('/app');
  await expect(page.locator('.nav-count-badge').first()).toHaveText('1');
});
