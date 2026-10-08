import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function openEditor(page: Page, role: 'ADMIN' | 'MANAGER', license: 'VALID' | 'MISSING' | 'EXPIRED') {
  const writes: string[] = [];
  const employee = { id: 'fixture-employee', employeeCode: 'UAT001', displayName: 'Sermpong UAT', department: 'AN1', isActive: true, shifts: [] };
  const types = ['D', 'N', 'OFF', 'AL'].map(code => ({ id: code, code, name: code === 'D' ? 'Day Shift' : code, isActive: true, startTime: '08:00', endTime: '16:00' }));
  const licensesRead = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/licenses');
  await page.route('**/api/v1/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && pathname !== '/api/v1/auth/refresh') writes.push(`${request.method()} ${pathname}`);
    let body: unknown = { data: [], summary: {}, meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } };
    if (pathname === '/api/v1/auth/refresh') body = { accessToken: 'fixture-token', user: { id: 'fixture-user', role, displayName: role, email: 'fixture@example.test' } };
    if (pathname === '/api/v1/auth/passkeys/config') body = { enabled: false };
    if (pathname === '/api/v1/employees') body = { data: [employee], meta: { total: 1 } };
    if (pathname === '/api/v1/shift-types') body = { data: types };
    if (pathname === '/api/v1/licenses') body = { data: license === 'MISSING' ? [] : [{ employeeId: employee.id, status: 'ACTIVE', issueDate: '2025-01-01', expiryDate: license === 'VALID' ? '2027-12-31' : '2025-12-31' }] };
    if (pathname === '/api/v1/schedule-calendar') body = { data: { month: '2026-11', dates: ['2026-11-11'], employees: [employee], approval: { status: 'APPROVED', revision: 2 } }, meta: { total: 1, page: 1, pageSize: 20, totalPages: 1 } };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/app/roster?month=2026-11');
  await licensesRead;
  await expect(page.locator('.schedule-grid')).toBeVisible();
  await page.locator('.schedule-grid .empty-shift').click();
  const dialog = page.getByRole('dialog', { name: /เพิ่มกะ: Sermpong UAT/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('กะ', { exact: true }).locator('option')).toHaveCount(4);
  await dialog.getByLabel('กะ', { exact: true }).selectOption('D');
  return { dialog, writes };
}

async function contrastEvidence(page: Page, testInfo: TestInfo) {
  const evidence = await page.locator('.shift-editor-modal__dialog').evaluate(dialog => {
    const luminance = (rgb: number[]) => {
      const c = rgb.map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
      return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
    };
    const parse = (s: string) => s.match(/[\d.]+/g)!.map(Number);
    return Array.from(dialog.querySelectorAll<HTMLElement>('h3,label,strong,p,small,select,input[type="text"],textarea,button')).map(element => {
      const fg = getComputedStyle(element).color;
      let ancestor: Element | null = element;
      let bg = 'rgb(255, 255, 255)';
      while (ancestor) {
        const color = getComputedStyle(ancestor).backgroundColor;
        const values = parse(color);
        if (values.length === 3 || values[3] === 1) { bg = color; break; }
        ancestor = ancestor.parentElement;
      }
      const values = [luminance(parse(fg).slice(0, 3)), luminance(parse(bg).slice(0, 3))].sort((a, b) => b - a);
      return { text: element.textContent?.trim().slice(0, 70), tag: element.tagName, foreground: fg, background: bg, contrast: (values[0] + .05) / (values[1] + .05) };
    });
  });
  await testInfo.attach('computed-style-contrast', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  for (const sample of evidence) expect(sample.contrast, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
    test(`Shift editor ${theme} ${viewport.width}: override validation, keyboard, contrast and draft-only submit`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.setViewportSize(viewport);
      await page.addInitScript(value => localStorage.setItem('sms-v3-theme', value), theme);
      const { dialog, writes } = await openEditor(page, 'ADMIN', 'MISSING');
      await expect(dialog.locator('h3')).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`shift-editor-initial-${theme}-${viewport.width}.png`) });
      const submit = dialog.getByRole('button', { name: 'เก็บรายการนี้ (ยังไม่บันทึก)' });
      await expect(dialog.getByLabel('กะ', { exact: true })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(submit).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByLabel('กะ', { exact: true })).toBeFocused();
      await submit.click();
      await expect(dialog.getByRole('alert')).toContainText('กรุณายืนยัน Override');
      const checkbox = dialog.getByRole('checkbox');
      await checkbox.focus();
      await page.keyboard.press('Space');
      await expect(checkbox).toBeChecked();
      const reason = dialog.getByLabel('เหตุผล Override (จำเป็น)');
      await reason.fill('1234');
      await submit.click();
      await expect(dialog.getByRole('alert')).toContainText('อย่างน้อย 5 ตัวอักษร');
      await reason.fill('เหตุผลทดสอบ');
      await contrastEvidence(page, testInfo);
      await reason.focus();
      expect(await reason.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
      expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`shift-editor-${theme}-${viewport.width}.png`), fullPage: false });
      await submit.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.calendar-shift b')).toHaveText('D *');
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
      await page.locator('.calendar-shift').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.calendar-shift')).toBeFocused();
    });
  }
  for (const license of ['VALID', 'EXPIRED'] as const) {
    test(`Shift editor ${theme} ${license}: existing license rules`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('sms-v3-theme', value), theme);
      const { dialog, writes } = await openEditor(page, 'ADMIN', license);
      if (license === 'VALID') {
        await expect(dialog.getByRole('checkbox')).toHaveCount(0);
        await dialog.getByRole('button', { name: 'เก็บรายการนี้ (ยังไม่บันทึก)' }).click();
        await expect(dialog).toHaveCount(0);
      } else {
        await expect(dialog).toContainText('ใบอนุญาตหมดอายุแล้ว');
        await dialog.getByLabel('กะ', { exact: true }).selectOption('OFF');
        await expect(dialog.getByRole('checkbox')).toHaveCount(0);
        await dialog.getByRole('button', { name: 'เก็บรายการนี้ (ยังไม่บันทึก)' }).click();
        await expect(dialog).toHaveCount(0);
      }
      expect(writes).toEqual([]);
    });
  }
  test(`Shift editor ${theme}: non-Admin cannot override invalid license`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('sms-v3-theme', value), theme);
    const { dialog, writes } = await openEditor(page, 'MANAGER', 'MISSING');
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'เก็บรายการนี้ (ยังไม่บันทึก)' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByLabel('กะ', { exact: true }).selectOption('AL');
    await dialog.getByRole('button', { name: 'เก็บรายการนี้ (ยังไม่บันทึก)' }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}
