import { expect, test, type Page, type TestInfo } from '@playwright/test';

function bangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function rosterFixture() {
  const { year, month, day } = bangkokDateParts();
  const monthKey = `${year}-${month}`;
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const dates = Array.from({ length: lastDay }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`);
  const today = `${monthKey}-${day}`;
  const employees = Array.from({ length: 20 }, (_, index) => {
    const department = index < 10 ? 'AN1' : 'AN2';
    const employeeCode = `E${String(index + 1).padStart(3, '0')}`;
    const shifts = index < 2 ? [{
      id: `shift-${index + 1}`,
      employeeId: `employee-${index + 1}`,
      workDate: `${today}T00:00:00.000Z`,
      startTime: '08:00',
      endTime: '16:00',
      locked: index === 0,
      shiftType: { id: 'shift-type-day', code: 'D', name: 'กะเช้า', color: '#22c55e' }
    }] : [];
    return {
      id: `employee-${index + 1}`,
      employeeCode,
      firstName: `พนักงาน${index + 1}`,
      lastName: 'ทดสอบ',
      displayName: `พนักงาน${index + 1} ทดสอบ`,
      department,
      jobTitle: 'พนักงาน',
      isActive: true,
      shifts
    };
  });
  return {
    monthKey,
    today,
    dates,
    employees,
    response: {
      data: { month: monthKey, dates, approval: { status: 'DRAFT', revision: 1 }, employees },
      meta: { page: 1, pageSize: 20, total: employees.length, totalPages: 1 }
    }
  };
}

async function openAdminRoster(page: Page, testInfo: TestInfo) {
  const fixture = rosterFixture();
  const apiMethods: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    apiMethods.push(`${request.method()} ${pathname}`);
    if (pathname === '/api/v1/auth/refresh') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) });
    }
    if (pathname === '/api/v1/auth/passkeys/config') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) });
    }
    if (pathname === '/api/v1/auth/login') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-access-token', user: { id: 'fixture-admin', email: 'admin@example.test', displayName: 'Admin Fixture', role: 'ADMIN' } }) });
    }
    if (pathname === '/api/v1/schedule-calendar') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.response) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], summary: {}, meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } })
    });
  });

  const target = `/app/roster?month=${fixture.monthKey}`;
  await page.goto(target);
  await expect(page.locator('.nexus-public[data-design="sms-command-nexus-full-bleed"]')).toBeVisible();
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await page.locator('#email').fill('admin@example.test');
  await page.locator('#password').fill('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'ตารางกะรายเดือน' })).toBeVisible();
  await expect(page).toHaveURL(target);
  await expect(page.locator('.schedule-grid tbody tr')).toHaveCount(20);
  await page.screenshot({ path: testInfo.outputPath('t11-roster.png'), fullPage: true });

  return { fixture, apiMethods };
}

test('monthly roster keeps classic visible shift times, flat department ordering, today, weekend, lock and sticky controls on desktop', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  const { fixture, apiMethods } = await openAdminRoster(page, testInfo);

  const grid = page.locator('.schedule-grid');
  await expect(grid).not.toHaveClass(/schedule-grid--compact/);
  await expect(grid.locator('tbody tr')).toHaveCount(20);
  await expect(grid.locator('.schedule-department-group-row')).toHaveCount(0);
  await expect(grid.locator('.calendar-shift b').first()).toHaveText('D');
  await expect(grid.locator('.schedule-time').first()).toBeVisible();
  await expect(grid.locator('.schedule-shift-kind')).toHaveCount(0);
  await expect(grid.getByRole('img', { name: 'กะล็อก' }).first()).toBeVisible();
  await expect(grid).not.toContainText('MANUAL');

  const todayHeader = grid.locator(`thead th.today`);
  await expect(todayHeader).toHaveCount(1);
  await expect(todayHeader.locator('.schedule-day-count')).toHaveCount(0);
  await expect(grid.locator(`tbody td.today`)).toHaveCount(20);
  const weekendHeader = grid.locator('thead th.weekend:not(.today)').first();
  await expect(weekendHeader).toBeVisible();
  expect(await weekendHeader.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
  expect(await todayHeader.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
  await expect(page.locator('.schedule-daily-count-note')).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'แสดงเวลา' })).toHaveCount(0);
  await expect(grid.locator('.schedule-time:visible').first()).toContainText('08:00–16:00');

  const scroll = page.locator('.schedule-grid-scroll');
  const header = grid.locator('thead th').nth(1);
  await scroll.evaluate((element) => { element.scrollTop = 260; });
  const stickyTop = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.schedule-grid-scroll')!;
    const headerCell = document.querySelector<HTMLElement>('.schedule-grid thead th:nth-child(2)')!;
    return headerCell.getBoundingClientRect().top - container.getBoundingClientRect().top;
  });
  expect(Math.abs(stickyTop)).toBeLessThanOrEqual(2);
  await scroll.evaluate((element) => { element.scrollLeft = 280; });
  const stickyLeft = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.schedule-grid-scroll')!;
    const employeeHeader = document.querySelector<HTMLElement>('.schedule-grid thead .employee-sticky')!;
    return employeeHeader.getBoundingClientRect().left - container.getBoundingClientRect().left;
  });
  expect(Math.abs(stickyLeft)).toBeLessThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
  expect(errors).toEqual([]);
  expect(apiMethods.some((entry) => /^POST \/api\/v1\/schedule\//.test(entry))).toBe(false);
});

test('monthly roster remains usable at 375px with internal horizontal scroll and fixed employee corner', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await openAdminRoster(page, testInfo);

  const grid = page.locator('.schedule-grid');
  const scroll = page.locator('.schedule-grid-scroll');
  await expect(page.getByRole('button', { name: 'แสดงเวลา' })).toHaveCount(0);
  await expect(grid.locator('thead th.today')).toHaveCount(1);
  expect(await scroll.evaluate((element) => element.scrollWidth)).toBeGreaterThan(await scroll.evaluate((element) => element.clientWidth));
  await scroll.evaluate((element) => { element.scrollLeft = 280; });
  const stickyLeft = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.schedule-grid-scroll')!;
    const employeeHeader = document.querySelector<HTMLElement>('.schedule-grid thead .employee-sticky')!;
    return employeeHeader.getBoundingClientRect().left - container.getBoundingClientRect().left;
  });
  expect(Math.abs(stickyLeft)).toBeLessThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(errors).toEqual([]);
});
