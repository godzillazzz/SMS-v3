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

type RequestRecord = { path: string; lifecycle: string; started: number; responded?: number };
const SUMMARY_DELAY_MS = 1500;
const SUMMARY_TTL_MS = 2000;
const READY_TIMEOUT_MS = Number.parseInt(process.env.PW_READY_TIMEOUT_MS ?? '60000', 10);
const READY_POLL_INTERVALS = [100, 250, 500, 1000];

function readinessTimeout(): number {
  return Number.isFinite(READY_TIMEOUT_MS) && READY_TIMEOUT_MS >= 30_000 ? READY_TIMEOUT_MS : 60_000;
}

async function installFixture(page: Page, role: 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'VIEWER' = 'ADMIN') {
  const requests: RequestRecord[] = [];
  let lifecycle = 'dashboard';
  // Closure state belongs to this Playwright Page only. It models the browser
  // refresh-cookie contract without changing production authentication.
  let syntheticSession = false;
  const user = { id: 'synthetic-r71-user', email: 'r71@example.test', displayName: 'R7.1 Fixture', role };
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
    if (path === '/api/v1/dashboard/summary' || path === '/api/v1/dashboard') {
      const record: RequestRecord = { path, lifecycle, started: performance.now() };
      requests.push(record);
      await json(route, { data: dashboardSummary });
      record.responded = performance.now();
      return;
    }
    if (path === '/api/v1/approval-center/summary' || path === '/api/v1/approval-center') {
      const record: RequestRecord = { path, lifecycle, started: performance.now() };
      requests.push(record);
      if (path.endsWith('/summary')) await new Promise(resolve => setTimeout(resolve, SUMMARY_DELAY_MS));
      await json(route, path.endsWith('/summary') ? approvalSummary : approvalList);
      record.responded = performance.now();
      return;
    }
    if (path === '/api/v1/schedule-calendar') return json(route, {
      data: { month: new URL(route.request().url()).searchParams.get('month'), dates: ['2026-10-14'],
        employees: [{ id: 'fixture-employee', employeeCode: 'R71', firstName: 'Fixture', lastName: 'Employee', department: 'Operations', shifts: [] }],
        approval: { status: 'PENDING', revision: 1 } },
      meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 },
    });
    if (path === '/api/v1/rules' || path.includes('/rule')) return json(route, { data: [], summary: {}, meta: { total: 0 } });
    if (path.includes('/audit')) return json(route, {
      data: [{ id: 'audit-r71-1', action: 'CREATE', module: 'AUTH', actor: { role: 'ADMIN', displayName: 'R7.1 Fixture' }, createdAt: '2026-10-14T00:00:00.000Z' }],
      summary: {}, meta: { total: 1, page: 1, pageSize: 25, totalPages: 1 },
    });
    return json(route, { data: [], summary: {}, meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } });
  });
  return { requests, setLifecycle: (value: string) => { lifecycle = value; } };
}

async function navigateFromShell(page: Page, navigationId: string, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'เปิดเมนูหลัก' }).click();
  const item = page.locator(`.sidebar .nav-item[data-navigation-id="${navigationId}"]`);
  await expect(item).toBeVisible();
  await item.click();
}

