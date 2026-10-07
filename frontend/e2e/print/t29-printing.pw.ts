import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';

async function openPrintFrame(page: Page, trigger: string): Promise<string> {
  await page.goto('/e2e/print/fixture.html');
  await page.locator(trigger).click();
  const frame = page.locator('iframe.schedule-print-frame');
  await expect(frame).toBeAttached();
  await expect.poll(() => frame.evaluate((element) => {
    const childDocument = (element as HTMLIFrameElement).contentDocument;
    return childDocument?.head.querySelector('[data-print-document-isolation]') !== null;
  })).toBe(true);
  return frame.evaluate((element) => (element as HTMLIFrameElement).contentDocument!.documentElement.outerHTML);
}

async function renderPdf(html: string, context: BrowserContext, testInfo: TestInfo, screenshotName: string, orientation: 'portrait' | 'landscape') {
  const pdfPage = await context.newPage();
  await pdfPage.setContent(`<!doctype html>${html}`, { waitUntil: 'load' });
  await pdfPage.emulateMedia({ media: 'print' });
  const pdf = await pdfPage.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  await pdfPage.setViewportSize(orientation === 'portrait' ? { width: 794, height: 1123 } : { width: 1123, height: 794 });
  await pdfPage.screenshot({ path: testInfo.outputPath(screenshotName), fullPage: false });
  await fs.writeFile(testInfo.outputPath(screenshotName.replace('.png', '.pdf')), pdf);
  return { pdf: await PDFDocument.load(pdf), page: pdfPage };
}

function assertPageOrientation(width: number, height: number, orientation: 'portrait' | 'landscape') {
  const expectedLandscape = orientation === 'landscape';
  expect(width > height).toBe(expectedLandscape);
  expect(Math.min(width, height)).toBeCloseTo(595.28, 0);
  expect(Math.max(width, height)).toBeCloseTo(841.89, 0);
}

test('Leave print is an isolated one-page A4 portrait document with no shell leakage', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const html = await openPrintFrame(page, '#trigger-leave');
  const { pdf, page: pdfPage } = await renderPdf(html, page.context(), testInfo, 'leave-page-1.png', 'portrait');
  expect(pdf.getPageCount()).toBe(1);
  const dimensions = pdf.getPage(0).getSize();
  assertPageOrientation(dimensions.width, dimensions.height, 'portrait');

  const printText = await pdfPage.locator('body').innerText();
  expect(printText).toContain('ใบขออนุมัติลางาน');
  expect(printText).toContain('ผู้ปฏิบัติงานแทน');
  expect(printText).not.toContain('Dashboard');
  expect(printText).not.toContain('Topbar');
  expect(printText).not.toContain('user badge');
  expect(printText).not.toContain('ออกจากระบบ');
  expect(printText).not.toContain('เมนูด้านข้าง');
  expect(printText).not.toContain('เมนูหลัก');
  expect(printText).not.toContain('Quick nav');
  expect(printText).not.toContain('Floating action');
  expect(printText).not.toContain('toast');
  const pageRule = await page.locator('iframe.schedule-print-frame').evaluate((element) => (element as HTMLIFrameElement).contentDocument!.head.querySelector('[data-print-document-isolation]')!.textContent);
  expect(pageRule).toContain('@page { size: A4 portrait; margin: 12mm; }');
});

