const { test, expect } = require('../helpers/uat-test');
const { assertNoHorizontalOverflow, captureScreenshot, startPageMonitor } = require('../helpers/uat-observe');
const {
  assertResponsiveLayoutMetrics,
  auditFixture,
  buildDocument,
  dashboardWarningVisible,
  dataQualityFixture,
  executiveReportFixture,
  readProjectFile,
  sourceRegressionContracts
} = require('../helpers/regression-contracts');
const { classifyOriginBehavior } = require('../helpers/technical-smoke');

const dataQualityStyles = [
  readProjectFile('frontend/src/styles/data-quality.css'),
  readProjectFile('frontend/src/styles/data-quality-responsive.css')
].join('\n');
const auditStyles = [
  readProjectFile('frontend/src/styles/audit-compliance.css'),
  readProjectFile('frontend/src/styles/audit-mobile.css')
].join('\n');
const executiveReportStyles = readProjectFile('frontend/src/styles/executive-report.css');

const dataQualityViewports = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: false },
  { name: '1024', width: 1024, height: 768, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false }
];
const auditViewports = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false }
];
const executiveReportViewports = [
  { name: '390', width: 390, height: 844, columns: 1 },
  { name: '430', width: 430, height: 932, columns: 1 },
  { name: '768', width: 768, height: 1024, columns: 2 },
  { name: '1024', width: 1024, height: 768, columns: 3 },
  { name: '1440', width: 1440, height: 900, columns: 5 }
];

async function measureLayout(element) {
  return element.evaluate((node) => {
    const row = node.closest('tr, .data-quality-mobile-card, .audit-mobile-card');
    const rowStyle = row ? getComputedStyle(row) : null;
    const style = getComputedStyle(node);
    const page = document.documentElement;
    const wrapper = node.closest('.data-quality-table-scroll, .audit-table-scroll');
    const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
    return {
      buttonWidth: node.getBoundingClientRect().width,
      buttonHeight: node.getBoundingClientRect().height,
      buttonClientWidth: node.clientWidth,
      buttonScrollWidth: node.scrollWidth,
      buttonWhiteSpace: style.whiteSpace,
      rowHeight: row?.getBoundingClientRect().height || 0,
      rowDisplay: rowStyle?.display || '',
      cellDisplay: node.closest('td') ? getComputedStyle(node.closest('td')).display : '',
      beforeContent: node.closest('td') ? getComputedStyle(node.closest('td'), '::before').content : 'none',
      pageOverflow: page.scrollWidth > page.clientWidth + 1,
      wrapperOverflowX: wrapperStyle?.overflowX || ''
    };
  });
}

test('REGRESSION: source contracts cover Data Quality, Audit Log, Dashboard warning, and Executive Report behavior', async ({}, testInfo) => {
  expect(sourceRegressionContracts()).toEqual({ dataQuality: true, audit: true, dashboardWarning: true, executiveReport: true });
  expect(dashboardWarningVisible({ error: undefined, partialErrors: [] })).toBe(false);
  expect(dashboardWarningVisible({ error: undefined, partialErrors: ['licenseOverview'] })).toBe(true);
  expect(dashboardWarningVisible({ error: 'request failed', partialErrors: ['licenseOverview'] })).toBe(false);
  await testInfo.attach('v2-dashboard-summary.json', {
    body: Buffer.from(JSON.stringify({ healthyWarning: 'PASS', partialWarning: 'PASS' })),
    contentType: 'application/json'
  });
});

test('REGRESSION: Executive Report stays readable across management report viewport widths', async ({ page }, testInfo) => {
  const monitor = startPageMonitor(page);
  const summary = {};
  for (const viewport of executiveReportViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setContent(buildDocument(executiveReportStyles, executiveReportFixture()));
    const cards = page.locator('.executive-report-kpis');
    const action = page.getByRole('button', { name: 'ส่งออก PDF', exact: true });
    await expect(cards).toBeVisible();
    await expect(action).toBeVisible();
    const metrics = await action.evaluate((node) => {
      const pageRoot = document.documentElement;
      const card = document.querySelector('.executive-report-kpi');
      return { buttonWidth: node.getBoundingClientRect().width, buttonHeight: node.getBoundingClientRect().height, whiteSpace: getComputedStyle(node).whiteSpace, cardWidth: card?.getBoundingClientRect().width || 0, pageOverflow: pageRoot.scrollWidth > pageRoot.clientWidth + 1 };
    });
    expect(metrics.buttonWidth).toBeGreaterThan(70);
    expect(metrics.buttonHeight).toBeGreaterThan(25);
    expect(metrics.whiteSpace).toBe('nowrap');
    expect(metrics.cardWidth).toBeGreaterThan(0);
    expect(metrics.pageOverflow).toBe(false);
    await assertNoHorizontalOverflow(page);
    summary[viewport.name] = 'PASS';
    await captureScreenshot(page, testInfo, `executive-report-${viewport.name}`);
  }
  await testInfo.attach('executive-report-layout-summary.json', { body: Buffer.from(JSON.stringify(summary)), contentType: 'application/json' });
  monitor.assertClean();
});

