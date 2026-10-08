import { expect, test, type Page, type TestInfo } from '@playwright/test';

const emptyByType = {
  EMPLOYEE_MASTER_CHANGE: 0,
  EMPLOYEE_REFERENCE_PHOTO: 0,
  LICENSE_DOCUMENT: 0,
  SCHEDULE_APPROVAL: 0,
  ATTENDANCE_DEVICE_REQUEST: 0,
  ATTENDANCE_ADJUSTMENT_REQUEST: 0,
  REGISTRATION_REQUEST: 0,
  USER_ACCESS: 0,
  LEAVE_REQUEST: 0
};

const adminSummary = {
  total: 100,
  byType: {
    ...emptyByType,
    EMPLOYEE_MASTER_CHANGE: 2,
    EMPLOYEE_REFERENCE_PHOTO: 3,
    LICENSE_DOCUMENT: 5,
    SCHEDULE_APPROVAL: 7,
    ATTENDANCE_DEVICE_REQUEST: 11,
    ATTENDANCE_ADJUSTMENT_REQUEST: 13,
    REGISTRATION_REQUEST: 17,
    USER_ACCESS: 19,
    LEAVE_REQUEST: 23
  }
};

async function signIn(
  page: Page,
  role: 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'VIEWER',
  summary: { status?: number; body: unknown },
  route = role === 'VIEWER' || role === 'ADMIN' ? '/app' : '/app/leave/approvals',
  expectSummary = role !== 'VIEWER'
) {
  let summaryRequests = 0;
  const unexpectedWrites: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/v1/') && !['GET', 'HEAD'].includes(request.method())
        && !['/api/v1/auth/login', '/api/v1/auth/refresh'].includes(pathname)) {
      unexpectedWrites.push(`${request.method()} ${pathname}`);
    }
  });
  await page.route('**/api/v1/**', (request) => request.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: [], meta: { page: 1, total: 0, pageSize: 20, totalPages: 0 } })
  }));
  await page.route('**/api/v1/approval-center/summary', (request) => {
    summaryRequests += 1;
    return request.fulfill({
      status: summary.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(summary.body)
    });
  });
  await page.route('**/api/v1/auth/refresh', request => request.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: `${role.toLowerCase()}@example.test`, displayName: `${role} Fixture`, role } })
  }));
  await page.route('**/api/v1/auth/passkeys/config', request => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  const summaryResponse = expectSummary ? page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/approval-center/summary') : undefined;
  await page.goto(route);
  if (summaryResponse) await summaryResponse;
  await expect(page.locator('.app-shell')).toBeVisible();
  return { summaryRequests: () => summaryRequests, unexpectedWrites: () => unexpectedWrites };
}

async function openNavigation(page: Page, width: number) {
  if (width <= 760) await page.getByRole('button', { name: 'เปิดเมนูหลัก' }).click();
}

async function expectAdminMenuCounts(page: Page) {
  const rows = [
    ['approvalCenter', 'ศูนย์อนุมัติ', 100, '99+'],
    ['employees', 'ข้อมูลพนักงาน', 5, '5'],
    ['licenses', 'ใบอนุญาต รปภ.', 5, '5'],
    ['approvals', 'อนุมัติตารางกะ', 7, '7'],
    ['attendanceDevice', 'อุปกรณ์ลงเวลา', 11, '11'],
    ['attendanceSupervisor', 'ลงเวลาแทนพนักงาน', 13, '13'],
    ['users', 'ผู้ใช้และสิทธิ์', 36, '36'],
    ['leavePending', 'อนุมัติคำขอลา', 23, '23']
  ] as const;

  for (const [id, label, count, badge] of rows) {
    const button = page.locator(`[data-navigation-id="${id}"]`);
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-label', `${label}, ${count} รายการรออนุมัติ`);
    await expect(button.locator('.nav-count-badge')).toHaveText(badge);
    await expect(button.locator('.nav-count-badge')).toHaveCSS('background-color', 'rgb(185, 28, 28)');
  }
}

