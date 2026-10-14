import { expect, test, type Page, type TestInfo } from '@playwright/test';

const dashboardSummary = {
  totalEmployees: 0,
  activeEmployees: 0,
  onDutyToday: 0,
  leaveToday: 0,
  expiringLicenses: 0,
  monthShifts: 0,
  pendingLeaves: 0,
  pendingUsers: 0,
  pendingLicenseDocuments: 0,
  todayOperations: { onDuty: 0, scheduled: 0, onLeave: 0, offDuty: 0 },
  leaveSummary: { total: 0 },
  licenseSummary: {},
  licenseOverview: {},
  context: { departments: [] },
  actionRequired: [],
  recentActivity: [],
  expiringLicenseDetails: [],
};

const approvalSummary = {
  summary: {
    total: 2,
    byType: { SCHEDULE_APPROVAL: 1, LEAVE_REQUEST: 1 },
    truncated: false,
  },
};

const approvalList = {
  data: [],
  summary: { total: 2, truncated: false },
  meta: { total: 0, page: 1, pageSize: 100, totalPages: 0 },
};

function json(route: Parameters<Parameters<Page['route']>[1]>[0], payload: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
}

async function installFixture(page: Page) {
  // Closure state belongs to this Playwright Page only. It models the browser
  // refresh-cookie contract without changing production authentication.
  let syntheticSession = false;
  const user = { id: 'synthetic-r71-user', email: 'r71@example.test', displayName: 'R7.1 Fixture', role: 'ADMIN' };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/refresh') return syntheticSession
      ? json(route, { accessToken: 'synthetic-r71-token', user })
      : json(route, { message: 'No active session' }, 401);
    if (path === '/api/v1/auth/passkeys/config') return json(route, { enabled: false });
    if (path === '/api/v1/auth/login') {
      syntheticSession = true;
      return json(route, { accessToken: 'synthetic-r71-token', user });
    }
    if (path === '/api/v1/dashboard/summary' || path === '/api/v1/dashboard') return json(route, { data: dashboardSummary });
    if (path === '/api/v1/approval-center/summary') return json(route, approvalSummary);
    if (path === '/api/v1/approval-center') return json(route, approvalList);
    if (path === '/api/v1/rules' || path.includes('/rule')) return json(route, { data: [], summary: {}, meta: { total: 0 } });
    if (path.includes('/audit')) return json(route, {
      data: [{ id: 'audit-r71-1', action: 'CREATE', module: 'AUTH', actor: { role: 'ADMIN', displayName: 'R7.1 Fixture' }, createdAt: '2026-10-14T00:00:00.000Z' }],
      summary: {}, meta: { total: 1, page: 1, pageSize: 25, totalPages: 1 },
    });
    return json(route, { data: [], summary: {}, meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } });
  });
}

async function navigateFromShell(page: Page, label: string, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'เปิดเมนูหลัก' }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
}

