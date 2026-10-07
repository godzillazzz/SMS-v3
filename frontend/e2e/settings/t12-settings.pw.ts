import { expect, test, type Page, type TestInfo } from '@playwright/test';

const settingRows = [
  { key: 'ATTENDANCE_QR_POLICY', value: 'ADAPTIVE', configured: true, registryStatus: 'REGISTERED', group: 'ATTENDANCE', groupLabel: 'Attendance & Location', label: 'Attendance QR policy', description: 'Attendance QR policy.', valueType: 'ENUM', authority: 'ADMIN_GOVERNED', constraints: { allowedValues: ['ADAPTIVE', 'REQUIRED', 'DISABLED'] } },
  { key: 'ATTENDANCE_GPS_MAX_ACCURACY_METERS', value: undefined, configured: false, registryStatus: 'REGISTERED', group: 'ATTENDANCE', groupLabel: 'Attendance & Location', label: 'GPS max accuracy', description: 'GPS accuracy สูงสุดที่ Attendance ยอมรับ (เมตร)', valueType: 'NUMBER', authority: 'ADMIN_GOVERNED', constraints: { min: 5, max: 100, unit: 'meters' } }
];

const sections = [
  { id: 'overview', path: 'overview', label: 'ภาพรวม', selector: '.configuration-registry' },
  { id: 'attendance-location', path: 'attendance-location', label: 'การลงเวลาและตำแหน่ง', selector: '.attendance-policy-settings-card' },
  { id: 'leave-policy', path: 'leave-policy', label: 'นโยบายการลา', selector: '.leave-policy-settings-card' },
  { id: 'leave-types', path: 'leave-types', label: 'ประเภทการลา', selector: '.leave-type-master-card' },
  { id: 'auto-schedule', path: 'auto-schedule', label: 'รูปแบบจัดกะอัตโนมัติ', selector: '.auto-schedule-pattern-master-card' },
  { id: 'departments-positions', path: 'departments-positions', label: 'หน่วยงานและตำแหน่ง', selector: '.personnel-master-card' },
  { id: 'approval-permissions', path: 'approval-permissions', label: 'สิทธิ์อนุมัติ', selector: '.approval-authority-matrix-card' },
  { id: 'data-retention', path: 'data-retention', label: 'การเก็บรักษาข้อมูล', selector: '.retention-center-card' },
  { id: 'notifications', path: 'notifications', label: 'การแจ้งเตือน', selector: '.notification-center-card' }
];

