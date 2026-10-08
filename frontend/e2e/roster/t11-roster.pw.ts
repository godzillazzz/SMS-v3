import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

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
    const department = index < 4 ? 'AN1' : index === 4 ? 'AN1,AN2,AN3' : index < 10 ? 'AN2' : index < 15 ? 'AN3' : 'AN10';
    const employeeCode = ['E10', 'E2', 'E2', 'E1'][index] || `E${String(index + 1).padStart(3, '0')}`;
    const provenance = [
      { source: 'AUTO', licenseStatus: 'INVALID', licenseOverride: false, remark: 'License Block: legacy note', code: 'OFF', name: 'วันหยุด' },
      { source: 'AUTO', licenseStatus: 'EXPIRED', licenseOverride: true, licenseBlockedFromShiftTypeId: 'shift-type-day', remark: 'License Block', code: 'OFF', name: 'วันหยุด' },
      { source: 'AUTO', licenseStatus: 'VALID', licenseOverride: true, code: 'N', name: 'กะกลางคืน' },
      { source: 'SMS_V3', licenseStatus: 'VALID', licenseOverride: false, code: 'D', name: 'กะเช้า' },
      { source: 'AUTO', licenseStatus: 'OVERRIDDEN', licenseOverride: false, code: 'D', name: 'กะเช้า' },
      { source: 'LEAVE_APPROVAL', licenseStatus: 'VALID', licenseOverride: false, code: 'D', name: 'กะเช้า' }
    ][index];
    const shifts = provenance ? [{
      id: `shift-${index + 1}`,
      employeeId: `employee-${index + 1}`,
      workDate: `${today}T00:00:00.000Z`,
      startTime: '08:00',
      endTime: '16:00',
      locked: index === 0,
      source: provenance.source,
      licenseStatus: provenance.licenseStatus,
      licenseOverride: provenance.licenseOverride,
      licenseBlockedFromShiftTypeId: 'licenseBlockedFromShiftTypeId' in provenance ? provenance.licenseBlockedFromShiftTypeId : null,
      remark: 'remark' in provenance ? provenance.remark : null,
      shiftType: { id: `shift-type-${provenance.code.toLowerCase()}`, code: provenance.code, name: provenance.name, color: '#22c55e' }
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
      data: { month: monthKey, dates, approval: { status: 'DRAFT', revision: 1 }, employees: [...employees].reverse() },
      meta: { page: 1, pageSize: 20, total: employees.length, totalPages: 1 }
    }
  };
}

async function assertDateHeaderContrast(grid: Locator) {
  const samples = await grid.evaluate((gridElement) => {
    const luminance = (color: string) => {
      const values = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
      if (!values || values.length !== 3) throw new Error(`Unrecognized computed color: ${color}`);
      const channels = values.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const selectors = {
      normal: 'thead th:not(.employee-sticky):not(.today):not(.weekend)',
      weekend: 'thead th.weekend:not(.today), thead th.weekend',
      today: 'thead th.today'
    };
    return Object.entries(selectors).map(([kind, selector]) => {
      const header = gridElement.querySelector<HTMLElement>(selector);
      if (!header) throw new Error(`Missing ${kind} date header fixture`);
      const background = getComputedStyle(header).backgroundColor;
      const dateColor = getComputedStyle(header.querySelector('b')!).color;
      const weekdayColor = getComputedStyle(header.querySelector('small')!).color;
      return { kind, date: contrast(dateColor, background), weekday: contrast(weekdayColor, background) };
    });
  });
  for (const sample of samples) {
    expect(sample.date, `${sample.kind} date contrast`).toBeGreaterThanOrEqual(4.5);
    expect(sample.weekday, `${sample.kind} weekday contrast`).toBeGreaterThanOrEqual(4.5);
  }
}

async function openAdminRoster(page: Page, testInfo: TestInfo) {
  const fixture = rosterFixture();
  const apiMethods: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    apiMethods.push(`${request.method()} ${pathname}`);
    if (pathname === '/api/v1/auth/refresh') {
      // Synthetic existing ADMIN session; no login or business write is sent.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-access-token', user: { id: 'fixture-admin', email: 'admin@example.test', displayName: 'Admin Fixture', role: 'ADMIN' } }) });
    }
    if (pathname === '/api/v1/auth/passkeys/config') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) });
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
  await expect(page.getByRole('heading', { name: 'ตารางกะรายเดือน' })).toBeVisible();
  await expect(page).toHaveURL(target);
  await expect(page.locator('.schedule-grid tbody tr')).toHaveCount(20);
  await page.screenshot({ path: testInfo.outputPath('t11-roster.png'), fullPage: true });

  return { fixture, apiMethods };
}

