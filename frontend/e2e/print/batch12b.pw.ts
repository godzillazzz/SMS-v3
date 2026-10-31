import { expect, test, type Page } from '@playwright/test';

// Batch 12 B browser evidence with mock API data (no real backend/DB).
const out = process.env.B12B_SHOT_DIR || 'test-results';
const now = Date.now();
const iso = (offsetHours: number) => new Date(now + offsetHours * 3_600_000).toISOString();
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPpfDwAE/gH/1nRb6wAAAABJRU5ErkJggg==', 'base64');

const announcements = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'แนวทางการส่งมอบเวร', body: 'โปรดตรวจสอบรายการส่งมอบและบันทึกข้อมูลให้ครบถ้วนก่อนสิ้นสุดกะ เพื่อให้ทีมถัดไปรับช่วงได้ต่อเนื่อง', category: 'POLICY', pinned: true, showPopup: true, hasImage: true, imageUrl: '/api/v1/announcements/11111111-1111-4111-8111-111111111111/image?v=a', expiresAt: null, expiresOn: null, expired: false, createdAt: iso(-2), updatedAt: iso(-2) },
  { id: '22222222-2222-4222-8222-222222222222', title: 'แจ้งกำหนดตรวจอุปกรณ์', body: 'ขอให้แต่ละจุดเตรียมอุปกรณ์สำหรับการตรวจประจำเดือน และแจ้งรายการที่ต้องซ่อมล่วงหน้า', category: 'GENERAL', pinned: false, showPopup: true, hasImage: false, imageUrl: null, expiresAt: iso(48), expiresOn: new Date(now + 86400000).toISOString().slice(0, 10), expired: false, createdAt: iso(-26), updatedAt: iso(-26) },
  { id: '33333333-3333-4333-8333-333333333333', title: 'กิจกรรมอบรมประจำเดือน', body: 'พบกันในกิจกรรมทบทวนขั้นตอนความปลอดภัยประจำเดือน รายละเอียดเพิ่มเติมจะแจ้งให้ทราบอีกครั้ง', category: 'EVENT', pinned: false, showPopup: false, hasImage: false, imageUrl: null, expiresAt: null, expiresOn: null, expired: false, createdAt: iso(-50), updatedAt: iso(-50) }
];

const operations = {
  date: new Date().toISOString().slice(0, 10), planned: 48, checkedIn: 42, lateNotCheckedIn: 3, assistOtherSite: 2, onLeave: 1, graceMinutes: 15,
  patrol: { scanned: 8, total: 12, round: 1, roundStart: iso(-1), roundEnd: iso(2), incompleteDepartments: [{ department: 'ไซต์ตัวอย่าง C', missing: 4 }] },
  pendingLeave: 2,
  sites: [
    { id: 'b', name: 'ไซต์ตัวอย่าง B', planned: 15, checkedIn: 12, late: 3, status: 'URGENT' },
    { id: 'c', name: 'ไซต์ตัวอย่าง C', planned: 15, checkedIn: 12, late: 0, status: 'WATCH' },
    { id: 'a', name: 'ไซต์ตัวอย่าง A', planned: 18, checkedIn: 18, late: 0, status: 'NORMAL' }
  ],
  actions: [
    { type: 'LATE_NOT_CHECKED_IN', severity: 'URGENT', title: 'ยังไม่เช็กอินเลยเวลา', detail: 'ไซต์ตัวอย่าง B · เกินเวลาเริ่มกะ', count: 3, unit: 'คน', target: 'attendanceSupervisor' },
    { type: 'PATROL_INCOMPLETE', severity: 'WATCH', title: 'จุดตรวจยังไม่ครบในรอบนี้', detail: 'ไซต์ตัวอย่าง C · เหลือ 4 จุด', count: 4, unit: 'จุด', target: 'patrolCenter' },
    { type: 'LEAVE_PENDING', severity: 'INFO', title: 'คำขอลารออนุมัติ', detail: 'ตรวจสอบก่อนจัดกำลัง', count: 2, unit: 'รายการ', target: 'leavePending' }
  ],
  partialErrors: [], siteId: null, siteOptions: [{ id: 'a', name: 'ไซต์ตัวอย่าง A' }, { id: 'b', name: 'ไซต์ตัวอย่าง B' }, { id: 'c', name: 'ไซต์ตัวอย่าง C' }], generatedAt: new Date().toISOString()
};