async function loginAsAdmin(page: Page, target: string) {
  const requests: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${pathname}`);
    if (pathname === '/api/v1/auth/refresh') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'No active session' }) });
    }
    if (pathname === '/api/v1/auth/passkeys/config') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) });
    }
    if (pathname === '/api/v1/auth/login') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-settings-token', user: { id: 'fixture-admin', email: 'admin@example.test', displayName: 'Admin Fixture', role: 'ADMIN' } }) });
    }
    if (pathname === '/api/v1/system-settings') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: settingRows }) });
    }
    if (pathname === '/api/v1/attendance/time-policies') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { now: '2026-10-07T04:00:00.000Z', defaultPolicy: {}, sites: [], shiftTypes: [], policies: [] } }) });
    }
    if (pathname === '/api/v1/retention-policies') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { policy: { operationalUsageMonths: 12, attendanceRawMonths: 24, patrolRawMonths: 12, timezone: 'Asia/Bangkok' }, cutoffs: { operationalUsage: '2025-10-01', attendanceRaw: '2024-10-01', patrolRaw: '2025-10-01' }, timezone: 'Asia/Bangkok', cleanupDelayHours: 24, pendingChange: null, recentRuns: [], protectedInvariants: [] } }) });
    }
    if (pathname === '/api/v1/notification-center') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { events: [], providers: { email: { enabled: false, configured: false, credentialSource: 'ENVIRONMENT' }, line: { enabled: false, configured: false, credentialSource: 'ENVIRONMENT', status: 'NOT_ENABLED' } } } }) });
    }
    if (pathname.startsWith('/api/v1/personnel-masters')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { departments: [], positions: [] } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], summary: {}, meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }) });
  });

  await page.goto(target);
  await expect(page.locator('.nexus-public[data-design="sms-command-nexus-full-bleed"]')).toBeVisible();
  await expect(page.locator('#auth-login-form')).toBeVisible();
  await page.locator('#email').fill('admin@example.test');
  await expect(page.locator('#email')).toHaveValue('admin@example.test');
  await page.locator('#password').fill('fixture-password');
  await expect(page.locator('#password')).toHaveValue('fixture-password');
  await page.locator('#auth-login-form button[type="submit"]').click();
  await expect.poll(() => requests.includes('POST /api/v1/auth/login')).toBe(true);
  await expect(page.locator('#auth-login-form')).toHaveCount(0);
  return requests;
}

test('Settings renders one selected section at a time with nested routes on desktop', async ({ page }, testInfo: TestInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  const requests = await loginAsAdmin(page, '/app/settings/overview?fixture=1');
  const content = page.locator('.settings-section-content');
  const navigation = page.getByRole('navigation', { name: 'หมวดตั้งค่าระบบ' });

  for (const selected of sections) {
    if (selected.id !== 'overview') await navigation.getByRole('link', { name: new RegExp(selected.label) }).click();
    await expect(page).toHaveURL(new RegExp(`/app/settings/${selected.path}(?:\\?|$)`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(selected.label);
    await expect(content).toHaveAttribute('data-settings-section', selected.id);
    await expect(content.locator(selected.selector).first()).toBeVisible();
    const unlabeledControls = await content.locator('input:not([type="hidden"]), select, textarea').evaluateAll((elements) => elements.flatMap((element) => {
      const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const hasProgrammaticName = Boolean(control.getAttribute('aria-label') || control.getAttribute('aria-labelledby'));
      const hasLabel = Boolean(control.labels?.length);
      return hasProgrammaticName || hasLabel ? [] : [`${control.tagName.toLowerCase()}${control.type ? `[type=${control.type}]` : ''}:${control.placeholder || ''}`];
    }));
    expect(unlabeledControls, `unlabeled settings controls in ${selected.id}`).toEqual([]);
    for (const other of sections.filter((item) => item.id !== selected.id)) {
      await expect(content.locator(other.selector)).toHaveCount(0);
    }
    await expect(page).toHaveTitle(`${selected.label} | SMS-v3`);
  }

  await navigation.getByRole('link', { name: /ภาพรวม/ }).click();
  const defaultRow = content.locator('tbody tr').filter({ hasText: 'GPS max accuracy' });
  await expect(defaultRow).toContainText('50 · ค่าเริ่มต้น');
  await expect(defaultRow).toContainText('5–100 · เมตร');
  const technicalDetails = content.locator('tbody tr').filter({ hasText: 'Attendance QR policy' }).locator('details');
  await expect(technicalDetails.locator('code').first()).toBeHidden();
  await technicalDetails.locator('summary').click();
  await expect(technicalDetails.getByText('ATTENDANCE_QR_POLICY')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
  expect(requests.filter((entry) => !entry.startsWith('GET ') && !entry.endsWith('/auth/login') && !entry.endsWith('/auth/refresh'))).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('t12-settings-overview-desktop.png'), fullPage: true });
});

test('Settings nested deep link is readable and query-preserving at 375px', async ({ page }, testInfo: TestInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await loginAsAdmin(page, '/app/settings/leave-types?source=fixture');
  await expect(page).toHaveURL('/app/settings/leave-types?source=fixture');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ประเภทการลา');
  await expect(page.locator('.settings-section-content')).toHaveAttribute('data-settings-section', 'leave-types');
  await expect(page.locator('.leave-type-master-card')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'หมวดตั้งค่าระบบ' }).getByRole('link', { name: /ประเภทการลา/ })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('t12-settings-mobile.png'), fullPage: true });
});