async function signIn(page: Page, fixture: { requests: RequestRecord[] }, role: 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'VIEWER' = 'ADMIN') {
  test.info().setTimeout(readinessTimeout() + 10_000);
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? 'unknown failure'}`));
  await page.goto('/app');
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await page.locator('#email').fill('r71@example.test');
  await page.locator('#password').fill('synthetic-password');
  const dashboardResponse = page.waitForResponse(response => {
    const path = new URL(response.url()).pathname;
    return response.ok() && (path === '/api/v1/dashboard' || path === '/api/v1/dashboard/summary');
  });
  await page.locator('#auth-login-form button[type="submit"]').click();
  try {
    await dashboardResponse;
    await expect.poll(async () => {
      const shellReady = await page.locator('.app-shell').isVisible().catch(() => false);
      const menuReady = await page.locator('.sidebar .nav-item').first().isVisible().catch(() => false);
      const dashboardReady = fixture.requests.some(record =>
        record.lifecycle === 'dashboard' &&
        (record.path === '/api/v1/dashboard' || record.path === '/api/v1/dashboard/summary') &&
        record.responded !== undefined,
      );
      return shellReady && menuReady && dashboardReady;
    }, { timeout: readinessTimeout(), intervals: READY_POLL_INTERVALS }).toBe(true);
    if (role !== 'VIEWER') {
      await expect.poll(() => fixture.requests.filter(record =>
        record.lifecycle === 'dashboard' && record.path === '/api/v1/approval-center/summary' && record.responded !== undefined,
      ).length, { timeout: readinessTimeout(), intervals: READY_POLL_INTERVALS }).toBe(1);
    }
  } catch (error) {
    const pending = fixture.requests
      .filter(record => record.responded === undefined)
      .map(record => `${record.path} [${record.lifecycle}]`);
    throw new Error([
      `R71 readiness timed out after ${readinessTimeout()}ms`,
      `url=${page.url()}`,
      `shellVisible=${await page.locator('.app-shell').isVisible().catch(() => false)}`,
      `pendingApi=${JSON.stringify(pending)}`,
      `requests=${JSON.stringify(fixture.requests)}`,
      `consoleErrors=${JSON.stringify(consoleErrors.slice(-10))}`,
      `failedRequests=${JSON.stringify(failedRequests.slice(-10))}`,
      `cause=${error instanceof Error ? error.message : String(error)}`,
    ].join('\n'));
  }
}

// Canvas delegates CSS Color 4 parsing (including alpha) to the browser.
// The walk stops at the nearest fully opaque background so an unrelated
// gradient outside an opaque component cannot invalidate that component's
// rendered contrast. Paint that cannot be resolved is always fail-closed.
async function computedContrast(locator: ReturnType<Page['locator']>) {
  return locator.evaluate((element) => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof CSS === 'undefined' || !CSS.supports) return null;
    const parse = (value: string): RGBA | null => {
      if (!CSS.supports('color', value)) return null;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const rgba = context.getImageData(0, 0, 1, 1).data;
      return [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255];
    };
    const over = (front: RGBA, back: RGBA): RGBA => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [
        (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
        (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
        (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
        alpha,
      ];
    };
    const withOpacity = (color: RGBA, opacity: number): RGBA => [color[0], color[1], color[2], color[3] * opacity];
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    // Reject unrelated paint layers above the target, but allow elements below
    // it in the hit-test stack. This distinguishes a real overlay from a
    // normal overlapping ancestor/sibling that is not painted above the text.
    for (const fraction of [0.1, 0.5, 0.9]) {
      const x = bounds.left + bounds.width * fraction;
      const y = bounds.top + bounds.height / 2;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
      const stack = document.elementsFromPoint(x, y);
      const targetIndex = stack.indexOf(element);
      if (targetIndex < 0 || stack.slice(0, targetIndex).some(node => !node.contains(element))) return null;
    }
    let foreground = parse(getComputedStyle(element).color);
    let background: RGBA = [0, 0, 0, 0];
    if (!foreground) return null;
    let node: Element | null = element;
    while (node) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none' || style.filter !== 'none' ||
          style.backdropFilter !== 'none' ||
          (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter !== undefined &&
            (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter !== 'none' ||
          style.mixBlendMode !== 'normal') return null;
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(node, pseudo).content;
        if (content !== 'none' && content !== 'normal' && content !== '""') return null;
      }
      const layer = parse(style.backgroundColor);
      const opacity = Number(style.opacity);
      if (!layer || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) return null;
      foreground = withOpacity(over(foreground, layer), opacity);
      background = withOpacity(over(background, layer), opacity);
      // Once the effective background is opaque, ancestors cannot change the
      // rendered pixel and must not introduce unrelated outer gradients.
      if (background[3] >= 1 - Number.EPSILON) break;
      node = node.parentElement;
    }
    // An unknown canvas/backdrop cannot be assumed white or black.
    if (background[3] < 1 - Number.EPSILON || foreground[3] < 1 - Number.EPSILON) return null;
    const luminance = (rgba: RGBA) => rgba.slice(0, 3).reduce((sum, channel, i) =>
      sum + [0.2126, 0.7152, 0.0722][i] * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4), 0);
    const fg = luminance(foreground), bg = luminance(background);
    return { foreground, background, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
  });
}

async function assertContrast(locator: ReturnType<Page['locator']>) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const colors = await computedContrast(locator);
  const diagnostics = `effective foreground/background/ratio: ${JSON.stringify(colors)}`;
  expect(colors, diagnostics).not.toBeNull();
  expect(colors!.ratio, diagnostics).toBeGreaterThanOrEqual(4.5);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  // Only the intentional unauthenticated refresh probe is allowed.
  const consoleAllowlist = [{ text: /^Failed to load resource: the server responded with a status of 401/, path: '/api/v1/auth/refresh' }];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !consoleAllowlist.some(rule => rule.text.test(message.text()) && new URL(message.location().url || 'http://fixture.invalid').pathname === rule.path)) errors.push(message.text());
  });
  return errors;
}

async function dismissUtility(page: Page, method: 'backdrop' | 'Escape') {
  const panel = page.locator('#mobile-utility-panel');
  const backdrop = page.locator('button.mobile-utility-backdrop');
  await expect(panel).toBeVisible();
  if (method === 'Escape') await page.keyboard.press('Escape');
  else {
    const panelBox = await panel.boundingBox();
    const backdropBox = await backdrop.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(backdropBox).not.toBeNull();
    const point = await backdrop.evaluate((element, box) => {
      const rect = element.getBoundingClientRect();
      for (const x of [rect.left + 8, rect.right - 8]) {
        for (const y of [rect.top + 8, rect.bottom - 8]) {
          if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
          if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) continue;
          if (document.elementFromPoint(x, y) === element) return { x: x - rect.left, y: y - rect.top };
        }
      }
      return null;
    }, panelBox!);
    expect(point, 'visible backdrop point outside utility panel').not.toBeNull();
    await backdrop.click({ position: point! });
  }
  await expect(panel).toBeHidden();
  await expect(backdrop).toBeHidden();
  await expect(page.getByRole('button', { name: 'เปิดเมนูบัญชีและธีม' })).toBeFocused();
}

test('R7.1 native contrast normalization and fail-closed paint cases', async ({ page }) => {
  await page.setContent('<style>html,body{margin:0;background:rgb(255 255 255)} #surface{padding:20px;background:rgb(255 255 255)} #label{display:block;width:100px;height:30px;color:rgb(0 0 0)}</style><div id="surface"><span id="label">Contrast</span></div>');
  const label = page.locator('#label');
  for (const color of ['rgb(0, 0, 0)', 'rgba(0, 0, 0, 1)', 'rgb(0 0 0 / 100%)', 'color(srgb 0 0 0 / 1)']) {
    await label.evaluate((element, value) => (element as HTMLElement).style.color = value, color);
    const result = await computedContrast(label);
    expect(result, color).not.toBeNull();
    expect(result!.ratio, JSON.stringify(result)).toBe(21);
  }
  await label.evaluate(element => (element as HTMLElement).style.color = 'rgb(0 0 0 / 50%)');
  const alpha = await computedContrast(label);
  expect(alpha).not.toBeNull();
  expect(alpha!.foreground[0]).toBeCloseTo(1 - 128 / 255, 8);
  await label.evaluate(element => (element as HTMLElement).style.color = 'black');
  await page.locator('#surface').evaluate(element => (element as HTMLElement).style.opacity = '0.5');
  const opacity = await computedContrast(label);
  expect(opacity).not.toBeNull();
  expect(opacity!.foreground).toEqual([0.5, 0.5, 0.5, 1]);
  await page.locator('#surface').evaluate(element => { (element as HTMLElement).style.opacity = '1'; (element as HTMLElement).style.backgroundColor = 'rgb(0 0 0 / 50%)'; });
  const background = await computedContrast(label);
  expect(background).not.toBeNull();
  expect(background!.background[0]).toBeCloseTo(1 - 128 / 255, 8);
  for (const [property, value] of [
    ['backgroundImage', 'linear-gradient(white, black)'], ['backgroundImage', 'url("data:image/png;base64,AA==")'],
    ['filter', 'blur(1px)'], ['backdropFilter', 'blur(1px)'], ['mixBlendMode', 'multiply'],
  ]) {
    await page.locator('#surface').evaluate((element, pair) => { (element as HTMLElement).style[pair[0] as 'filter'] = pair[1]; }, [property, value]);
    expect(await computedContrast(label), `${property}: ${value}`).toBeNull();
    await page.locator('#surface').evaluate((element, key) => (element as HTMLElement).style.removeProperty(key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)), property);
  }
  await page.evaluate(() => { const overlay = document.createElement('div'); overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.1)'; document.body.append(overlay); });
  expect(await computedContrast(label), 'unresolved overlapping sibling').toBeNull();
});

for (const theme of ['light', 'dark'] as const) {
  for (const method of ['backdrop', 'Escape'] as const) {
    test(`R7.1 mobile utility ${method} dismissal ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.addInitScript(value => localStorage.setItem('sms-v3-theme', value), theme);
      const errors = collectErrors(page);
      const fixture = await installFixture(page);
      await signIn(page, fixture);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('button', { name: 'เปิดเมนูบัญชีและธีม' }).click();
      await dismissUtility(page, method);
      expect(errors).toEqual([]);
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ name: 'desktop', width: 1366, height: 768 }, { name: 'mobile', width: 375, height: 812 }] as const) {
    test(`R7.1 visual contracts ${theme} ${viewport.name}`, async ({ page }, testInfo: TestInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('sms-v3-theme', value), theme);
      const fixture = await installFixture(page);
      const errors = collectErrors(page);
      await signIn(page, fixture);

      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const logo = page.locator('.sidebar-brand picture.sms-brand-logo');
      if (viewport.name === 'desktop') {
        await expect(logo).toBeVisible();
        const geometry = await logo.evaluate((element) => {
          const image = element.getBoundingClientRect();
          const parent = element.closest('.sidebar-brand')!;
          const brand = parent.getBoundingClientRect();
          const style = getComputedStyle(parent);
          const left = brand.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
          const right = brand.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
          const contentCenter = (left + right) / 2;
          return { imageTop: image.top, imageBottom: image.bottom, brandTop: brand.top, brandBottom: brand.bottom, width: image.width, centerOffset: Math.abs((image.left + image.right) / 2 - contentCenter) };
        });
        expect(geometry.imageTop).toBeGreaterThanOrEqual(geometry.brandTop);
        expect(geometry.imageBottom).toBeLessThanOrEqual(geometry.brandBottom - 1);
        expect(geometry.centerOffset).toBeLessThanOrEqual(1);
        expect(geometry.width).toBeGreaterThanOrEqual(140);
      }

      const quickAction = page.locator('.dashboard-quick-actions__grid button small').first();
      await expect(quickAction).toBeVisible();
      await assertContrast(quickAction);

      const role = viewport.name === 'mobile'
        ? page.getByRole('button', { name: 'เปิดเมนูบัญชีและธีม' })
        : page.locator('.topbar-profile small');
      if (viewport.name === 'mobile') {
        await role.click();
        const mobileRole = page.locator('.mobile-utility-profile small');
        await expect(mobileRole).toBeVisible();
        await assertContrast(mobileRole);
        await dismissUtility(page, 'backdrop');
        await role.click();
        await dismissUtility(page, 'Escape');
      } else {
        await expect(role).toBeVisible();
        await assertContrast(role);
      }

      await navigateFromShell(page, 'schedule', viewport.name === 'mobile');
      await assertContrast(page.locator('.roster-month-label'));
      await navigateFromShell(page, 'rules', viewport.name === 'mobile');
      const monthLabel = page.locator('.month-filter');
      await expect(monthLabel).toBeVisible();
      await assertContrast(monthLabel.locator('span'));
      const metric = page.locator('.rule-summary-grid strong').first();
      await expect(metric).toBeVisible();
      await assertContrast(metric);

      await navigateFromShell(page, 'audit', viewport.name === 'mobile');
      const auditBadges = viewport.name === 'mobile'
        ? ['.audit-action-badge', '.audit-module-badge', '.audit-role-badge']
        : ['.audit-desktop-table .audit-action-badge', '.audit-desktop-table .audit-module-badge', '.audit-desktop-table tbody td:nth-child(2) small'];
      for (const selector of auditBadges) {
        const badges = page.locator(selector).filter({ visible: true });
        await expect(badges.first()).toBeVisible();
        for (const badge of await badges.all()) await assertContrast(badge);
      }

      await page.screenshot({ path: testInfo.outputPath(`r71-${theme}-${viewport.name}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      expect(errors).toEqual([]);
    });
  }
}

for (const mobile of [false, true]) {
  test(`R7.1 Approval Center delayed dedupe and routing ${mobile ? 'mobile' : 'desktop'}`, async ({ page }, testInfo) => {
    await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1366, height: 768 });
    await page.addInitScript(() => localStorage.setItem('sms-v3-theme', 'dark'));
    const errors = collectErrors(page);
    const fixture = await installFixture(page);
    await signIn(page, fixture);
    // Finish dashboard lifecycle before measuring a new document/navigation.
    await expect.poll(() => fixture.requests.filter(r => r.lifecycle === 'dashboard' && r.path.endsWith('/summary') && r.responded !== undefined).length).toBe(1);
    fixture.setLifecycle('approval-center-1');
    await page.goto('/app/approvals?type=SCHEDULE&month=2026-10&year=2026');
    const refresh = page.getByRole('button', { name: 'รีเฟรชข้อมูล' });
    const records = (path: string) => fixture.requests.filter(r => r.lifecycle === 'approval-center-1' && r.path === path);
    await test.step('settle delayed summary, list and consumers beyond delay plus TTL', async () => {
      await expect(page.locator('.approval-center-page')).toBeVisible();
      await expect(refresh).toBeEnabled();
      await expect(page.locator('.approval-metric-skeleton')).toHaveCount(0);
      await expect(page.locator('.approval-queue-state').filter({ hasText: 'กำลังโหลดคิวอนุมัติ' })).toHaveCount(0);
      await expect(page.locator('.approval-center-page .spinner:visible, .approval-center-page [role="progressbar"]:visible')).toHaveCount(0);
      await expect.poll(() => records('/api/v1/approval-center/summary').filter(r => r.responded !== undefined).length).toBe(1);
      await expect.poll(() => records('/api/v1/approval-center').filter(r => r.responded !== undefined).length).toBe(1);
      await page.waitForTimeout(SUMMARY_DELAY_MS + SUMMARY_TTL_MS + 300);
      const summary = records('/api/v1/approval-center/summary');
      expect(summary, JSON.stringify(fixture.requests)).toHaveLength(1);
      expect(records('/api/v1/approval-center'), JSON.stringify(fixture.requests)).toHaveLength(1);
      expect(summary.filter(r => r.started < summary[0].responded!), 'no concurrent summary duplicate before first response').toHaveLength(1);
    });
    await test.step('explicit refresh after TTL issues exactly one new summary and list', async () => {
      await refresh.click();
      await expect(refresh).toBeEnabled();
      await expect.poll(() => records('/api/v1/approval-center/summary').filter(r => r.responded !== undefined).length).toBe(2);
      await expect.poll(() => records('/api/v1/approval-center').filter(r => r.responded !== undefined).length).toBe(2);
      await page.waitForTimeout(SUMMARY_DELAY_MS + SUMMARY_TTL_MS + 300);
      expect(records('/api/v1/approval-center/summary'), JSON.stringify(fixture.requests)).toHaveLength(2);
      expect(records('/api/v1/approval-center'), JSON.stringify(fixture.requests)).toHaveLength(2);
    });
    const assertQuery = async (path: string) => {
      await expect.poll(() => new URL(page.url()).pathname).toBe(path);
      const query = new URL(page.url()).searchParams;
      expect(query.get('type')).toBeNull();
      expect(query.get('month')).toBe('2026-10');
      expect(query.get('year')).toBe('2026');
    };
    await navigateFromShell(page, 'employees', mobile);
    await assertQuery('/app/employees');
    await navigateFromShell(page, 'rules', mobile);
    await assertQuery('/app/rules');
    // Use the actual visible shell controls for command palette navigation.
    if (mobile) {
      await page.getByRole('button', { name: 'เปิดเมนูบัญชีและธีม' }).click();
      await page.getByRole('button', { name: 'ไปยังงานหรือหน้าอื่น' }).click();
    } else await page.locator('.workflow-command-trigger').click();
    const command = page.getByRole('dialog', { name: 'ไปยังงานหรือหน้าที่ต้องการ' });
    await expect(command).toBeVisible();
    await command.getByRole('button').filter({ has: page.locator('strong', { hasText: /^ข้อมูลพนักงาน$/ }) }).click();
    await assertQuery('/app/employees');
    await expect(command).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(mobile ? 375 : 1366);
    await page.screenshot({ path: testInfo.outputPath('r71-approval-routing.png'), fullPage: true });
    await testInfo.attach('approval-request-lifecycles', { body: JSON.stringify(fixture.requests, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
    // Mutation invalidation remains unverified: this read-only queue fixture has
    // no actionable request or mutation response contract.
  });
}

for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'] as const) {
  test(`T42 initial Dashboard API sequencing ${role}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const fixture = await installFixture(page, role);
    await signIn(page, fixture, role);
    await expect.poll(() => fixture.requests.filter(r => r.lifecycle === 'dashboard' && r.path === '/api/v1/dashboard' && r.responded !== undefined).length).toBe(1);
    const dashboard = fixture.requests.filter(r => r.lifecycle === 'dashboard' && r.path === '/api/v1/dashboard');
    expect(dashboard).toHaveLength(1);
    if (role === 'VIEWER') {
      expect(fixture.requests.filter(r => r.lifecycle === 'dashboard' && r.path === '/api/v1/approval-center/summary')).toHaveLength(0);
    } else {
      await expect.poll(() => fixture.requests.filter(r => r.lifecycle === 'dashboard' && r.path === '/api/v1/approval-center/summary' && r.responded !== undefined).length).toBe(1);
      const approval = fixture.requests.filter(r => r.lifecycle === 'dashboard' && r.path === '/api/v1/approval-center/summary');
      expect(approval).toHaveLength(1);
      expect(approval[0].started).toBeGreaterThanOrEqual(dashboard[0].responded!);
    }
  });
}