for (const theme of ['light', 'dark'] as const) {
test(`monthly roster keeps classic visible shift times, natural department order and sticky controls on desktop (${theme})`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((value) => localStorage.setItem('sms-v3-theme', value), theme);
  const { fixture, apiMethods } = await openAdminRoster(page, testInfo);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  const grid = page.locator('.schedule-grid');
  await expect(grid).not.toHaveClass(/schedule-grid--compact/);
  await expect(grid.locator('tbody tr')).toHaveCount(20);
  await expect(grid.locator('.schedule-department-group-row')).toHaveCount(0);
  await expect(grid.locator('tbody .employee-sticky small')).toHaveText([
    'E1 · AN1', 'E2 · AN1', 'E2 · AN1', 'E10 · AN1', 'E005 · AN1,AN2,AN3',
    'E006 · AN2', 'E007 · AN2', 'E008 · AN2', 'E009 · AN2', 'E010 · AN2',
    'E011 · AN3', 'E012 · AN3', 'E013 · AN3', 'E014 · AN3', 'E015 · AN3',
    'E016 · AN10', 'E017 · AN10', 'E018 · AN10', 'E019 · AN10', 'E020 · AN10'
  ]);
  await expect(grid.locator('tbody tr').nth(1)).toContainText('พนักงาน2 ทดสอบ');
  await expect(grid.locator('tbody tr').nth(2)).toContainText('พนักงาน3 ทดสอบ');
  await expect(grid.locator('.calendar-shift b').first()).toHaveText('D');
  await expect(grid.locator('.schedule-time').first()).toBeVisible();
  await expect(grid.locator('.schedule-shift-kind')).toHaveCount(2);
  await expect(grid.getByRole('img', { name: 'กะล็อก' }).first()).toBeVisible();
  await expect(grid.locator('[data-label-type="manual"]')).toHaveCount(1);
  await expect(grid.locator('[data-label-type="license-block"]')).toHaveText(['License Block', 'License Block']);
  await expect(grid.locator('[data-label-type="override"]')).toHaveText('OVERRIDE ⚡');
  await expect(grid.locator('.shift-note[data-label-type]')).toHaveCount(4);
  await expect(grid.locator('[data-label-type="license-block"]').first()).toHaveCSS('color', theme === 'light' ? 'rgb(185, 28, 28)' : 'rgb(220, 38, 38)');

  const todayHeader = grid.locator(`thead th.today`);
  await expect(todayHeader).toHaveCount(1);
  await assertDateHeaderContrast(grid);
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
  await expect(header).toHaveCSS('position', 'sticky');
  await expect(header).toHaveCSS('top', '0px');
  await scroll.hover({ position: { x: 210, y: 110 } });
  await page.mouse.wheel(0, 540);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const stickyTop = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.schedule-grid-scroll')!;
    const headerCell = document.querySelector<HTMLElement>('.schedule-grid thead th:nth-child(2)')!;
    return headerCell.getBoundingClientRect().top - container.getBoundingClientRect().top;
  });
  expect(Math.abs(stickyTop)).toBeLessThanOrEqual(2);
  await expect(header).toBeInViewport();
  await assertDateHeaderContrast(grid);
  await scroll.evaluate((element) => { element.scrollLeft = 280; });
  const stickyLeft = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.schedule-grid-scroll')!;
    const employeeHeader = document.querySelector<HTMLElement>('.schedule-grid thead .employee-sticky')!;
    return employeeHeader.getBoundingClientRect().left - container.getBoundingClientRect().left;
  });
  expect(Math.abs(stickyLeft)).toBeLessThanOrEqual(2);
  const employeeCell = grid.locator('tbody .employee-sticky').first();
  await expect(employeeCell).toHaveCSS('position', 'sticky');
  await assertDateHeaderContrast(grid);
  expect(Math.abs(await employeeCell.evaluate((element) => element.getBoundingClientRect().left - document.querySelector('.schedule-grid-scroll')!.getBoundingClientRect().left))).toBeLessThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
  expect(errors).toEqual([]);
  // The existing session refresh is mocked; every business API read remains GET-only.
  expect(apiMethods.filter((entry) => entry === 'POST /api/v1/auth/refresh')).toHaveLength(1);
  expect(apiMethods.filter((entry) => !entry.startsWith('GET ') && entry !== 'POST /api/v1/auth/refresh')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`roster-desktop-${theme}-scrolled.png`), fullPage: true });
});

