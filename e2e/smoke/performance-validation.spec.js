'use strict';

const { test, expect } = require('../helpers/uat-test');
const { bootstrapAsNonDashboard } = require('../helpers/uat-auth');
const {
  createBoundedNetworkObserver,
  containsForbiddenLicenseField
} = require('../helpers/uat-network');
const {
  assertApprovedBenchmarkTargets,
  classifyOverall,
  createBenchmarkSession,
  measureBenchmarkGet,
  runMatchedBenchmarkGroup,
  sanitizePerformanceValidation,
  shouldRunPerformanceValidation
} = require('../helpers/uat-performance');
const {
  navigateTo,
  navigateToReportCenter,
  observeApiResponse,
  reportCenterPage
} = require('../helpers/uat-observe');
const { performAndWaitForHeavyRequest } = require('../helpers/uat-heavy-read-v3');

async function attachPerformance(testInfo, value) {
  const safe = sanitizePerformanceValidation(value);
  await testInfo.attach('performance-validation.json', {
    body: JSON.stringify(safe),
    contentType: 'application/json'
  });
}

function metric(endpoint, filterCategory, count, classification, status) {
  return {
    targetLabel: 'candidate',
    role: 'ADMIN',
    endpoint,
    filterCategory,
    count,
    classification,
    ...(Number.isInteger(status) ? { status } : {})
  };
}