test('31-day roster print fits the A4 landscape page and preserves repeatable table headers', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const html = await openPrintFrame(page, '#trigger-roster');
  const { pdf, page: pdfPage } = await renderPdf(html, page.context(), testInfo, 'roster-page-1.png', 'landscape');
  const dimensions = pdf.getPage(0).getSize();
  assertPageOrientation(dimensions.width, dimensions.height, 'landscape');

  const metrics = await pdfPage.locator('#roster-table').evaluate((table) => {
    const node = table as HTMLTableElement;
    const dayCells = node.querySelectorAll('thead th:nth-child(n+4):nth-child(-n+34)');
    const widths = Array.from(dayCells, (cell) => parseFloat(getComputedStyle(cell).width));
    const groupRow = node.querySelector('.print-department-group-row')!;
    return {
      columnCount: node.tHead!.rows[0].cells.length,
      dayCount: dayCells.length,
      tableWidth: node.getBoundingClientRect().width,
      scrollWidth: node.scrollWidth,
      dayColumnWidthTotal: widths.reduce((sum, width) => sum + width, 0),
      shiftCodeFontSize: parseFloat(getComputedStyle(node.tBodies[0].rows[1].cells[3]).fontSize),
      groupBreakAfter: getComputedStyle(groupRow).breakAfter,
      groupNextBreakBefore: getComputedStyle(groupRow.nextElementSibling!).breakBefore,
      headerDisplay: getComputedStyle(node.tHead!).display
    };
  });
  expect(metrics.columnCount).toBe(35);
  expect(metrics.dayCount).toBe(31);
  expect(metrics.dayColumnWidthTotal).toBeLessThan(dimensions.width * 96 / 72);
  const declaredRosterWidthMm = 7 + 38 + 22 + (31 * 6) + 15;
  expect(declaredRosterWidthMm).toBeLessThanOrEqual(297 - 20);
  expect(metrics.shiftCodeFontSize + 0.01).toBeGreaterThanOrEqual(7 * 96 / 72);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.tableWidth + 1);
  expect(metrics.headerDisplay).toBe('table-header-group');
  expect(metrics.groupBreakAfter).toMatch(/^avoid(-page)?$/);
  expect(metrics.groupNextBreakBefore).toMatch(/^avoid(-page)?$/);
  const pageRule = await page.locator('iframe.schedule-print-frame').evaluate((element) => (element as HTMLIFrameElement).contentDocument!.head.querySelector('[data-print-document-isolation]')!.textContent);
  expect(pageRule).toContain('@page { size: A4 landscape; margin: 8mm 10mm; }');
});

test('generic table print includes report metadata and repeat-header/row-fragmentation rules', async ({ page }, testInfo) => {
  const html = await openPrintFrame(page, '#trigger-table');
  const { pdf, page: pdfPage } = await renderPdf(html, page.context(), testInfo, 'table-page-1.png', 'landscape');
  const dimensions = pdf.getPage(0).getSize();
  assertPageOrientation(dimensions.width, dimensions.height, 'landscape');

  const report = pdfPage.locator('[data-print-report="table"]');
  await expect(report.locator('h1')).toHaveText('รายงานรายการทดสอบ');
  await expect(report).toContainText('สถานะ: อนุมัติแล้ว');
  await expect(report).toContainText('พิมพ์เมื่อ');
  await expect(report).toContainText('ผู้พิมพ์ ผู้ทดสอบ · ผู้ดูแลระบบ');
  await expect(report.locator('thead tr th')).toHaveCount(8);
  expect(await report.locator('thead').evaluate((node) => getComputedStyle(node).display)).toBe('table-header-group');
  expect(await report.locator('tbody tr').first().evaluate((node) => getComputedStyle(node).breakInside)).toBe('avoid');
  expect(await pdf.getPageCount()).toBeGreaterThan(1);
  const pageRule = await page.locator('iframe.schedule-print-frame').evaluate((element) => (element as HTMLIFrameElement).contentDocument!.head.querySelector('[data-print-document-isolation]')!.textContent);
  expect(pageRule).toContain('@page { size: A4 landscape; margin: 10mm; }');
});

test('print triggers remain usable on desktop and mobile, and executive/attendance pages do not clip', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/e2e/print/fixture.html');
  await expect(page.locator('#trigger-leave')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('#trigger-leave')).toBeVisible();
  await expect(page.locator('#trigger-leave')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  const html = await openPrintFrame(page, '#trigger-reports');
  const { pdf, page: pdfPage } = await renderPdf(html, page.context(), testInfo, 'reports-page-1.png', 'landscape');
  const printLayout = await pdfPage.evaluate(() => {
    const page = document.querySelector('.attendance-report-page')!;
    const table = document.querySelector('.attendance-report-table')!;
    const executive = document.querySelector('.executive-report-print-page')!;
    return {
      reportOverflow: getComputedStyle(page).overflow,
      reportMaxHeight: getComputedStyle(page).maxHeight,
      tableHeaderDisplay: getComputedStyle(table.querySelector('thead')!).display,
      executiveOverflow: getComputedStyle(executive).overflow,
      executiveText: executive.textContent
    };
  });
  expect(printLayout.reportOverflow).toBe('visible');
  expect(printLayout.reportMaxHeight).toBe('none');
  expect(printLayout.tableHeaderDisplay).toBe('table-header-group');
  expect(printLayout.executiveOverflow).toBe('visible');
  expect(printLayout.executiveText).toContain('รายงานผู้บริหาร');
  expect(await pdf.getPageCount()).toBeGreaterThan(1);
});
