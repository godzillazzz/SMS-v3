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

function scansToday() {
  const at = (hour: number, minute = 10) => new Date(Date.parse(`${today}T00:00:00.000Z`) + (hour - 7) * 3_600_000 + minute * 60_000).toISOString();
  return [
    { id: 's1', checkpointId: 'c1', checkpointCode: 'ANO-01', checkpointName: 'ประตูทางเข้าหลัก', checkpointDepartment: 'ANO', employeeId: 'e1', employeeName: 'สมชาย ใจดี', scannedAt: at(7, 12), workDate: today, photoUrl: '/api/v1/patrol/scans/s1/photo' },
    { id: 's2', checkpointId: 'c2', checkpointCode: 'ANO-02', checkpointName: 'ลานจอดรถด้านหลังอาคาร B', checkpointDepartment: 'ANO', employeeId: 'e1', employeeName: 'สมชาย ใจดี', scannedAt: at(7, 40), workDate: today, photoUrl: '/api/v1/patrol/scans/s2/photo' },
    { id: 's3', checkpointId: 'c1', checkpointCode: 'ANO-01', checkpointName: 'ประตูทางเข้าหลัก', checkpointDepartment: 'ANO', employeeId: 'e1', employeeName: 'สมหญิง รักงาน', scannedAt: at(10, 30), workDate: today, photoUrl: '/api/v1/patrol/scans/s3/photo' }
  ];
}

async function signIn(page: Page, role: 'ADMIN' | 'VIEWER') {
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, total: 0, pageSize: 20, totalPages: 1 } }) }));
  await page.route('**/api/v1/patrol/report?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...report(), patrolScans: scansToday(), scans: scansToday() } }) }));
  await page.route('**/api/v1/patrol/progress**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { patrolDay: today, round: 2, rounds: 8, roundLabel: '10:00–13:00', roundStart: new Date(Date.now() - 3_600_000).toISOString(), roundEnd: new Date(Date.now() + 5_400_000).toISOString(), department: 'ANO', departments: ['ANO', 'WCS'], checkpoints: [{ id: 'c1', code: 'ANO-01', name: 'ประตูทางเข้าหลัก', locationNote: null, doneThisRound: true, lastScanAt: new Date().toISOString(), scannedByMe: true }, { id: 'c2', code: 'ANO-02', name: 'ลานจอดรถด้านหลังอาคาร B', locationNote: null, doneThisRound: false, lastScanAt: null, scannedByMe: false }] } }) }));
  await page.route('**/api/v1/personnel-masters**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { departments: [{ name: 'ANO' }, { name: 'WCS' }, { name: 'AN5' }], positions: [] } }) }));
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
  test(`patrol center department list, department rounds and checkpoint management at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, 'ADMIN');
    await page.goto('/app/patrol/center');
    const center = page.locator('.patrol-center');
    await expect(center.getByRole('heading', { name: 'ศูนย์ตรวจจุด' })).toBeVisible();
    await expect(center.getByRole('heading', { name: 'สถานะการตรวจรายจุดปฏิบัติงาน' })).toBeVisible();
    // WCS-01 is inactive in the fixture, so only ANO has active checkpoints to track.
    await expect(center.locator('.patrol-dept-table tbody tr')).toHaveCount(1);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-v2-list-${viewport.width}.png`, fullPage: true });

    await center.getByRole('button', { name: 'ANO', exact: true }).click();
    await expect(center.getByRole('heading', { name: 'จุดปฏิบัติงาน ANO' })).toBeVisible();
    const rounds = viewport.width > 640 ? center.locator('.patrol-round-desktop') : center.locator('.patrol-round-mobile');
    await expect(rounds).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-v2-dept-${viewport.width}.png`, fullPage: true });
    await center.getByRole('button', { name: /ทุกจุดปฏิบัติงาน/ }).first().click();

    await center.getByRole('tab', { name: 'จุดตรวจและ QR' }).click();
    const head = center.locator('.patrol-master-head__actions').first();
    const boxes = await head.locator('> button').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(4);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-v2-cp-list-${viewport.width}.png`, fullPage: true });
    await center.getByRole('button', { name: 'ANO', exact: true }).click();
    await expect(center.getByRole('heading', { name: 'จุดตรวจของจุดปฏิบัติงาน ANO' })).toBeVisible();
    await center.getByRole('button', { name: 'เพิ่มจุดตรวจ' }).click();
    await expect(page.getByRole('dialog')).toContainText('เพิ่มจุดตรวจในจุดปฏิบัติงาน ANO');
    await page.screenshot({ path: `test-results/patrol-v2-cp-dialog-${viewport.width}.png` });
    await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก' }).click();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-v2-cp-dept-${viewport.width}.png`, fullPage: true });
  });

  test(`patrol scan page shows the current round at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, 'VIEWER');
    await page.goto('/app/patrol');
    const scan = page.locator('.patrol-scan-page');
    await expect(scan.getByRole('heading', { name: 'สแกนจุดตรวจ' })).toBeVisible();
    await expect(scan.locator('.patrol-round-card')).toContainText('รอบที่ 2/8');
    await expect(scan.locator('.patrol-round-card__list li')).toHaveCount(2);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/patrol-v2-scan-${viewport.width}.png`, fullPage: true });
  });
}