test('REGRESSION: Data Quality responsive layout remains bounded across incident widths', async ({ page }, testInfo) => {
  const monitor = startPageMonitor(page);
  const summary = {};
  for (const viewport of dataQualityViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setContent(buildDocument(dataQualityStyles, dataQualityFixture()));
    const desktop = page.locator('.data-quality-desktop-table');
    const mobile = page.locator('.data-quality-mobile-cards');
    if (viewport.mobile) {
      await expect(mobile).toBeVisible();
      await expect(desktop).toBeHidden();
    } else {
      await expect(desktop).toBeVisible();
      await expect(mobile).toBeHidden();
      await expect(desktop.locator('table')).toBeVisible();
    }

    const active = viewport.mobile ? mobile : desktop;
    const action = active.getByRole('button', { name: 'เปิดโควต้าวันลา', exact: true });
    await expect(action).toBeVisible();
    const metrics = await measureLayout(action);
    assertResponsiveLayoutMetrics({
      renderer: viewport.mobile ? 'mobile' : 'desktop',
      desktopVisible: await desktop.isVisible(),
      mobileVisible: await mobile.isVisible(),
      minimumButtonWidth: viewport.mobile ? 120 : 140,
      ...metrics
    });
    expect(metrics.buttonWhiteSpace).toBe('nowrap');
    if (!viewport.mobile) {
      expect(metrics.rowDisplay).toBe('table-row');
      expect(metrics.cellDisplay).toBe('table-cell');
      expect(metrics.wrapperOverflowX).toMatch(/auto|scroll/);
    }
    await assertNoHorizontalOverflow(page);
    summary[viewport.name] = 'PASS';
    await captureScreenshot(page, testInfo, `uat-v2-data-quality-${viewport.name}`);
  }
  await testInfo.attach('v2-data-quality-summary.json', {
    body: Buffer.from(JSON.stringify(summary)),
    contentType: 'application/json'
  });
  monitor.assertClean();
});

test('REGRESSION: Audit Log keeps mobile cards and desktop table semantics separate', async ({ page }, testInfo) => {
  const monitor = startPageMonitor(page);
  const summary = {};
  for (const viewport of auditViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setContent(buildDocument(auditStyles, auditFixture()));
    const desktop = page.locator('.audit-desktop-table');
    const mobile = page.locator('.audit-mobile-cards');
    if (viewport.mobile) {
      await expect(mobile).toBeVisible();
      await expect(desktop).toBeHidden();
    } else {
      await expect(desktop).toBeVisible();
      await expect(mobile).toBeHidden();
      const table = desktop.locator('table');
      await expect(table.locator('thead')).toBeVisible();
      const row = table.locator('tbody tr').first();
      await expect(row).toBeVisible();
      expect(await row.locator('td').allTextContents()).not.toContain('ผู้ดำเนินการ');
    }

    const active = viewport.mobile ? mobile : desktop;
    const detailButton = active.getByRole('button', { name: 'ดูรายละเอียด', exact: true });
    await expect(detailButton).toBeVisible();
    const metrics = await measureLayout(detailButton);
    assertResponsiveLayoutMetrics({
      renderer: viewport.mobile ? 'mobile' : 'desktop',
      desktopVisible: await desktop.isVisible(),
      mobileVisible: await mobile.isVisible(),
      minimumButtonWidth: 80,
      ...metrics
    });
    expect(metrics.buttonHeight).toBeLessThanOrEqual(60);
    if (viewport.mobile) expect(metrics.buttonWhiteSpace).toBe('nowrap');
    if (!viewport.mobile) {
      expect(metrics.rowDisplay).toBe('table-row');
      expect(metrics.cellDisplay).toBe('table-cell');
      expect(metrics.beforeContent).toBe('none');
      expect(metrics.wrapperOverflowX).toMatch(/auto|scroll/);
    }
    await assertNoHorizontalOverflow(page);
    summary[viewport.name] = 'PASS';
    await captureScreenshot(page, testInfo, `uat-v2-audit-${viewport.name}`);
  }
  await testInfo.attach('v2-audit-summary.json', {
    body: Buffer.from(JSON.stringify(summary)),
    contentType: 'application/json'
  });
  monitor.assertClean();
});

test('REGRESSION: origin classification distinguishes canonical compatibility from CORS restriction', async () => {
  expect(classifyOriginBehavior({
    targetUrl: 'https://sms-v3-staging-ten.vercel.app',
    status: 401,
    body: 'Unauthorized'
  })).toBe('CANONICAL_COMPATIBLE');
  expect(classifyOriginBehavior({
    targetUrl: 'https://sms-v3-staging-candidate.vercel.app',
    status: 403,
    body: 'Origin not allowed'
  })).toBe('CORS_ORIGIN_RESTRICTED');
  expect(classifyOriginBehavior({
    targetUrl: 'https://sms-v3-staging-candidate.vercel.app',
    status: 500,
    body: 'Internal Server Error'
  })).toBe('UNKNOWN');
});
