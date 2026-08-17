const { test, expect } = require('../helpers/uat-test');
const { bootstrapAsNonDashboard } = require('../helpers/uat-auth');
const { authenticatedRequest } = require('../helpers/uat-authenticated-request');
const { G03_EMPLOYEE_FIELD_LABEL, g03EmployeeSelector, g03EntitlementWordingSnapshot, legacyWarningExpectedFromQuotaPayload, runWithG03MutationGuard } = require('../helpers/uat-g03-readonly');
const { navigateTo, primaryNavigationItem, startPageMonitor } = require('../helpers/uat-observe');

const authenticatedMode = () => String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
const viewerBackgroundAllowance = [{ path: '/api/v1/licenses', method: 'GET', status: 403 }];
const G03_1_BASE_YEAR = 2026;
const G03_1_FUTURE_READ_YEAR = 2027;

async function attachUiSummary(testInfo, summary) {
  await testInfo.attach('g03-ui-summary.json', {
    body: JSON.stringify(summary),
    contentType: 'application/json'
  });
}

function quotaResponseMatches(response, { year, legacy = false } = {}) {
  try {
    const parsed = new URL(response.url());
    if (parsed.pathname !== '/api/v1/leave-quotas' || response.request().method() !== 'GET') return false;
    if (legacy) return parsed.searchParams.get('legacy') === 'true';
    if (year !== undefined) return parsed.searchParams.get('year') === String(year);
    return true;
  } catch {
    return false;
  }
}