async function signIn(page: Page) {
  await page.goto('/app');
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await page.locator('#email').fill('r71@example.test');
  await page.locator('#password').fill('synthetic-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
}

function luminance(channel: number) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground: [number, number, number], background: [number, number, number]) {
  const fg = 0.2126 * luminance(foreground[0]) + 0.7152 * luminance(foreground[1]) + 0.0722 * luminance(foreground[2]);
  const bg = 0.2126 * luminance(background[0]) + 0.7152 * luminance(background[1]) + 0.0722 * luminance(background[2]);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

async function computedContrast(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((element) => {
    const parse = (value: string): [number, number, number] | null => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    let node: HTMLElement | null = element as HTMLElement;
    const style = getComputedStyle(element);
    const foreground = parse(style.color);
    while (node) {
      const background = parse(getComputedStyle(node).backgroundColor);
      if (foreground && background && getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)') {
        return { foreground, background };
      }
      node = node.parentElement;
    }
    return { foreground, background: null };
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ name: 'desktop', width: 1366, height: 768 }, { name: 'mobile', width: 375, height: 812 }] as const) {
    test(`R7.1 visual contracts ${theme} ${viewport.name}`, async ({ page }, testInfo: TestInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('sms-v3-theme', value), theme);
      await installFixture(page);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await signIn(page);

      const logo = page.locator('.sidebar-brand picture.sms-brand-logo');
      if (viewport.name === 'desktop') {
        await expect(logo).toBeVisible();
        const geometry = await logo.evaluate((element) => {
          const image = element.getBoundingClientRect();
          const brand = element.closest('.sidebar-brand')!.getBoundingClientRect();
          return { imageTop: image.top, imageBottom: image.bottom, brandTop: brand.top, brandBottom: brand.bottom };
        });
        expect(geometry.imageTop).toBeGreaterThanOrEqual(geometry.brandTop);
        expect(geometry.imageBottom).toBeLessThanOrEqual(geometry.brandBottom - 1);
        expect(geometry.imageBottom).toBeLessThanOrEqual(geometry.brandBottom - 1);
      }

      const quickAction = page.locator('.dashboard-quick-actions__grid button small').first();
      await expect(quickAction).toBeVisible();
      const quickActionColors = await computedContrast(quickAction);
      expect(quickActionColors.foreground).not.toBeNull();
      expect(quickActionColors.background).not.toBeNull();
      expect(contrast(quickActionColors.foreground!, quickActionColors.background!)).toBeGreaterThanOrEqual(4.5);

      const role = viewport.name === 'mobile'
        ? page.getByRole('button', { name: 'เปิดเมนูบัญชีและธีม' })
        : page.locator('.topbar-profile small');
      if (viewport.name === 'mobile') {
        await role.click();
        const mobileRole = page.locator('.mobile-utility-profile small');
        await expect(mobileRole).toBeVisible();
        const roleColors = await computedContrast(mobileRole);
        expect(roleColors.foreground).not.toBeNull();
        expect(roleColors.background).not.toBeNull();
        expect(contrast(roleColors.foreground!, roleColors.background!)).toBeGreaterThanOrEqual(4.5);
        await page.getByRole('button', { name: 'ปิดเมนูบัญชีและธีม' }).click();
      } else {
        await expect(role).toBeVisible();
        const roleColors = await computedContrast(role);
        expect(roleColors.foreground).not.toBeNull();
        expect(roleColors.background).not.toBeNull();
        expect(contrast(roleColors.foreground!, roleColors.background!)).toBeGreaterThanOrEqual(4.5);
      }

      await navigateFromShell(page, 'ตรวจสอบกฎการทำงาน', viewport.name === 'mobile');
      const monthLabel = page.locator('.month-filter');
      await expect(monthLabel).toBeVisible();
      const monthLabelColors = await computedContrast(monthLabel);
      expect(monthLabelColors.foreground).not.toBeNull();
      expect(monthLabelColors.background).not.toBeNull();
      expect(contrast(monthLabelColors.foreground!, monthLabelColors.background!)).toBeGreaterThanOrEqual(4.5);
      const metric = page.locator('.rule-summary-grid strong').first();
      await expect(metric).toBeVisible();
      const metricColors = await computedContrast(metric);
      expect(metricColors.foreground).not.toBeNull();
      expect(metricColors.background).not.toBeNull();
      expect(contrast(metricColors.foreground!, metricColors.background!)).toBeGreaterThanOrEqual(4.5);

      await navigateFromShell(page, 'บันทึกการใช้งานระบบ', viewport.name === 'mobile');
      const auditBadges = viewport.name === 'mobile'
        ? ['.audit-action-badge', '.audit-module-badge', '.audit-role-badge']
        : ['.audit-desktop-table .audit-action-badge', '.audit-desktop-table .audit-module-badge', '.audit-desktop-table tbody td:nth-child(2) small'];
      for (const selector of auditBadges) {
        const badge = page.locator(selector).first();
        await expect(badge).toBeVisible();
        const colors = await computedContrast(badge);
        expect(colors.foreground).not.toBeNull();
        expect(colors.background).not.toBeNull();
        expect(contrast(colors.foreground!, colors.background!)).toBeGreaterThanOrEqual(4.5);
      }

      await page.screenshot({ path: `test-results/r71-${theme}-${viewport.name}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      expect(errors).toEqual([]);
    });
  }
}

test('R7.1 Approval Center deduplicates summary and isolates type query on navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => localStorage.setItem('sms-v3-theme', 'dark'));
  let summaryRequests = 0;
  await installFixture(page);
  await page.route('**/api/v1/approval-center/summary', async (route) => {
    summaryRequests += 1;
    return json(route, approvalSummary);
  });
  await signIn(page);
  // The dashboard badge has already made its independent initial request.
  // Measure the Approval Center runtime from this point onward.
  summaryRequests = 0;
  // Intentional deep-link reload: this must use the authenticated refresh mock,
  // not the in-memory token left by login.
  await page.goto('/app/approvals?type=SCHEDULE&month=2026-10&year=2026');
  const approvalCenter = page.locator('.approval-center-page');
  await expect(approvalCenter).toBeVisible();
  await expect.poll(() => summaryRequests).toBe(1);

  await page.getByRole('button', { name: 'รีเฟรชข้อมูล' }).click();
  await expect.poll(() => summaryRequests).toBe(2);
  await navigateFromShell(page, 'ข้อมูลพนักงาน', false);
  await expect(page).toHaveURL(/\/app\/employees\?month=2026-10&year=2026$/);
  expect(new URL(page.url()).searchParams.get('type')).toBeNull();
  await page.screenshot({ path: 'test-results/r71-approval-routing.png', fullPage: true });
});