const json = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

async function boot(page: Page, { popups = false, role = 'ADMIN' } = {}) {
  await page.route('**/api/v1/**', (route) => route.fulfill(json({ data: [], meta: { page: 1, total: 0, pageSize: 20, totalPages: 1 } })));
  await page.route('**/api/v1/dashboard?**', (route) => route.fulfill(json({ data: { totalEmployees: 52, activeEmployees: 48, onDutyToday: 48, leaveToday: 1, expiringLicenses: 0, actionRequired: [], recentActivity: [], generatedAt: new Date().toISOString() } })));
  await page.route('**/api/v1/dashboard', (route) => route.fulfill(json({ data: { totalEmployees: 52, activeEmployees: 48, onDutyToday: 48, leaveToday: 1, expiringLicenses: 0, actionRequired: [], recentActivity: [], generatedAt: new Date().toISOString() } })));
  await page.route('**/api/v1/dashboard/operations-today**', (route) => route.fulfill(json({ data: operations })));
  await page.route('**/api/v1/announcements?**', (route) => route.fulfill(json({ data: announcements })));
  await page.route('**/api/v1/announcements/popups', (route) => route.fulfill(json({ data: popups ? announcements.filter((row) => row.showPopup) : [] })));
  await page.route('**/api/v1/announcements/*/image**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.route('**/api/v1/ui-theme', (route) => route.fulfill(json({ data: { palette: { primary: '#2563eb', secondary: '#43506a', buttonPrimary: '#1d4ed8', buttonSecondary: '#43506a', success: '#0e7a42', warning: '#8f5300', danger: '#b42318' }, isDefault: true, updatedAt: null } })));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill(json({ accessToken: 'fixture-access-token', user: { id: 'u1', email: 'x@example.test', displayName: 'ผู้ดูแลระบบ', role, employeeId: 'e1' } })));
  await page.route('**/api/v1/auth/passkeys/config', (route) => route.fulfill(json({ enabled: false })));
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
  test(`batch12b dashboard, announcements and display settings at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await boot(page);
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'ภาพรวมวันนี้' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('ประกาศล่าสุด')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${out}/dashboard-${viewport.width}x${viewport.height}.png`, fullPage: false });

    await page.goto('/app/announcements');
    await expect(page.locator('.announcement-card')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('.announcement-card img').first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${out}/announcements-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await page.getByRole('button', { name: '+ เขียนประกาศ' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `${out}/announcement-editor-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await page.keyboard.press('Escape');

    await page.goto('/app/settings/display');
    await expect(page.getByRole('heading', { name: 'สีของระบบ' })).toBeVisible({ timeout: 15_000 });
    await page.locator('#display-color-warning').fill('#FFD166');
    await expect(page.getByText(/ความต่างสีน้อยกว่า 4\.5:1/).first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `${out}/settings-display-${viewport.width}x${viewport.height}.png`, fullPage: false });
  });

  test(`batch12b login pop-up at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await boot(page, { popups: true });
    await page.goto('/app');
    const dialog = page.locator('.announcement-modal.is-popup');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText('1 / 2');
    await expect(dialog.locator('img')).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `${out}/popup-${viewport.width}x${viewport.height}.png`, fullPage: false });
    await dialog.getByRole('button', { name: 'ถัดไป ›' }).click();
    await expect(dialog).toContainText('2 / 2');
    await dialog.getByRole('button', { name: 'ไม่แสดงอีก 7 วัน' }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ภาพรวมวันนี้' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.announcement-modal.is-popup')).toHaveCount(0);
  });
}