test(`monthly roster remains usable at 375px with internal horizontal scroll and fixed employee corner (${theme})`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((value) => localStorage.setItem('sms-v3-theme', value), theme);
  const { apiMethods } = await openAdminRoster(page, testInfo);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  const grid = page.locator('.schedule-grid');
  const scroll = page.locator('.schedule-grid-scroll');
  await expect(grid.locator('[data-label-type="manual"]')).toHaveCount(1);
  await expect(grid.locator('[data-label-type="license-block"]')).toHaveText(['License Block', 'License Block']);
  await expect(grid.locator('[data-label-type="override"]')).toHaveText('OVERRIDE ⚡');
  await expect(grid.locator('.shift-note[data-label-type]')).toHaveCount(4);
  await expect(grid.locator('[data-label-type="license-block"]').first()).toHaveCSS('color', theme === 'light' ? 'rgb(185, 28, 28)' : 'rgb(220, 38, 38)');
  await expect(page.getByRole('button', { name: 'แสดงเวลา' })).toHaveCount(0);
  await expect(grid.locator('thead th.today')).toHaveCount(1);
  const dateHeader = grid.locator('thead th').nth(1);
  await assertDateHeaderContrast(grid);
  await expect(dateHeader).toHaveCSS('position', 'sticky');
  await scroll.hover({ position: { x: 210, y: 110 } });
  await page.mouse.wheel(0, 520);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const mobileHeaderOffset = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.schedule-grid-scroll')!;
    const headerCell = document.querySelector<HTMLElement>('.schedule-grid thead th:nth-child(2)')!;
    return headerCell.getBoundingClientRect().top - container.getBoundingClientRect().top;
  });
  expect(Math.abs(mobileHeaderOffset)).toBeLessThanOrEqual(2);
  await assertDateHeaderContrast(grid);
  expect(await scroll.evaluate((element) => element.scrollWidth)).toBeGreaterThan(await scroll.evaluate((element) => element.clientWidth));
  await scroll.evaluate((element) => { element.scrollLeft = 280; });
  const stickyLeft = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.schedule-grid-scroll')!;
    const employeeHeader = document.querySelector<HTMLElement>('.schedule-grid thead .employee-sticky')!;
    return employeeHeader.getBoundingClientRect().left - container.getBoundingClientRect().left;
  });
  expect(Math.abs(stickyLeft)).toBeLessThanOrEqual(2);
  const employeeCell = grid.locator('tbody .employee-sticky').first();
  await expect(employeeCell).toHaveCSS('position', 'sticky');
  expect(Math.abs(await employeeCell.evaluate((element) => element.getBoundingClientRect().left - document.querySelector('.schedule-grid-scroll')!.getBoundingClientRect().left))).toBeLessThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(errors).toEqual([]);
  // The existing session refresh is mocked; every business API read remains GET-only.
  expect(apiMethods.filter((entry) => entry === 'POST /api/v1/auth/refresh')).toHaveLength(1);
  expect(apiMethods.filter((entry) => !entry.startsWith('GET ') && entry !== 'POST /api/v1/auth/refresh')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`roster-mobile-${theme}-scrolled.png`), fullPage: true });
});
}
