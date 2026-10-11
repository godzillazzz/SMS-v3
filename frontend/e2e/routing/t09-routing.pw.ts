import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function signInOnDeepLink(page: Page, target: string, role = 'VIEWER') {
  await page.route('**/api/v1/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/api/v1/schedule-calendar'
      ? { data: { dates: [], employees: [], approval: { status: 'DRAFT' } }, meta: { page: 2, total: 0, pageSize: 20, totalPages: 0 } }
      : pathname === '/api/v1/dashboard'
        ? { data: {
          totalEmployees: 4, activeEmployees: 3, workingToday: 2, onDutyToday: 2, leaveToday: 1,
          expiringLicenses: 1, pendingLicenseDocuments: 0, notScheduledToday: 1, monthShifts: 4,
          licenseSummary: { PENDING: 0, APPROVED: 1, RETURNED_FOR_CORRECTION: 0, REJECTED: 0, EXPIRED: 0, SUPERSEDED: 0 },
          leaveSummary: { total: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0, today: 1, unmatchedQuotas: 0 },
          leaveOverview: { total: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 },
          licenseOverview: { valid: 0, expiringWithin30: 1, expiringWithin90: 0, expired: 0, pendingReview: 0 },
          todayOperations: { totalScheduled: 2, onDuty: 2, onLeave: 1, noShift: 1, byShift: [] },
          actionRequired: [], recentActivity: [], expiringLicenseDetails: [],
          context: { departments: ['AN1'] }, generatedAt: '2026-10-10T00:00:00.000Z'
        } }
        : pathname === '/api/v1/dashboard/details'
          ? { data: {
            metric: 'leaveToday', date: '2026-10-10', month: '2026-10', department: 'AN1',
            page: Number(new URL(route.request().url()).searchParams.get('page') || 1),
            pageSize: 20, total: 21, totalPages: 2,
            records: Array.from({ length: 20 }, (_, index) => ({
              id: `fixture-${index}`, title: `พนักงาน ${index + 1}`, employeeCode: `E${index + 1}`,
              subtitle: 'ลากิจ · 2026-10-10–2026-10-10', status: 'APPROVED'
            }))
          } }
          : { data: [], summary: { total: 0 }, meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) }));
  await page.route('**/api/v1/auth/passkeys/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.route('**/api/v1/auth/login', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: 'viewer@example.test', displayName: `${role} Fixture`, role } })
  }));

  await page.goto(target);
  await expect(page.locator('.nexus-public[data-design="sms-command-nexus-full-bleed"]')).toBeVisible();
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await expect(page).toHaveURL(target);
  await page.locator('#email').fill('viewer@example.test');
  await expect(page.locator('#email')).toHaveValue('viewer@example.test');
  await page.locator('#password').fill('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
}

async function assertNoHorizontalOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

test('unauthenticated settings deep link returns to a Thai 403 after login on desktop', async ({ page }, testInfo: TestInfo) => {
  const target = '/app/settings?month=2026-10&department=AN1&page=2';
  await page.setViewportSize({ width: 1366, height: 768 });
  await signInOnDeepLink(page, target);

  await expect(page.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' })).toBeVisible();
  await expect(page).toHaveURL(target);
  await expect(page).toHaveTitle('ไม่มีสิทธิ์เข้าถึง | SMS-v3');
  await assertNoHorizontalOverflow(page, 1366);
  await page.screenshot({ path: testInfo.outputPath('t09-route-forbidden-desktop.png'), fullPage: true });
});

test('unknown deep link returns to an in-app Thai 404 after login on mobile', async ({ page }, testInfo: TestInfo) => {
  const target = '/app/not-a-route?employeeId=fixture-employee&status=PENDING';
  await page.setViewportSize({ width: 375, height: 812 });
  await signInOnDeepLink(page, target);

  await expect(page.getByRole('heading', { name: 'ไม่พบหน้าที่ต้องการ' })).toBeVisible();
  await expect(page).toHaveURL(target);
  await expect(page).toHaveTitle('ไม่พบหน้าที่ต้องการ | SMS-v3');
  await assertNoHorizontalOverflow(page, 375);
  await page.screenshot({ path: testInfo.outputPath('t09-route-not-found-mobile.png'), fullPage: true });
});

test('schedule deep link restores month, department, and table page after login', async ({ page }) => {
  const target = '/app/roster?month=2026-10&department=AN1&page=2';
  await page.setViewportSize({ width: 1366, height: 768 });
  let scheduleQuery: URLSearchParams | undefined;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/schedule-calendar') scheduleQuery = url.searchParams;
  });
  await signInOnDeepLink(page, target, 'ADMIN');

  await expect(page.getByRole('heading', { name: 'ตารางกะรายเดือน' })).toBeVisible();
  await expect(page).toHaveURL(target);
  await expect.poll(() => scheduleQuery?.get('month')).toBe('2026-10');
  expect(scheduleQuery?.get('department')).toBe('AN1');
  expect(scheduleQuery?.get('page')).toBe('2');
  await assertNoHorizontalOverflow(page, 1366);
});


test('Dashboard KPI deep link preserves filters and server pagination in the URL', async ({ page }) => {
  const target = '/app?date=2026-10-10&month=2026-10&department=AN1';
  await page.setViewportSize({ width: 375, height: 812 });
  let detailQuery: URLSearchParams | undefined;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/dashboard/details') detailQuery = url.searchParams;
  });
  await signInOnDeepLink(page, target, 'ADMIN');

  await expect(page.locator('.nexus-kpis button')).toHaveCount(4);
  await page.locator('.nexus-kpis button').nth(2).click();
  await expect(page.getByRole('heading', { name: 'พนักงานที่ลาโดยได้รับอนุมัติ' })).toBeVisible();
  await expect.poll(() => detailQuery?.get('metric')).toBe('leaveToday');
  expect(detailQuery?.get('date')).toBe('2026-10-10');
  expect(detailQuery?.get('month')).toBe('2026-10');
  expect(detailQuery?.get('department')).toBe('AN1');
  expect(detailQuery?.get('page')).toBe('1');
  await expect(page).toHaveURL(/\/app\/dashboard\/details\?.*metric=leaveToday/);
  await page.getByRole('button', { name: 'ถัดไป' }).click();
  await expect.poll(() => detailQuery?.get('page')).toBe('2');
  await expect(page).toHaveURL(/page=2/);
  await assertNoHorizontalOverflow(page, 375);
});