for (const viewport of [{ label: 'desktop', width: 1366, height: 768 }, { label: 'mobile', width: 375, height: 812 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${viewport.label} ${theme} renders exact red counts and supports keyboard navigation`, async ({ page }, testInfo: TestInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript((preference) => localStorage.setItem('sms-v3-theme', preference), theme);
      const fixtureRequests = await signIn(page, 'ADMIN', { body: { summary: adminSummary, generatedAt: new Date().toISOString() } });
      await openNavigation(page, viewport.width);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectAdminMenuCounts(page);

      const leaveApproval = page.locator('[data-navigation-id="leavePending"]');
      await leaveApproval.focus();
      await expect(leaveApproval).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL('/app/leave/approvals');
      await expect(page.getByRole('heading', { name: 'อนุมัติคำขอลา' })).toBeVisible();

      await page.screenshot({ path: testInfo.outputPath(`approval-badges-${viewport.label}-${theme}.png`), fullPage: true });
      expect(fixtureRequests.unexpectedWrites()).toEqual([]);
    });
  }
}

test('a complete zero summary does not render a badge or a zero count', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, 'ADMIN', { body: { summary: { total: 0, byType: emptyByType } } });
  await expect(page.locator('.nav-count-badge')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="approvalCenter"]')).not.toContainText('0');
});

test('an incomplete summary never renders a confirmed zero badge', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, 'ADMIN', { body: { summary: { total: 2, byType: {} } } });
  await expect(page.locator('.nav-count-badge')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="approvalCenter"]')).not.toContainText('0');
});

test('an API error never renders a confirmed zero badge', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, 'ADMIN', { status: 503, body: { error: 'temporary failure' } });
  await expect(page.locator('.nav-count-badge')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="approvalCenter"]')).not.toContainText('0');
  await expect(page.locator('[data-navigation-id="approvalCenter"]')).toHaveAttribute('aria-label', 'ศูนย์อนุมัติ, โหลดจำนวนรายการรออนุมัติไม่สำเร็จ');
  await expect(page.locator('[data-navigation-id="approvalCenter"]')).toHaveAttribute('title', 'โหลดจำนวนรายการรออนุมัติไม่สำเร็จ');
});

test('Manager sees only counts allowed by the permission-scoped summary', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const summary = {
    total: 6,
    byType: { ...emptyByType, REGISTRATION_REQUEST: 1, USER_ACCESS: 2, LEAVE_REQUEST: 3 }
  };
  await signIn(page, 'MANAGER', { body: { summary, generatedAt: new Date().toISOString() } });

  await expect(page.locator('[data-navigation-id="approvalCenter"] .nav-count-badge')).toHaveText('6');
  await expect(page.locator('[data-navigation-id="users"] .nav-count-badge')).toHaveText('3');
  await expect(page.locator('[data-navigation-id="leavePending"] .nav-count-badge')).toHaveText('3');
  await expect(page.locator('[data-navigation-id="employees"] .nav-count-badge')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="licenses"] .nav-count-badge')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="attendanceDevice"] .nav-count-badge')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="approvals"]')).toHaveCount(0);
});

test('Supervisor sees counts in its permission-scoped summary', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const supervisorCount = await signIn(page, 'SUPERVISOR', { body: { summary: { total: 2, byType: { ...emptyByType, LEAVE_REQUEST: 2 } } } });
  await expect(page.locator('[data-navigation-id="approvalCenter"] .nav-count-badge')).toHaveText('2');
  await expect(page.locator('[data-navigation-id="leavePending"] .nav-count-badge')).toHaveText('2');
  expect(supervisorCount.summaryRequests()).toBeGreaterThanOrEqual(1);
});

test('Viewer does not poll or display approval counts outside the existing authorization scope', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const summaryRequests = await signIn(page, 'VIEWER', { body: { summary: { total: 100, byType: adminSummary.byType } } });
  await expect(page.locator('[data-navigation-id="employees"]')).toBeVisible();
  await expect(page.locator('.nav-count-badge')).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="approvalCenter"]')).toHaveCount(0);
  expect(summaryRequests.summaryRequests()).toBe(0);
  await expect(page.locator('[data-navigation-id="employees"]')).not.toHaveAttribute('title', 'โหลดจำนวนรายการรออนุมัติไม่สำเร็จ');
});

// All decisions below are intercepted synthetic fixture requests, never Production UAT.
test('central and native leave decisions refetch the same queue and both menu counts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  const summary = { total: 2, byType: { ...emptyByType, LEAVE_REQUEST: 2 } };
  await signIn(page, 'ADMIN', { body: { summary } }, '/app/leave/approvals');
  const pending = [1, 2].map(id => ({ id: `leave-${id}`, employeeId: `employee-${id}`, employeeNameSnapshot: `Leave Fixture ${id}`, departmentSnapshot: 'AN1', leaveType: 'PERSONAL', startDate: '2026-11-11', endDate: '2026-11-11', dayCount: 1, reason: 'Fixture only', status: 'PENDING' }));
  const decisions: string[] = [];
  await page.route('**/api/v1/leave-requests*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: pending, meta: { page: 1, total: pending.length, pageSize: 100, totalPages: 1 } }) }));
  await page.route('**/api/v1/approval-center?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: pending.map(row => ({ id: `LEAVE_REQUEST:${row.id}`, type: 'LEAVE_REQUEST', requestId: row.id, title: row.employeeNameSnapshot, status: row.status, sourcePage: 'leavePending', submittedAt: '2026-10-08T00:00:00Z', ageHours: 1, urgency: 'NEW', employee: { id: row.employeeId, displayName: row.employeeNameSnapshot }, metadata: { startDate: row.startDate, endDate: row.endDate, dayCount: 1 } })) }) }));
  await page.route('**/api/v1/leave-requests/*', async route => {
    expect(route.request().method()).toBe('PUT');
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    expect(decisions).not.toContain(id);
    decisions.push(id);
    pending.splice(pending.findIndex(row => row.id === id), 1);
    summary.total = pending.length;
    summary.byType.LEAVE_REQUEST = pending.length;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id, status: route.request().postDataJSON().status } }) });
  });
  await page.locator('[data-navigation-id="approvalCenter"]').click();
  await page.getByRole('button', { name: 'อนุมัติทันที', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'ยืนยันอนุมัติคำขอ', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-navigation-id="approvalCenter"] .nav-count-badge')).toHaveText('1');
  await expect(page.locator('[data-navigation-id="leavePending"] .nav-count-badge')).toHaveText('1');
  await page.locator('[data-navigation-id="leavePending"]').click();
  await expect(page.locator('.leave-decision-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'ไม่อนุมัติ', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'ยืนยันไม่อนุมัติ', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.leave-decision-item')).toHaveCount(0);
  await expect(page.locator('.nav-count-badge')).toHaveCount(0);
  await page.locator('[data-navigation-id="approvalCenter"]').click();
  await expect(page.getByRole('button', { name: 'อนุมัติทันที', exact: true })).toHaveCount(0);
  expect(decisions).toEqual(['leave-1', 'leave-2']);
  expect(errors).toEqual([]);
});
