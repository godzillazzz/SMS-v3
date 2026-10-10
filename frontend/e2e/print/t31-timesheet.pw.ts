import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';

async function printFromFixture(page: Page, selector: string) {
  await page.goto('/e2e/print/fixture.html');
  await page.locator(selector).click();
  const frame = page.locator('iframe.schedule-print-frame');
  await expect(frame).toBeAttached();
  await expect.poll(() => frame.evaluate((element) => {
    const child = (element as HTMLIFrameElement).contentDocument;
    return child?.head.querySelector('[data-print-document-isolation]') !== null;
  })).toBe(true);
  return frame.evaluate((element) => (element as HTMLIFrameElement).contentDocument!.documentElement.outerHTML);
}

async function renderPdf(html: string, context: BrowserContext, testInfo: TestInfo, name: string) {
  const pdfPage = await context.newPage();
  await pdfPage.setContent(`<!doctype html>${html}`, { waitUntil: 'load' });
  await pdfPage.emulateMedia({ media: 'print' });
  const bytes = await pdfPage.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  await fs.writeFile(testInfo.outputPath(name.replace('.png', '.pdf')), bytes);
  return { pdf: await PDFDocument.load(bytes), page: pdfPage };
}

function expectPortraitA4(pdf: PDFDocument) {
  const size = pdf.getPage(0).getSize();
  expect(size.width).toBeLessThan(size.height);
  expect(size.width).toBeCloseTo(595.28, 0);
  expect(size.height).toBeCloseTo(841.89, 0);
}

test('T31 31-day employee timesheet prints on one isolated A4 portrait page at 7.5pt minimum', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const html = await printFromFixture(page, '#trigger-t31-one');
  const { pdf, page: pdfPage } = await renderPdf(html, page.context(), testInfo, 't31-one-page.png');
  expect(pdf.getPageCount()).toBe(1);
  expectPortraitA4(pdf);

  const frameText = await page.locator('iframe.schedule-print-frame').evaluate((element) => (element as HTMLIFrameElement).contentDocument!.body.innerText);
  expect(frameText).toContain('FIXTURE-001');
  expect(frameText).toContain('01/08/2569');
  expect(frameText).toContain('31/08/2569');
  expect(frameText).not.toContain('Dashboard');
  expect(frameText).not.toContain('Topbar');
  const metrics = await pdfPage.locator('.attendance-timesheet-page').evaluate((node) => {
    const pageNode = node as HTMLElement;
    const table = pageNode.querySelector('table')!;
    const signature = pageNode.querySelector('.attendance-report-signatures')!;
    const img = pageNode.querySelector('img') as HTMLImageElement;
    return {
      rows: table.tBodies[0].rows.length,
      columns: table.tHead!.rows[0].cells.length,
      minCellFontSizePx: Math.min(...Array.from(table.querySelectorAll('th, td'), (cell) => parseFloat(getComputedStyle(cell).fontSize))),
      tableWidth: table.getBoundingClientRect().width,
      pageWidth: pageNode.getBoundingClientRect().width,
      pageBottom: pageNode.getBoundingClientRect().top + pageNode.getBoundingClientRect().height,
      signatureBottom: signature.getBoundingClientRect().bottom,
      logoLoaded: img.complete && img.naturalWidth > 0
    };
  });
  expect(metrics.rows).toBe(31);
  expect(metrics.columns).toBe(5);
  expect(metrics.minCellFontSizePx).toBeGreaterThanOrEqual(7.5 * 96 / 72);
  expect(metrics.tableWidth).toBeLessThanOrEqual(metrics.pageWidth + 1);
  expect(metrics.signatureBottom).toBeLessThanOrEqual(metrics.pageBottom + 1);
  expect(metrics.logoLoaded).toBe(true);
});

test('T31 department print creates exactly one portrait page per employee', async ({ page }, testInfo) => {
  const html = await printFromFixture(page, '#trigger-t31-all');
  const { pdf, page: pdfPage } = await renderPdf(html, page.context(), testInfo, 't31-department-pages.png');
  expect(pdf.getPageCount()).toBe(2);
  expectPortraitA4(pdf);
  await expect(pdfPage.locator('.attendance-timesheet-page')).toHaveCount(2);
  await expect(pdfPage.locator('.attendance-timesheet-page').nth(0)).toContainText('FIXTURE-001');
  await expect(pdfPage.locator('.attendance-timesheet-page').nth(1)).toContainText('FIXTURE-002');
});
