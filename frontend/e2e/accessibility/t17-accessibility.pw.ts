import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';

const admin = {
  id: 'fixture-admin',
  email: 'admin@example.test',
  displayName: 'ผู้ดูแลทดสอบ',
  role: 'ADMIN'
};

const dashboard = {
  totalEmployees: 12,
  activeEmployees: 10,
  onDutyToday: 8,
  leaveToday: 1,
  expiringLicenses: 0,
  monthShifts: 26,
  pendingLeaves: 0,
  pendingUsers: 0,
  pendingLicenseDocuments: 0,
  notScheduledToday: 0,
  todayOperations: { onDuty: 8, scheduled: 10, onLeave: 1, offDuty: 1 },
  leaveSummary: { total: 2, PENDING: 0, APPROVED: 2, REJECTED: 0, CANCELLED: 0, today: 1, unmatchedQuotas: 0 },
  licenseSummary: {},
  licenseOverview: {},
  context: { departments: ['AN1'] },
  actionRequired: [],
  recentActivity: [],
  expiringLicenseDetails: [],
  generatedAt: '2026-10-08T02:00:00.000Z'
};

async function mockReadOnlyApis(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/v1/auth/refresh') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) });
    }
    if (pathname === '/api/v1/auth/passkeys/config') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) });
    }
    if (pathname === '/api/v1/auth/login' && request.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-only-token', user: admin }) });
    }
    if (pathname === '/api/v1/dashboard' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: dashboard }) });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], summary: {}, meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } })
    });
  });
}

async function signInToSyntheticDashboard(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => localStorage.setItem('sms-v3-theme', 'light'));
  await mockReadOnlyApis(page);
  await page.goto('/app');
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await page.locator('#email').fill(admin.email);
  await page.locator('#password').fill('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'ภาพรวมระบบ' })).toBeVisible();
  await expect(page.locator('[data-theme="light"]')).toHaveCount(1);
}

async function seriousAxeViolations(page: Page) {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
    const results = await (window as any).axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']
      }
    });
    return results.violations
      .filter((violation: { impact?: string }) => ['serious', 'critical'].includes(violation.impact || ''))
      .map((violation: { id: string; impact: string; description: string; nodes: Array<{ target: string[]; failureSummary?: string }> }) => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        nodes: violation.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary }))
      }));
  });
}

test('Login landmarks and controls have accessible names at desktop and mobile widths', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('sms-v3-theme', 'light'));
    await mockReadOnlyApis(page);
    await page.goto('/app');
    await expect(page.locator('#auth-login-form')).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    const passwordToggle = page.locator('#auth-login-form .password-toggle');
    await expect(passwordToggle).toHaveAccessibleName('แสดง');
    await expect(page.getByRole('link', { name: /SMS Security Management System/ })).toBeVisible();

    const violations = await seriousAxeViolations(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }
});

test('Dashboard accessible names and light-theme contrast pass against synthetic data', async ({ page }) => {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await signInToSyntheticDashboard(page, viewport.width, viewport.height);
    await expect(page.getByRole('main')).toHaveCount(1);
    const commandTrigger = page.locator('.workflow-command-trigger');
    if (await commandTrigger.isVisible()) await expect(commandTrigger).toContainText('เมนูด่วน');

    const violations = await seriousAxeViolations(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
});
