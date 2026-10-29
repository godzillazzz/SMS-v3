import { expect, test } from '@playwright/test';

// Owner report 2026-10-29: the "ไม่มีรายการ" empty state in "ประวัติคำขอลาของฉัน" floats as nested white cards.
const employee = { id: 'fixture-employee-alpha', displayName: 'อัลฟา ตัวอย่าง' };
for (const theme of ['light', 'dark'] as const) for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
  test(`empty leave history is one flat empty state ${theme} ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((value) => localStorage.setItem('sms-v3-theme', value), theme);
    await page.route('**/api/v1/**', (route) => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/auth/refresh') return route.fulfill({ status: 401, json: { message: 'No active session' } });
      if (pathname === '/api/v1/auth/passkeys/config') return route.fulfill({ json: { enabled: false } });
      if (pathname === '/api/v1/auth/login') return route.fulfill({ json: { accessToken: 'fixture-leave-token', user: { id: employee.id, email: 'viewer@example.test', displayName: employee.displayName, role: 'VIEWER' } } });
      if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { message: 'Fixture forbids writes' } });
      if (pathname === '/api/v1/leave-summary') return route.fulfill({ json: { data: { linked: true, employeeId: employee.id, quotaYear: 2026, entitlement: {}, used: {}, remaining: {} } } });
      return route.fulfill({ json: { data: [], summary: {}, meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } } });
    });
    await page.goto('/app/leave');
    await expect(page.locator('.nexus-onescreen #auth-login-form')).toBeVisible();
    await page.locator('#email').fill('viewer@example.test');
    await page.locator('#password').fill('fixture-password');
    await page.locator('#auth-login-form button[type="submit"]').click();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 });
    const card = page.locator('.leave-history-card');
    const empty = card.locator('.data-state--empty:visible').first();
    await expect(empty).toBeVisible({ timeout: 20_000 });
    const surfaces = await empty.evaluate((node) => {
      const host = node.closest('.leave-history-card')!;
      const out: Array<{ cls: string; bg: string; shadow: string; border: string }> = [];
      for (let el: Element | null = node; el && el !== host; el = el.parentElement) {
        const s = getComputedStyle(el);
        const painted = !/rgba\([^)]*,\s*0\)|transparent/.test(s.backgroundColor) || s.boxShadow !== 'none' || parseFloat(s.borderTopWidth) > 0;
        if (painted) out.push({ cls: (el as HTMLElement).className, bg: s.backgroundColor, shadow: s.boxShadow, border: s.borderTopWidth });
      }
      return out;
    });
    // At most one painted surface may sit between the empty message and the history card.
    expect(surfaces.length, JSON.stringify(surfaces)).toBeLessThanOrEqual(1);
    const box = await empty.boundingBox();
    const cardBox = await card.boundingBox();
    expect(box && cardBox && box.width >= cardBox.width * 0.6, 'empty state spans the card, not a narrow floating box').toBeTruthy();
  });
}
