import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
  test(`daily attendance remains readable ${viewport.width}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    const site = { id: 'site', name: 'สถานีเพิ่มความดันก๊าซธรรมชาติ', code: 'S' };
    const row = { date: '2026-10-30', assignmentId: 'a', employeeId: 'e', employeeCode: 'E001', employeeName: 'พนักงาน ทดสอบ', shift: { id: 'd', code: 'D' }, assignedSite: site, actualSite: site, checkInAt: '2026-10-30T11:45:00Z', checkOutAt: '2026-10-30T14:30:00Z', workedMinutes: 165, attendanceStatus: 'LATE', flags: ['ROLE_SELFIE_VERIFICATION_REQUIRED'] };
    await page.route('**/api/v1/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/v1/auth/refresh') return route.fulfill({ status: 401, json: {} });
      if (path === '/api/v1/auth/login') return route.fulfill({ json: { accessToken: 'synthetic-token', user: { id: 'u', email: 'layout@example.test', displayName: 'ทดสอบ', department: 'AN1', role: 'ADMIN', employeeId: 'e' } } });
      if (request.method() !== 'GET') return route.fulfill({ status: 403, json: {} });
      if (path === '/api/v1/auth/passkeys/config') return route.fulfill({ json: { enabled: false } });
      if (path === '/api/v1/attendance/supervisor/daily') return route.fulfill({ json: { data: { rows: [row], summary: { requiresAttention: 1, scheduledToday: 1, checkedIn: 1, currentlyWorking: 1, notCheckedInYet: 0, late: 1, earlyOut: 0, wrongShift: 0, assistingOtherSite: 0, outsideAllSites: 0, leave: 0, absent: 0, timeAbnormal: 0 } } } });
      if (path === '/api/v1/security-sites') return route.fulfill({ json: { data: { sites: [] } } });
      return route.fulfill({ json: { data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 1 } } });
    });
    await page.goto('/app/attendance');
    await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
    await page.locator('#email').fill('layout@example.test');
    await page.locator('#password').fill('synthetic-password');
    await page.locator('#auth-login-form button[type=submit]').click();
    const root = viewport.width === 1366 ? page.locator('.attendance-supervisor-v4__table') : page.locator('.attendance-supervisor-v4__mobile-card').first();
    await expect(root).toContainText('พนักงาน ทดสอบ');
    if (viewport.width === 1366) {
      const metrics = await root.evaluate(table => {
        const measure = (el: Element) => { const node = el as HTMLElement; return { text: node.textContent, width: node.clientWidth, scrollWidth: node.scrollWidth, height: node.clientHeight, scrollHeight: node.scrollHeight, font: parseFloat(getComputedStyle(node).fontSize) }; };
        return { heads: [...table.querySelectorAll('th')].map(measure), cells: [...table.querySelectorAll('tbody tr:first-child td')].map(measure), sites: [...table.querySelectorAll('.attendance-supervisor-v4__site')].map(measure), flags: [...table.querySelectorAll('.attendance-supervisor-v4__flags span')].map(measure) };
      });
      expect(metrics.heads.every(x => x.font >= 11 && x.scrollWidth <= x.width + 1 && x.scrollHeight <= x.height + 1)).toBe(true);
      expect(metrics.cells[4].text).toBe('18:45');
      expect(metrics.cells[5].text).toBe('21:30');
      expect([metrics.cells[4], metrics.cells[5], ...metrics.sites, ...metrics.flags].every(x => x.scrollWidth <= x.width + 1 && x.scrollHeight <= x.height + 1)).toBe(true);
    } else {
      await expect(root).toContainText('ROLE_SELFIE_VERIFICATION_REQUIRED');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}
