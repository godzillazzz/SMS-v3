import { expect, test, type Page } from '@playwright/test';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const d = (offset: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + offset * 86400000).toISOString().slice(0, 10);
const dates = [-6, -5, -4, -3, -2, -1, 0].map(d);

function report() {
  const cell = (count: number) => ({ count, lastScanAt: count ? `${today}T02:15:00.000Z` : null, lastEmployeeName: count ? 'สมชาย ใจดี' : null, lastEmployeeCode: count ? 'EMP001' : null });
  const days = (pattern: number[]) => Object.fromEntries(dates.map((day, index) => [day, cell(pattern[index])]));
  return {
    from: dates[0], to: today, department: null, generatedAt: new Date().toISOString(),
    coverage: {
      dates,
      departments: [
        { department: 'ANO', total: 14, scanned: 10, checkpoints: [
          { id: 'c1', code: 'ANO-01', name: 'ประตูทางเข้าหลัก', locationNote: 'ป้อมหน้า', days: days([1, 1, 2, 1, 1, 1, 1]), scannedDays: 7 },
          { id: 'c2', code: 'ANO-02', name: 'ลานจอดรถด้านหลังอาคาร B', locationNote: null, days: days([1, 0, 1, 0, 1, 0, 0]), scannedDays: 3 }
        ] },
        { department: 'WCS', total: 7, scanned: 2, checkpoints: [
          { id: 'c3', code: 'WCS-01', name: 'คลังสินค้า', locationNote: null, days: days([0, 0, 1, 0, 0, 1, 0]), scannedDays: 2 }
        ] }
      ],
      summary: { checkpoints: 3, scanned: 12, pending: 9, scans: 13, percent: 57 }
    },
    scans: []
  };
}

const checkpoints = [
  { id: 'c1', code: 'ANO-01', name: 'ประตูทางเข้าหลัก', department: 'ANO', locationNote: 'ป้อมหน้า', sortOrder: 1, isActive: true, qrVersion: 1, qrPayload: `SMSPATROL1:${'a'.repeat(43)}` },
  { id: 'c2', code: 'ANO-02', name: 'ลานจอดรถด้านหลังอาคาร B', department: 'ANO', locationNote: null, sortOrder: 2, isActive: true, qrVersion: 2, qrPayload: `SMSPATROL1:${'b'.repeat(43)}` },
  { id: 'c3', code: 'WCS-01', name: 'คลังสินค้า', department: 'WCS', locationNote: null, sortOrder: 1, isActive: false, qrVersion: 1, qrPayload: `SMSPATROL1:${'c'.repeat(43)}` }
];

async function signIn(page: Page, role: 'ADMIN' | 'VIEWER') {
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, total: 0, pageSize: 20, totalPages: 1 } }) }));
  await page.route('**/api/v1/patrol/report?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: report() }) }));
  await page.route('**/api/v1/patrol/checkpoints**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: checkpoints }) }));
  await page.route('**/api/v1/patrol/scans/mine**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 's1', checkpointId: 'c1', checkpointCode: 'ANO-01', checkpointName: 'ประตูทางเข้าหลัก', checkpointDepartment: 'ANO', employeeId: 'e1', scannedAt: `${today}T02:15:00.000Z`, workDate: today, photoUrl: '/api/v1/patrol/scans/s1/photo' }] }) }));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-access-token', user: { id: 'u1', email: 'x@example.test', displayName: `${role} Fixture`, role, employeeId: 'e1' } }) }));
  await page.route('**/api/v1/auth/passkeys/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.goto('/app');
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
  test(`patrol center board, checkpoints and reports render at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, 'ADMIN');
    await page.goto('/app/patrol/center');
    const center = page.locator('.patrol-center');
    await expect(center.getByRole('heading', { name: 'ศูนย์ตรวจจุด' })).toBeVisible();
    await expect(center.locator('.patrol-board tbody tr').filter({ has: page.locator('.patrol-cell') })).toHaveCount(3);
    await expect(center.locator('.patrol-cell--done').first()).toBeVisible();
    await expect(center.locator('.patrol-kpi').nth(3)).toContainText('57%');
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-board-${viewport.width}.png`, fullPage: true });

    await center.getByRole('tab', { name: 'จุดตรวจและ QR' }).click();
    await expect(center.locator('.patrol-cp-list li')).toHaveCount(3);
    await center.getByRole('button', { name: 'ออก QR ใหม่' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('ป้าย QR เดิมจะใช้ไม่ได้ทันที');
    await page.getByRole('button', { name: 'ยกเลิก' }).last().click();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-checkpoints-${viewport.width}.png`, fullPage: true });

    await center.getByRole('tab', { name: 'พิมพ์รายงาน' }).click();
    await expect(center.locator('.patrol-report-card')).toHaveCount(3);
    await expect(center.locator('.patrol-report-card--department button')).toBeDisabled();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-reports-${viewport.width}.png`, fullPage: true });
  });

  test(`patrol scan page is usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, 'VIEWER');
    await page.goto('/app/patrol');
    const scan = page.locator('.patrol-scan-page');
    await expect(scan.getByRole('heading', { name: 'สแกนจุดตรวจ' })).toBeVisible();
    await expect(scan.getByRole('button', { name: /เริ่มสแกน QR/ })).toBeVisible();
    await expect(scan.locator('.patrol-history li')).toHaveCount(1);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-scan-${viewport.width}.png`, fullPage: true });
  });
}