test('V3 ADMIN: License initial-load network contract', async ({ page }, testInfo) => {
  test.skip(!shouldRunPerformanceValidation(), 'Authenticated-only performance validation.');
  test.setTimeout(120_000);
  await bootstrapAsNonDashboard(page, 'ADMIN');

  const observer = createBoundedNetworkObserver(page, {
    trackedPaths: ['/api/v1/licenses/{licenseId}/documents']
  });
  try {
    observer.reset();
    const collectionResponse = await observeApiResponse(page, '/api/v1/licenses', () => navigateTo(page, 'licenses'));
    await expect(page.locator('table.data-table')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.loading-row')).toHaveCount(0, { timeout: 60_000 });

    const payload = await collectionResponse.json().catch(() => undefined);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const internalFieldLeak = containsForbiddenLicenseField(payload);
    const embeddedSummaryContract = rows.length === 0 || rows.every((row) => Object.prototype.hasOwnProperty.call(row, 'documentSummary'));
    const historyRequests = observer.requestCount('/api/v1/licenses/{licenseId}/documents');

    expect(collectionResponse.status()).toBeGreaterThanOrEqual(200);
    expect(collectionResponse.status()).toBeLessThan(300);
    expect(historyRequests, 'Initial License table load must not fan out per-row document history requests.').toBe(0);
    expect(embeddedSummaryContract, 'License collection rows must carry the document summary contract when rows exist.').toBe(true);
    expect(internalFieldLeak, 'License collection response must not expose internal storage/checksum/signed-url fields.').toBe(false);

    await attachPerformance(testInfo, {
      networkContracts: {
        license: [
          metric('/api/v1/licenses', 'initial-collection', undefined, 'PASS', collectionResponse.status()),
          metric('/api/v1/licenses/{licenseId}/documents', 'initial-load', historyRequests, historyRequests === 0 ? 'PASS' : 'FAIL'),
          metric('/api/v1/licenses', 'additional-document-summary', 0, embeddedSummaryContract ? 'PASS' : 'FAIL'),
          metric('license-response-fields', 'initial-collection', internalFieldLeak ? 1 : 0, internalFieldLeak ? 'FAIL' : 'PASS')
        ]
      }
    });
  } finally {
    observer.stop();
  }
});

test('V3 ADMIN: Report Center exact network contract', async ({ page }, testInfo) => {
  test.skip(!shouldRunPerformanceValidation(), 'Authenticated-only performance validation.');
  test.setTimeout(180_000);
  await bootstrapAsNonDashboard(page, 'ADMIN');

  const observer = createBoundedNetworkObserver(page, {
    trackedPaths: ['/api/v1/executive-report', '/api/v1/reports/summary']
  });
  const metrics = [];
  try {
    observer.reset();

    const executiveInitial = await performAndWaitForHeavyRequest(page, '/api/v1/executive-report', () => navigateTo(page, 'reportCenter'));
    const center = reportCenterPage(page);
    await expect(center).toBeVisible();
    await expect(center.locator('.executive-report-kpis')).toBeVisible({ timeout: 60_000 });
    const initialExecutiveCount = observer.count('/api/v1/executive-report');
    expect(initialExecutiveCount).toBe(1);
    metrics.push(metric('/api/v1/executive-report', 'executive-initial', initialExecutiveCount, 'PASS', executiveInitial.status()));

    const detailsTab = center.getByRole('tab', { name: 'รายงานรายละเอียด', exact: true });
    const executiveTab = center.getByRole('tab', { name: 'ภาพรวมผู้บริหาร', exact: true });
    const detailsFirst = await performAndWaitForHeavyRequest(page, '/api/v1/reports/summary', () => detailsTab.click());
    await expect(center.locator('.metrics-grid.report-grid')).toBeVisible({ timeout: 60_000 });
    const firstSummaryCount = observer.count('/api/v1/reports/summary');
    expect(firstSummaryCount).toBe(1);
    metrics.push(metric('/api/v1/reports/summary', 'details-first', firstSummaryCount, 'PASS', detailsFirst.status()));

    await executiveTab.click();
    await expect(executiveTab).toHaveAttribute('aria-selected', 'true');
    await detailsTab.click();
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(500);
    const summaryAfterReentry = observer.count('/api/v1/reports/summary');
    const reentryAdditional = summaryAfterReentry - firstSummaryCount;
    expect(reentryAdditional, 'Details re-entry must not auto-refetch summary.').toBe(0);
    metrics.push(metric('/api/v1/reports/summary', 'details-reentry-additional', reentryAdditional, 'PASS'));

    const monthSelect = center.locator('.report-center-filters select').first();
    const currentMonth = await monthSelect.inputValue();
    const monthOptions = await monthSelect.locator('option').evaluateAll((options) => options.map((option) => option.value));
    const nextMonth = monthOptions.find((value) => value !== currentMonth);
    expect(nextMonth, 'Report Center must expose an alternate supported month filter.').toBeTruthy();
    const executiveBeforeInactiveFilter = observer.count('/api/v1/executive-report');
    await monthSelect.selectOption(nextMonth);
    await page.waitForTimeout(750);
    const hiddenExecutiveAdditional = observer.count('/api/v1/executive-report') - executiveBeforeInactiveFilter;
    expect(hiddenExecutiveAdditional, 'Changing a filter while Details is active must not hidden-fetch Executive.').toBe(0);
    await expect(center.locator('.executive-report-print')).toHaveCount(0);
    metrics.push(metric('/api/v1/executive-report', 'inactive-filter-hidden-additional', hiddenExecutiveAdditional, 'PASS'));
    metrics.push(metric('report-center-export', 'stale-filter', 0, 'PREVENTED'));

    const executiveBeforeReturn = observer.count('/api/v1/executive-report');
    const currentFilterResponse = await performAndWaitForHeavyRequest(page, '/api/v1/executive-report', () => executiveTab.click());
    await expect(center.locator('.executive-report-kpis')).toBeVisible({ timeout: 60_000 });
    await expect(monthSelect).toHaveValue(nextMonth);
    const executiveReturnAdditional = observer.count('/api/v1/executive-report') - executiveBeforeReturn;
    expect(executiveReturnAdditional, 'Returning to Executive after filter change must fetch the current filter exactly once.').toBe(1);
    metrics.push(metric('/api/v1/executive-report', 'current-filter-return-additional', executiveReturnAdditional, 'PASS', currentFilterResponse.status()));

    await detailsTab.click();
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true');
    const summaryBeforeRefresh = observer.count('/api/v1/reports/summary');
    const refreshButton = center.locator('.report-center-section-heading').getByRole('button', { name: /รีเฟรช/ });
    const refreshedSummary = await performAndWaitForHeavyRequest(page, '/api/v1/reports/summary', () => refreshButton.click());
    const summaryRefreshAdditional = observer.count('/api/v1/reports/summary') - summaryBeforeRefresh;
    expect(summaryRefreshAdditional, 'Explicit Details refresh must add exactly one summary request.').toBe(1);
    metrics.push(metric('/api/v1/reports/summary', 'explicit-refresh-additional', summaryRefreshAdditional, 'PASS', refreshedSummary.status()));

    const stableCenter = await navigateToReportCenter(page, 'executive');
    await expect(stableCenter.locator('.executive-report-print-page')).toContainText('รายงานผู้บริหาร');
    const pdfButton = stableCenter.locator('.report-center-quick-export').getByRole('button', { name: 'ส่งออก PDF', exact: true });
    await expect(pdfButton).toBeEnabled({ timeout: 60_000 });
    metrics.push(metric('report-center-pdf', 'first-print-page', 0, 'PASS'));

    await attachPerformance(testInfo, { networkContracts: { reportCenter: metrics } });
  } finally {
    observer.stop();
  }
});

test('V3 PERFORMANCE: matched strictly-sequential canonical versus candidate benchmark', async ({}, testInfo) => {
  test.skip(!shouldRunPerformanceValidation(), 'Authenticated-only performance validation.');
  test.skip(String(process.env.UAT_ENABLE_CANONICAL_BENCHMARK || '').trim().toLowerCase() !== 'true', 'Cross-target benchmark disabled for exact staged-only Auth UAT.');
  test.setTimeout(900_000);

  const targets = assertApprovedBenchmarkTargets(process.env.UAT_BASE_URL);
  const sessions = { canonical: {}, candidate: {} };
  const groups = [];
  try {
    for (const role of ['ADMIN', 'MANAGER']) {
      sessions.canonical[role] = await createBenchmarkSession({ baseURL: targets.canonical, role });
      sessions.candidate[role] = await createBenchmarkSession({ baseURL: targets.candidate, role });
    }

    const measure = async (input) => measureBenchmarkGet({
      ...input,
      session: sessions[input.targetLabel][input.role]
    });

    for (const group of [
      { role: 'ADMIN', endpoint: '/api/v1/dashboard' },
      { role: 'ADMIN', endpoint: '/api/v1/executive-report' },
      { role: 'MANAGER', endpoint: '/api/v1/executive-report' },
      { role: 'ADMIN', endpoint: '/api/v1/reports/summary' },
      { role: 'MANAGER', endpoint: '/api/v1/reports/summary' }
    ]) {
      groups.push(await runMatchedBenchmarkGroup({ ...group, filterCategory: 'default-current-period', sampleCount: 3, measure }));
    }

    const candidateSamples = groups.flatMap((group) => group.samples).filter((sample) => sample.targetLabel === 'candidate');
    const allSamples = groups.flatMap((group) => group.samples);
    expect(candidateSamples.some((sample) => sample.status >= 500), 'Candidate benchmark must have zero 5xx.').toBe(false);
    expect(allSamples.every((sample) => sample.status >= 200 && sample.status < 300), 'Every completed benchmark sample must be a successful read-only response.').toBe(true);
    expect(candidateSamples.every((sample) => Boolean(sample.requestId)), 'Candidate benchmark samples require safe X-Request-Id correlation.').toBe(true);

    const classification = classifyOverall(groups);
    await attachPerformance(testInfo, {
      benchmark: {
        groups,
        classification,
        smallSample: true
      }
    });
  } finally {
    for (const targetLabel of ['canonical', 'candidate']) {
      for (const role of ['ADMIN', 'MANAGER']) {
        if (sessions[targetLabel][role]?.context) await sessions[targetLabel][role].context.dispose();
      }
    }
  }
});
