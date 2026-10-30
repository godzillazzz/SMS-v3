import { expect, test, type Page } from '@playwright/test';

const employees = [
  { id: '11111111-1111-4111-8111-111111111111', employeeCode: 'EMP001', firstName: 'สมชาย', lastName: 'ใจดี', displayName: 'สมชาย ใจดี', department: 'ANO', isActive: true },
  { id: '22222222-2222-4222-8222-222222222222', employeeCode: 'EMP002', firstName: 'สมหญิง', lastName: 'รักงาน', displayName: 'สมหญิง รักงาน', department: 'WCS', isActive: true }
];

// Synthetic fixture only: department names and figures are invented for the browser contract.
const kpis = [
  { key: 'attendanceRate', label: 'อัตราการมาปฏิบัติงาน', value: 96.4, unit: '%', status: 'success', group: 'operations', numerator: 482, denominator: 500, targetPath: 'attendanceSupervisor' },
  { key: 'absentAssignments', label: 'ขาด / ไม่ได้เช็กอิน', value: 7, unit: 'กะ', status: 'critical', group: 'operations', targetPath: 'attendanceSupervisor' },
  { key: 'patrolCoverage', label: 'ความครบถ้วนการตรวจจุด', value: null, unit: '%', status: 'neutral', group: 'operations', numerator: 0, denominator: 0, targetPath: 'patrolCenter' },
  { key: 'assistOtherSite', label: 'ช่วยปฏิบัติงานต่าง Site', value: 12, unit: 'เช็กอิน', status: 'neutral', group: 'operations', targetPath: 'attendanceSupervisor' },
  { key: 'licenseAttention', label: 'ใบอนุญาตหมดอายุ / ใกล้หมดอายุ 30 วัน', value: 4, unit: 'รายการ', status: 'critical', group: 'action', breakdown: { expired: 1, expiringWithin30Days: 3 }, targetPath: 'licenses' },
  { key: 'pendingLeave', label: 'คำขอลารออนุมัติ', value: 6, unit: 'รายการ', status: 'warning', group: 'action', targetPath: 'leavePending' },
  { key: 'pendingQueue', label: 'รายการรอดำเนินการ', value: 9, unit: 'รายการ', status: 'warning', group: 'action', asOf: 'CURRENT', targetPath: 'approvalCenter' },
  { key: 'criticalDataQuality', label: 'ประเด็นคุณภาพข้อมูลวิกฤต', value: 2, unit: 'รายการ', status: 'critical', group: 'action', targetPath: 'dataQuality' }
];

