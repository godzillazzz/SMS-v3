import { test, expect } from '@playwright/test';

// Owner report 2026-10-29: opening the license row "⋯" menu shows items whose text is not visible.
const license = { id: 'lic-1', licenseNumber: 'สบ 76811610', licenseType: 'ใบอนุญาต รปภ.', status: 'ACTIVE', issuedAt: '2023-08-25', expiresAt: '2028-08-25', employeeId: 'emp-1', employee: { id: 'emp-1', employeeCode: 'EMP001', firstName: 'ทัศยุ', lastName: 'สุริโย', department: 'PO11' }, documents: [] };

function luminance(rgb: string) {
  const [r, g, b] = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }

for (const theme of ['light', 'dark'] as const) for (const viewport of [{ width: 1366, height: 768 }]) {
  test(`license row menu items are readable ${theme} ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript((value) => { localStorage.setItem('sms-v3-theme', value); }, theme);
    await page.route('**/api/v1/**', (route) => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/auth/refresh') return route.fulfill({ status: 401, json: { message: 'No fixture session' } });
      if (pathname === '/api/v1/auth/login') return route.fulfill({ json: { accessToken: 'synthetic-license-token', user: { id: 'lic-admin', email: 'admin@example.test', displayName: 'ผู้ดูแลทดสอบ', role: 'ADMIN' } } });
      if (request.method() !== 'GET') return route.fulfill({ status: 403, json: { message: 'Fixture forbids business writes' } });
      if (pathname === '/api/v1/auth/passkeys/config') return route.fulfill({ json: { enabled: false } });
      if (pathname === '/api/v1/licenses') return route.fulfill({ json: { data: [license], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
      return route.fulfill({ json: { data: [], summary: { total: 0, byType: {} }, meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } });
    });
    await page.goto('/app/licenses');
    await expect(page.locator('.nexus-onescreen #auth-login-form')).toBeVisible();
    await page.locator('#email').fill('admin@example.test');
    await page.locator('#password').fill('synthetic-license-password');
    await page.locator('#auth-login-form button[type=submit]').click();
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sms-loader--content')).toHaveCount(0, { timeout: 20_000 });
    await page.locator('.data-row-more-trigger:visible').first().scrollIntoViewIfNeeded();
    await page.locator('.data-row-more-trigger:visible').first().click();
    const items = page.locator('.data-row-menu-popover [role="menuitem"]');
    await expect(items.first()).toBeVisible();
    // The popover is portalled to <body> and floats over the table, so it must paint its own opaque surface.
    const popoverBg = await page.locator('.data-row-menu-popover').evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(popoverBg, 'popover background must be opaque').not.toMatch(/rgba\([^)]*,\s*0\)|transparent/);
    const samples = await items.evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      const pop = node.closest('.data-row-menu-popover')!;
      const own = style.backgroundColor;
      const bg = own === 'rgba(0, 0, 0, 0)' || own === 'transparent' ? getComputedStyle(pop).backgroundColor : own;
      return { text: node.textContent || '', color: style.color, bg, opacity: Number(style.opacity), disabled: (node as HTMLButtonElement).disabled };
    }));
    for (const s of samples) {
      expect(s.text.trim().length, 'menu item has a label').toBeGreaterThan(0);
      if (!s.disabled) expect(contrast(s.color, s.bg), `${s.text}: ${s.color} on ${s.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