function leaveSummaryResponseMatches(response) {
  try {
    return new URL(response.url()).pathname === '/api/v1/leave-summary'
      && response.request().method() === 'GET';
  } catch {
    return false;
  }
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

test('G03 ADMIN: leave quota provisioning read-only contract', async ({ page }, testInfo) => {
  test.skip(!authenticatedMode(), 'G03 read-only contract requires authenticated mode.');
  test.setTimeout(120_000);
  await runWithG03MutationGuard(page, testInfo, async () => {
    const monitor = startPageMonitor(page);
    const { accessToken, authContract } = await bootstrapAsNonDashboard(page, 'ADMIN');
    await testInfo.attach('v31-auth-contract.json', { body: JSON.stringify(authContract), contentType: 'application/json' });

    const quota2026 = await authenticatedRequest(`/api/v1/leave-quotas?page=1&pageSize=100&year=${G03_1_BASE_YEAR}`, { accessToken });
    expect(quota2026.status).toBe(200);
    const quotaPayload = quota2026.payload;
    expect(quotaPayload?.meta?.quotaYear).toBe(G03_1_BASE_YEAR);
    expect(Number(quotaPayload?.meta?.total || 0)).toBeGreaterThan(0);

    await navigateTo(page, 'quota');
    await expect(page.getByRole('heading', { name: `โควตาวันลา พ.ศ. ${G03_1_BASE_YEAR + 543}`, exact: true })).toBeVisible();
    const yearSelector = page.getByLabel('ปีสิทธิ์โควตาวันลา', { exact: true });
    await expect(yearSelector).toBeVisible();
    await expect(yearSelector).toHaveValue(String(G03_1_BASE_YEAR));
    await expect(yearSelector.locator(`option[value=\"${G03_1_BASE_YEAR}\"]`)).toHaveText(`พ.ศ. ${G03_1_BASE_YEAR + 543}`);
    await expect(yearSelector.locator(`option[value=\"${G03_1_FUTURE_READ_YEAR}\"]`)).toHaveText(`พ.ศ. ${G03_1_FUTURE_READ_YEAR + 543}`);

    const quota2027 = await authenticatedRequest(`/api/v1/leave-quotas?page=1&pageSize=100&year=${G03_1_FUTURE_READ_YEAR}`, { accessToken });
    expect(quota2027.status).toBe(200);
    expect(quota2027.payload?.meta?.quotaYear).toBe(G03_1_FUTURE_READ_YEAR);
    expect(Number(quota2027.payload?.meta?.total || 0)).toBe(0);
    expect(Array.isArray(quota2027.payload?.data) ? quota2027.payload.data.length : -1).toBe(0);
    await yearSelector.selectOption(String(G03_1_FUTURE_READ_YEAR));
    await expect(yearSelector).toHaveValue(String(G03_1_FUTURE_READ_YEAR));
    await expect(page.getByRole('heading', { name: `โควตาวันลา พ.ศ. ${G03_1_FUTURE_READ_YEAR + 543}`, exact: true })).toBeVisible();

    await yearSelector.selectOption(String(G03_1_BASE_YEAR));
    await expect(yearSelector).toHaveValue(String(G03_1_BASE_YEAR));
    await expect(page.getByRole('heading', { name: `โควตาวันลา พ.ศ. ${G03_1_BASE_YEAR + 543}`, exact: true })).toBeVisible();

    const legacyRead = await authenticatedRequest('/api/v1/leave-quotas?page=1&pageSize=100&legacy=true', { accessToken });
    expect(legacyRead.status).toBe(200);
    const legacyPayload = legacyRead.payload;
    expect(legacyPayload?.meta?.legacy).toBe(true);
    expect(Number(legacyPayload?.meta?.total || 0)).toBe(3);
    await page.getByRole('button', { name: 'ดูข้อมูลเดิมที่ยังไม่ระบุปี', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'โควตาวันลา ข้อมูลเดิม', exact: true })).toBeVisible();
    await expect(page.getByText('ข้อมูลเดิม — ยังไม่ระบุปี ต้องจัดประเภทก่อนใช้งานรายปี', { exact: true })).toBeVisible();
    await expect(yearSelector).toBeDisabled();

    await page.getByRole('button', { name: 'กลับรายการรายปี', exact: true }).click();
    await expect(yearSelector).toBeEnabled();
    await expect(yearSelector).toHaveValue(String(G03_1_BASE_YEAR));
    await expect(page.getByRole('heading', { name: `โควตาวันลา พ.ศ. ${G03_1_BASE_YEAR + 543}`, exact: true })).toBeVisible();

    const provisionControl = page.getByRole('button', { name: /กำหนดโควตา/, exact: false }).first();
    await expect(provisionControl).toBeVisible();
    await provisionControl.click();

    const dialog = page.getByRole('dialog', { name: `กำหนดโควตาวันลา ปี พ.ศ. ${G03_1_BASE_YEAR + 543}`, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('พนักงาน (รหัส · ชื่อ · หน่วยงาน)', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ลาป่วย', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ลากิจ', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ลาพักร้อน', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('ลาป่วย', { exact: true })).toHaveValue('30');
    await expect(dialog.getByLabel('ลากิจ', { exact: true })).toHaveValue('3');
    await expect(dialog.getByLabel('ลาพักร้อน', { exact: true })).toHaveValue('6');

    const fieldLabels = await dialog.locator('label.field-group > span').allTextContents();
    expect(fieldLabels.some((label) => /(?:^|\s)(?:ปี|year)(?:\s|$)/i.test(label))).toBe(false);

    const employeeSelectorContract = g03EmployeeSelector(dialog);
    await expect(employeeSelectorContract.field).toHaveCount(1);
    await expect(employeeSelectorContract.label).toHaveText(G03_EMPLOYEE_FIELD_LABEL);
    await expect(employeeSelectorContract.control).toHaveCount(1);
    expect(await employeeSelectorContract.control.evaluate((element) => element.tagName)).toBe('SELECT');
    await expect(employeeSelectorContract.control).toBeVisible();
    const employeeSelector = employeeSelectorContract.control;
    const selectorSummary = await employeeSelector.locator('option').evaluateAll((options) => {
      const candidates = options.filter((option) => String(option.value || '').trim());
      const parts = candidates.map((option) => String(option.textContent || '').split(' · ').map((value) => value.trim()));
      const allHavePart = (index) => candidates.length > 0 && parts.every((entry) => Boolean(entry[index]));
      return {
        selectorLoaded: true,
        candidateCount: candidates.length,
        codeRenderingPresent: allHavePart(0),
        nameRenderingPresent: allHavePart(1),
        departmentRenderingPresent: allHavePart(2)
      };
    });
    if (selectorSummary.candidateCount > 0) {
      expect(selectorSummary.codeRenderingPresent).toBe(true);
      expect(selectorSummary.nameRenderingPresent).toBe(true);
      expect(selectorSummary.departmentRenderingPresent).toBe(true);
    }

    const legacyWarningExpected = legacyWarningExpectedFromQuotaPayload(quotaPayload);
    const legacyWarning = dialog.locator('.preview-warning');
    const legacyWarningObserved = await legacyWarning.first().isVisible().catch(() => false);
    expect(legacyWarningObserved).toBe(legacyWarningExpected);

    await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const currentSummary = await authenticatedRequest('/api/v1/leave-summary', { accessToken });
    const explicit2026 = await authenticatedRequest(`/api/v1/leave-summary?year=${G03_1_BASE_YEAR}`, { accessToken });
    expect(currentSummary.status).toBe(200);
    expect(explicit2026.status).toBe(200);
    const currentSummaryPayload = currentSummary.payload;
    const summaryLinked = currentSummaryPayload?.data?.linked === true;
    expect(explicit2026.payload?.data?.linked === true).toBe(summaryLinked);
    let leaveSummaryCoverage;
    if (summaryLinked) {
      expect(currentSummaryPayload?.data?.quotaYear).toBe(G03_1_BASE_YEAR);
      expect(explicit2026.payload?.data?.quotaYear).toBe(G03_1_BASE_YEAR);
      expect(explicit2026.payload?.data?.entitlement).toEqual(currentSummaryPayload?.data?.entitlement);
      expect(explicit2026.payload?.data?.used).toEqual(currentSummaryPayload?.data?.used);
      expect(explicit2026.payload?.data?.remaining).toEqual(currentSummaryPayload?.data?.remaining);
      leaveSummaryCoverage = 'LINKED_2026_RUNTIME';
    } else {
      expect(currentSummaryPayload?.data?.linked).toBe(false);
      expect(explicit2026.payload?.data?.linked).toBe(false);
      expect(currentSummaryPayload?.data?.employeeId).toBeNull();
      expect(explicit2026.payload?.data?.employeeId).toBeNull();
      expect(currentSummaryPayload?.data?.quotaYear).toBeUndefined();
      expect(explicit2026.payload?.data?.quotaYear).toBeUndefined();
      leaveSummaryCoverage = 'UNLINKED_FIXTURE_SAFE_BRANCH';
    }

    await navigateTo(page, 'leave');
    const wording = await g03EntitlementWordingSnapshot(page);
    await expect(wording.surface).toHaveCount(1);
    expect(wording.newWordingPresent).toBe(true);
    expect(wording.oldWordingAbsent).toBe(true);
    await expect(page.getByText(`พ.ศ. ${G03_1_BASE_YEAR + 543}`, { exact: false }).first()).toBeVisible();

    const monitorEvidence = monitor.safeEvidence();
    await testInfo.attach('v32-page-monitor.json', { body: JSON.stringify(monitorEvidence), contentType: 'application/json' });
    monitor.assertClean();
    await attachUiSummary(testInfo, {
      role: 'ADMIN',
      quotaPageLoaded: true,
      provisionControlVisible: true,
      modalOpened: true,
      yearSelectorVisible: true,
      quotaYearDefault: G03_1_BASE_YEAR,
      thaiYearLabelPresent: true,
      futureYearReadOnly: true,
      futureYearRows: Number(quota2027.payload?.meta?.total || 0),
      legacyViewVisible: true,
      legacyRows: Number(legacyPayload?.meta?.total || 0),
      defaultSick: 30,
      defaultPersonal: 3,
      defaultVacation: 6,
      modalYearFieldAbsent: true,
      leaveSummaryLinkedFixture: summaryLinked,
      ...(summaryLinked ? { leaveSummaryCurrentYear: Number(currentSummaryPayload?.data?.quotaYear || 0) } : {}),
      ...(summaryLinked ? { leaveSummaryExplicitYear: Number(explicit2026.payload?.data?.quotaYear || 0) } : {}),
      leaveSummaryYearAware: summaryLinked,
      leaveSummaryParity: true,
      leaveSummaryCoverage,
      newWordingPresent: true,
      oldAnnualWordingAbsent: true,
      ...selectorSummary,
      legacyWarningExpected,
      legacyWarningObserved,
      legacyWarning: legacyWarningExpected ? 'PRESENT' : 'NOT_TRIGGERED_BY_CURRENT_DATA'
    });
  });
});

test('G03 MANAGER: leave quota provisioning control is absent', async ({ page }, testInfo) => {
  test.skip(!authenticatedMode(), 'G03 read-only contract requires authenticated mode.');
  await runWithG03MutationGuard(page, testInfo, async () => {
    const monitor = startPageMonitor(page);
    const { authContract } = await bootstrapAsNonDashboard(page, 'MANAGER');
    await testInfo.attach('v31-auth-contract.json', { body: JSON.stringify(authContract), contentType: 'application/json' });
    await expect(primaryNavigationItem(page, 'quota')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /กำหนดโควตา/, exact: false })).toHaveCount(0);
    await expect(page.getByText('G03_1_MULTI_YEAR_WRITES_ENABLED', { exact: true })).toHaveCount(0);
    const evidence = monitor.safeEvidence();
    await testInfo.attach('v32-page-monitor.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
    monitor.assertClean();
    await attachUiSummary(testInfo, {
      role: 'MANAGER',
      provisionControlVisible: false,
      quotaNavigationVisible: false,
      activationControlVisible: false
    });
  });
});

test('G03 VIEWER: leave quota provisioning control is absent', async ({ page }, testInfo) => {
  test.skip(!authenticatedMode(), 'G03 read-only contract requires authenticated mode.');
  await runWithG03MutationGuard(page, testInfo, async () => {
    const monitor = startPageMonitor(page, { allowedApiResponses: viewerBackgroundAllowance });
    const { authContract } = await bootstrapAsNonDashboard(page, 'VIEWER');
    await testInfo.attach('v31-auth-contract.json', { body: JSON.stringify(authContract), contentType: 'application/json' });
    await expect(primaryNavigationItem(page, 'quota')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /กำหนดโควตา/, exact: false })).toHaveCount(0);
    await expect(page.getByText('G03_1_MULTI_YEAR_WRITES_ENABLED', { exact: true })).toHaveCount(0);
    const evidence = monitor.safeEvidence();
    await testInfo.attach('v32-page-monitor.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
    monitor.assertClean();
    await attachUiSummary(testInfo, {
      role: 'VIEWER',
      provisionControlVisible: false,
      quotaNavigationVisible: false,
      activationControlVisible: false
    });
  });
});