async function signIn(page: Page, monthPrintRequests: string[], role = 'ADMIN') {
  await page.route('**/api/v1/**', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { page: 1, total: 0, pageSize: 20, totalPages: 1 } }) }));
  const executiveReport = {
    period: { year: 2026, month: 10, startDate: '2026-10-01', endDate: '2026-10-31', label: 'ตุลาคม 2569' },
    scope: { departmentName: 'ทุกหน่วยงาน', allowsDepartmentFilter: true, availableDepartments: ['ANO', 'WCS'] },
    // OWNER policy 2026-10-30: MANAGER/SUPERVISOR receive the all-department KPI like ADMIN; only the ADMIN-only link is removed.
    executiveSummary: kpis.map((item) => role === 'ADMIN' || item.key !== 'criticalDataQuality' ? item : { ...item, targetPath: null }),
    workforce: { totalEmployees: 54, activeEmployees: 52, byDepartment: [{ label: 'ศูนย์ฝึก', count: 20 }, { label: 'พื้นที่เหนือ', count: 18 }, { label: 'พื้นที่คลัง', count: 14 }] }, schedule: { assignmentCount: 500, periodNote: '' },
    patrol: { available: true, expectedRounds: 2400, scannedRounds: 2184, missedRounds: 216, coveragePercent: 91, byDepartment: [{ department: 'ศูนย์ฝึก', checkpoints: 4, expectedRounds: 800, scannedRounds: 753, missedRounds: 47, coveragePercent: 94.1 }, { department: 'พื้นที่เหนือ', checkpoints: 4, expectedRounds: 800, scannedRounds: 710, missedRounds: 90, coveragePercent: 88.7 }, { department: 'พื้นที่คลัง', checkpoints: 4, expectedRounds: 800, scannedRounds: 721, missedRounds: 79, coveragePercent: 90.2 }] },
    leave: { totalRequests: 31, statusCounts: { PENDING: 6, APPROVED: 25 }, byType: [{ label: 'พักร้อน', count: 14 }, { label: 'กิจส่วนตัว', count: 10 }, { label: 'เจ็บป่วย', count: 7 }], overlapRule: 'นับคำขอลาที่มีช่วงวันลาทับซ้อนกับเดือนที่เลือก' },
    license: { expired: 1, expiringWithin30Days: 3, validBeyond30Days: 68, pendingReview: 0, asOfDate: '2026-10-30' },
    dataQuality: { total: 2, critical: 2, warning: 0, info: 0, categories: [] },
    managementAttention: [
      { severity: 'critical', title: 'กะที่ขาด / ไม่มีเช็กอิน', description: 'ตรวจสอบ 7 กะที่สิ้นสุดแล้วแต่ไม่มีเช็กอิน (ไม่รวม OFF และลาที่อนุมัติ)', count: 7, targetPath: 'attendanceSupervisor' },
      { severity: 'warning', title: 'จุดตรวจตกหล่น', description: 'รอบตรวจที่สิ้นสุดแล้วแต่ยังไม่มีการสแกนในช่วงรายงาน', count: 216, targetPath: 'patrolCenter' },
      { severity: 'follow-up', title: 'คำขอลารอพิจารณา', description: 'พบคำขอลาที่ทับซ้อนกับช่วงเวลารายงานและยังรอการพิจารณา', count: 6, targetPath: 'leavePending' }
    ],
    generatedAt: '2026-10-30T03:30:00.000Z'
  };
  await page.route('**/api/v1/executive-report**', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: executiveReport }) }));
  await page.route('**/api/v1/employees?**', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: employees, meta: { page: 1, total: 2, pageSize: 100, totalPages: 1 } }) }));
  await page.route('**/api/v1/attendance/supervisor/month-print?**', (request) => {
    monthPrintRequests.push(request.request().url());
    const url = new URL(request.request().url());
    const selectedDate = url.searchParams.get('selectedDate') || '2026-10-01';
    const id = url.searchParams.get('employeeId');
    const rows = employees.filter((employee) => !id || employee.id === id).map((employee) => ({ id: employee.id, employeeCode: employee.employeeCode, employeeName: employee.displayName, department: employee.department, days: [] }));
    return request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { generatedAt: new Date().toISOString(), monthStart: `${selectedDate.slice(0, 8)}01`, selectedDate, scope: { role: 'ADMIN' }, employees: rows } }) });
  });
  await page.route('**/api/v1/auth/refresh', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accessToken: 'fixture-access-token', user: { id: 'fixture-user', email: 'admin@example.test', displayName: `${role} Fixture`, role, department: role === 'ADMIN' ? null : 'ศูนย์ฝึก' } }) }));
  await page.route('**/api/v1/auth/passkeys/config', (request) => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }));
  await page.addInitScript(() => { window.print = () => { (window as unknown as { __printed?: number }).__printed = ((window as unknown as { __printed?: number }).__printed || 0) + 1; }; });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
  test(`report center export tab fits ${viewport.width}px and prints the chosen employee`, async ({ page }) => {
    const monthPrintRequests: string[] = [];
    await page.setViewportSize(viewport);
    await signIn(page, monthPrintRequests);
    page.on('pageerror', (error) => console.log('PAGEERROR', String(error).slice(0, 300)));
    await page.goto('/app');
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
    await page.goto('/app/reports');
    const exportTab = page.locator('#report-tab-export');
    await expect(exportTab).toBeVisible({ timeout: 10_000 });
    // OWNER redesign: only two tabs remain — ภาพรวม and ส่งออก; the old details tab is gone.
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab')).toHaveText(['ภาพรวม', 'ส่งออก']);
    await expect(page.locator('#report-tab-details')).toHaveCount(0);
    await exportTab.click();
    const panel = page.locator('#report-panel-export');
    // ADMIN sees 5 groups: schedule, personnel, attendance, patrol (owner item 10, 30 Oct 2026), executive.
    await expect(panel.locator('.report-center-export-group')).toHaveCount(5);
    await expect(panel.locator('#export-group-patrol')).toHaveText('การตรวจจุด');
    for (const title of ['รายงานการตรวจจุดประจำวัน', 'รายงานการตรวจจุดรายแผนก', 'รายงานการตรวจจุดทุกแผนก']) await expect(panel.getByRole('heading', { name: title })).toBeVisible();
    for (const title of ['ส่งออกตารางกะ', 'พิมพ์ทะเบียนพนักงาน', 'พิมพ์ทะเบียนใบอนุญาต รปภ.', 'รายงานการลงเวลารายบุคคลของ รปภ.', 'รายงานการลงเวลารายบุคคลทั้งหมด']) {
      await expect(panel.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const cardOverflow = await panel.locator('.report-center-export-card').evaluateAll((cards) => cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length);
    expect(cardOverflow).toBe(0);

    const select = panel.getByLabel('เลือกพนักงานสำหรับพิมพ์รายบุคคล');
    const single = panel.getByRole('button', { name: 'พิมพ์รายบุคคล', exact: true });
    await expect(single).toBeDisabled();
    await expect(select.locator('option')).toHaveCount(3);
    await select.selectOption(employees[1].id);
    await expect(single).toBeEnabled();
    await single.click();
    await expect.poll(() => monthPrintRequests.length).toBe(1);
    expect(new URL(monthPrintRequests[0]).searchParams.get('employeeId')).toBe(employees[1].id);
    await expect(panel.locator('[role="alert"]')).toHaveCount(0);
    await page.screenshot({ path: `test-results/report-center-export-${viewport.width}.png`, fullPage: true });
  });
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
  test(`report center overview shows 8 KPI cards in two groups and fits ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, []);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto('/app');
    await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
    await page.goto('/app/reports');
    const panel = page.locator('#report-panel-executive');
    await expect(panel.locator('.executive-kpi')).toHaveCount(8, { timeout: 10_000 });
    await expect(panel.locator('.executive-kpi-group')).toHaveCount(2);
    for (const group of await panel.locator('.executive-kpi-group').all()) await expect(group.locator('.executive-kpi')).toHaveCount(4);
    await expect(panel.locator('.executive-report-context')).toContainText('พนักงานที่ปฏิบัติงาน 52 คน');
    await expect(panel.locator('[data-kpi="patrolCoverage"] .executive-kpi-value strong')).toHaveText('—');
    await expect(panel.locator('[data-kpi="pendingQueue"]')).toContainText('ณ ปัจจุบัน');
    await expect(panel.getByRole('heading', { name: 'ความครบถ้วนการตรวจจุดรายแผนก' })).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'ประเด็นที่ผู้บริหารควรติดตาม' })).toBeVisible();
    await expect(panel.locator('.executive-report-attention-list article')).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    // Licence card header: the arrow must not overlap the (wrapping) title on any viewport.
    const overlap = await panel.locator('[data-kpi="licenseAttention"]').evaluate((card) => {
      const title = card.querySelector('.executive-kpi-title')!.getBoundingClientRect();
      const arrow = card.querySelector('.executive-kpi-arrow')!.getBoundingClientRect();
      const icon = card.querySelector('.executive-kpi-head > i')!.getBoundingClientRect();
      return title.right > arrow.left + 0.5 || icon.right > title.left + 0.5;
    });
    expect(overlap).toBe(false);
    // Secondary text contrast ≥ 4.5:1 against the card background.
    const ratio = await panel.locator('[data-kpi="attendanceRate"] .executive-kpi-detail').evaluate((node) => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      let element: Element | null = node; let background = 'rgba(0, 0, 0, 0)';
      while (element && /rgba\(0, 0, 0, 0\)|transparent/.test(background)) { background = getComputedStyle(element).backgroundColor; element = element.parentElement; }
      const [a, b] = [lum(rgb(getComputedStyle(node).color)), lum(rgb(background))].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    await panel.locator('[data-kpi="pendingQueue"]').click();
    await expect(page).toHaveURL(/\/app\/approvals/);
    expect(errors).toEqual([]);
  });
}

// OWNER policy 2026-10-30: SUPERVISOR is a cross-department supervisor, so it gets the department filter
// (month, year, department = 3 selects; previously 2) and the full KPI value, but never the ADMIN-only link.
test('SUPERVISOR overview never links the ADMIN-only data-quality page and offers the department filter', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page, [], 'SUPERVISOR');
  await page.goto('/app');
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
  await page.goto('/app/reports');
  const card = page.locator('#report-panel-executive [data-kpi="criticalDataQuality"]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).not.toContainText('ไม่พร้อมใน scope');
  expect(await card.evaluate((node) => node.tagName)).toBe('ARTICLE');
  await expect(page.locator('.report-center-filters select')).toHaveCount(3, { timeout: 5_000 });
  await expect(page.locator('.report-center-filters label', { hasText: 'หน่วยงาน' })).toBeVisible();
});
