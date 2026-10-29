import { expect, test } from '@playwright/test';

const rows = [
  { date: '2026-10-20', assignmentId: 'corrected', employee: { displayName: 'ทดสอบ' }, shift: { code: 'D' }, assignedSite: { name: 'ตามตาราง A' }, actualSite: { name: 'สถานที่จริง B' }, checkInAt: '2026-10-20T01:15:00Z', checkOutAt: '2026-10-20T10:00:00Z', originalCheckInAt: '2026-10-20T01:05:00Z', originalCheckOutAt: null, workedMinutes: 525, corrected: true, flags: ['DEVICE_MISMATCH', 'MISSING_CHECK_OUT'], lateMinutes: 15, status: 'COMPLETE' },
  { date: '2026-10-19', assignmentId: 'normal', employee: { displayName: 'ทดสอบ' }, shift: { code: 'D' }, assignedSite: { name: 'ตามตารางเท่านั้น' }, checkInAt: '2026-10-19T01:00:00Z', checkOutAt: '2026-10-19T10:00:00Z', workedMinutes: 540, flags: [], status: 'COMPLETE' }
];

for (const width of [1366, 375]) test(`print retains collapsed audit details at ${width}px`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/api/v1/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403 });
    return route.fulfill({ json: pathname.endsWith('/attendance/me/history') ? { data: { rows } } : { data: [] } });
  });
  await page.goto('/e2e/attendance-history-print/fixture.html');
  const table = page.getByRole('table', { name: 'รายการลงเวลาทั้งหมด' });
  await expect(table).toBeVisible();
  const corrected = table.locator('tbody tr').nth(0);
  const normal = table.locator('tbody tr').nth(1);
  await expect(corrected.locator('details').first()).not.toHaveAttribute('open', '');
  await expect(corrected.locator('.attendance-history-fit__print-details')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.emulateMedia({ media: 'print' });
  const printDetails = corrected.locator('.attendance-history-fit__print-details');
  for (const text of ['ใช้อุปกรณ์อื่น · ตรวจสอบ', 'ไม่มีเวลาออก', 'สาย 15 นาที', 'ตามตาราง A', 'เดิม', 'มีผล', '08:05', '08:15']) {
    await expect(printDetails.getByText(text, { exact: false }).first(), text).toBeVisible();
  }
  await expect(corrected.locator('.attendance-history-fit__print-site')).toHaveText('สถานที่จริง B');
  await expect(corrected.locator('.attendance-history-fit__print-site')).toBeVisible();
  await expect(normal.locator('.attendance-history-fit__print-details').getByText('เดิม')).toHaveCount(0);
  await expect(normal.locator('.attendance-history-fit__print-site')).toHaveText('–');
  await expect(normal.locator('.attendance-history-fit__screen-site')).toBeHidden();
  await expect(printDetails.getByText('ใช้อุปกรณ์อื่น · ตรวจสอบ', { exact: true })).toHaveCount(1);
  await page.emulateMedia({ media: 'screen' });
  await corrected.locator('details > summary').first().click();
  await corrected.locator('.employee-v4-history-correction > summary').click();
  await page.emulateMedia({ media: 'print' });
  await expect(corrected.locator('.attendance-history-fit__more')).toBeHidden();
  await expect(printDetails.getByText('ใช้อุปกรณ์อื่น · ตรวจสอบ', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
