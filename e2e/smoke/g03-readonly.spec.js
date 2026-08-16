const { test, expect } = require('../helpers/uat-test');
const { bootstrapAsNonDashboard } = require('../helpers/uat-auth');
const { runWithG03MutationGuard } = require('../helpers/uat-g03-readonly');
const { navigateTo, primaryNavigationItem, startPageMonitor } = require('../helpers/uat-observe');

const authenticatedMode = () => String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
const viewerBackgroundAllowance = [{ path: '/api/v1/licenses', method: 'GET', status: 403 }];

async function attachUiSummary(testInfo, summary) {
  await testInfo.attach('g03-ui-summary.json', {
    body: JSON.stringify(summary),
    contentType: 'application/json'
  });
}

function quotaResponseMatches(response) {
  try {
    return new URL(response.url()).pathname === '/api/v1/leave-quotas'
      && response.request().method() === 'GET';
  } catch {
    return false;
  }
}

test('G03 ADMIN: leave quota provisioning read-only contract', async ({ page }, testInfo) => {
  test.skip(!authenticatedMode(), 'G03 read-only contract requires authenticated mode.');
  await runWithG03MutationGuard(page, testInfo, async () => {
    const monitor = startPageMonitor(page);
    const { authContract } = await bootstrapAsNonDashboard(page, 'ADMIN');
    await testInfo.attach('v31-auth-contract.json', { body: JSON.stringify(authContract), contentType: 'application/json' });

    const quotaResponsePromise = page.waitForResponse(quotaResponseMatches, { timeout: 30_000 });
    await navigateTo(page, 'quota');
    const quotaResponse = await quotaResponsePromise;
    expect(quotaResponse.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'โควตาวันลา', exact: true })).toBeVisible();

    const provisionControl = page.getByRole('button', { name: /กำหนดโควตา/, exact: false }).first();
    await expect(provisionControl).toBeVisible();
    await provisionControl.click();

    const dialog = page.getByRole('dialog', { name: 'กำหนดโควตาวันลา', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('พนักงาน (รหัส · ชื่อ · หน่วยงาน)', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ลาป่วย', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ลากิจ', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ลาพักร้อน', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('ลาป่วย', { exact: true })).toHaveValue('30');
    await expect(dialog.getByLabel('ลากิจ', { exact: true })).toHaveValue('6');
    await expect(dialog.getByLabel('ลาพักร้อน', { exact: true })).toHaveValue('10');

    const fieldLabels = await dialog.locator('label.field-group > span').allTextContents();
    expect(fieldLabels.some((label) => /(?:^|\s)(?:ปี|year)(?:\s|$)/i.test(label))).toBe(false);

    const employeeSelector = dialog.getByLabel('พนักงาน (รหัส · ชื่อ · หน่วยงาน)', { exact: true });
    await expect(employeeSelector).toBeVisible();
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

    let unmatchedLegacyCount = 0;
    try {
      const payload = await quotaResponse.json();
      unmatchedLegacyCount = Math.max(0, Number(payload?.meta?.unmatchedLegacyCount || 0));
    } catch {
      unmatchedLegacyCount = 0;
    }
    const legacyWarning = dialog.locator('.preview-warning');
    if (unmatchedLegacyCount > 0) {
      await expect(legacyWarning).toBeVisible();
    } else {
      await expect(legacyWarning).toHaveCount(0);
    }

    await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await navigateTo(page, 'leave');
    await expect(page.getByText('ตามสิทธิ์ที่กำหนด (วัน)', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ตามสิทธิ์ประจำปี (วัน)', { exact: true })).toHaveCount(0);

    const monitorEvidence = monitor.safeEvidence();
    await testInfo.attach('v32-page-monitor.json', { body: JSON.stringify(monitorEvidence), contentType: 'application/json' });
    monitor.assertClean();
    await attachUiSummary(testInfo, {
      role: 'ADMIN',
      quotaPageLoaded: true,
      provisionControlVisible: true,
      modalOpened: true,
      defaultSick: 30,
      defaultPersonal: 6,
      defaultVacation: 10,
      yearFieldAbsent: true,
      newWordingPresent: true,
      oldAnnualWordingAbsent: true,
      ...selectorSummary,
      legacyWarning: unmatchedLegacyCount > 0 ? 'PRESENT' : 'NOT_TRIGGERED_BY_CURRENT_DATA'
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
    const evidence = monitor.safeEvidence();
    await testInfo.attach('v32-page-monitor.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
    monitor.assertClean();
    await attachUiSummary(testInfo, {
      role: 'MANAGER',
      provisionControlVisible: false,
      quotaNavigationVisible: false
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
    const evidence = monitor.safeEvidence();
    await testInfo.attach('v32-page-monitor.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
    monitor.assertClean();
    await attachUiSummary(testInfo, {
      role: 'VIEWER',
      provisionControlVisible: false,
      quotaNavigationVisible: false
    });
  });
});
