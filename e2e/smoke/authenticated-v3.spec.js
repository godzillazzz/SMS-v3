const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { authenticatedRequest } = require('../helpers/uat-authenticated-request');
const { assertNoHorizontalOverflow, captureScreenshot, expectPrimaryNavigationItem, navigateTo, navigateToReportCenter, observeApiResponse, openPrimaryNavigation, primaryNavigationItem, primaryNavigationItemByLabel, reportCenterPage, startPageMonitor } = require('../helpers/uat-observe');
const { getRoleApiMatrix, getRoleNavigationContract, getRolePageChecks } = require('../helpers/uat-v3-role-matrix');
const { createStageTracker } = require('../helpers/uat-stage');

const authenticatedMode = () => String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
const uatScope = () => String(process.env.UAT_SCOPE || 'full').trim().toLowerCase();
const diagnosticScope = () => uatScope() === 'report-center-diagnostic';
const scopeAllows = (role, area) => {
  if (!diagnosticScope()) return true;
  return ['ADMIN', 'MANAGER'].includes(role) && ['login', 'navigation', 'dashboard', 'reportCenter'].includes(area);
};

async function firstEmployee(accessToken) {
  const path = '/api/v1/employees?page=1&pageSize=1';
  const response = await authenticatedRequest(path, { accessToken });
  expect(response.status, 'Employee read must succeed before lifecycle acceptance.').toBe(200);
  const payload = response.payload;
  expect(payload?.data?.length, 'Lifecycle acceptance requires one existing employee for read-only verification.').toBeGreaterThan(0);
  return payload.data[0];
}

async function expectNavigation(page, role) {
  await openPrimaryNavigation(page);
  const contract = getRoleNavigationContract(role);
  for (const item of contract.required) {
    await expectPrimaryNavigationItem(page, item.id);
  }
  for (const item of contract.forbidden) {
    await expect(primaryNavigationItem(page, item.id), `${role} navigation must hide ${item.label}.`).toHaveCount(0);
  }
  await expect(primaryNavigationItemByLabel(page, 'รายงานและวิเคราะห์')).toHaveCount(role === 'VIEWER' ? 0 : 1);
  await expect(primaryNavigationItemByLabel(page, 'รายงานผู้บริหาร')).toHaveCount(0);
  await expect(primaryNavigationItemByLabel(page, 'รายงานและ Export')).toHaveCount(0);
}

async function expectUnifiedReportCenter(page, role, testInfo, monitor) {
  const tracker = createStageTracker({ role, testCode: 'REPORT_CENTER', testInfo });
  try {
    const executiveResponse = await tracker.run(
      'RC03_EXEC_REQUEST',
      () => observeApiResponse(page, '/api/v1/executive-report', () => navigateTo(page, 'reportCenter')),
      { safeApiPath: '/api/v1/executive-report' }
    );
    const center = reportCenterPage(page);
    await tracker.run(
      'RC02_SHELL',
      async () => {
        await expect(center).toBeVisible();
        await expect(center.getByRole('heading', { name: 'รายงานและวิเคราะห์', exact: true })).toBeVisible();
        await expect(center.getByRole('tab', { name: 'ภาพรวมผู้บริหาร', exact: true })).toHaveAttribute('aria-selected', 'true');
      },
      { safeApiPath: '/api/v1/executive-report', safeStatus: executiveResponse.status(), safeErrorCode: 'UAT_UI_EXECUTIVE_RENDER_FAILED' }
    );
    await tracker.run(
      'RC04_EXEC_KPIS',
      async () => {
        await expect(center.locator('section.executive-report-page[aria-label="รายงานผู้บริหาร"]')).toBeVisible({ timeout: 60_000 });
        await expect(center.locator('.executive-report-kpis')).toBeVisible({ timeout: 60_000 });
        await expect(center.locator('.executive-report-print')).toHaveCount(1, { timeout: 60_000 });
      },
      { safeApiPath: '/api/v1/executive-report', safeStatus: executiveResponse.status(), safeErrorCode: 'UAT_UI_EXECUTIVE_RENDER_FAILED' }
    );
    await tracker.run(
      'RC05_FILTERS',
      async () => {
        await expect(center.locator('.report-center-filters select')).toHaveCount(role === 'ADMIN' ? 3 : 2);
      },
      { safeApiPath: '/api/v1/executive-report', safeStatus: executiveResponse.status(), safeErrorCode: 'UAT_UI_EXECUTIVE_FILTERS_FAILED' }
    );
    const filterValues = await center.locator('.report-center-filters select').evaluateAll((selects) => selects.map((select) => select.value));
    const detailsResponse = await tracker.run(
      'RC07_DETAILS_RESPONSE',
      () => observeApiResponse(
        page,
        '/api/v1/reports/summary',
        () => center.getByRole('tab', { name: 'รายงานรายละเอียด', exact: true }).click()
      ),
      { safeApiPath: '/api/v1/reports/summary' }
    );
    await tracker.run(
      'RC08_DETAILS_RENDER',
      async () => {
        await expect(center.getByRole('heading', { name: 'รายงานรายละเอียด', exact: true })).toBeVisible();
        const detailFilterValues = await center.locator('.report-center-filters select').evaluateAll((selects) => selects.map((select) => select.value));
        expect(detailFilterValues).toEqual(filterValues);
        await expect(center.locator('.metrics-grid.report-grid')).toBeVisible({ timeout: 60_000 });
      },
      { safeApiPath: '/api/v1/reports/summary', safeStatus: detailsResponse.status(), safeErrorCode: 'UAT_UI_REPORT_SUMMARY_RENDER_FAILED' }
    );
    await tracker.run(
      'RC09_EXPORT_TAB',
      () => center.getByRole('tab', { name: 'Export', exact: true }).click(),
      { safeApiPath: '/api/v1/reports/summary', safeStatus: detailsResponse.status() }
    );
    await tracker.run(
      'RC10_EXPORT_CONTROL',
      async () => {
        await expect(center.getByRole('heading', { name: 'Export', exact: true })).toBeVisible();
        await expect(center.getByRole('button', { name: 'ส่งออก PDF', exact: true })).toBeVisible();
      },
      { safeApiPath: '/api/v1/reports/summary', safeStatus: detailsResponse.status(), safeErrorCode: 'UAT_UI_EXPORT_RENDER_FAILED' }
    );
    const executiveCenter = await tracker.run(
      'RC11_EXEC_RETURN',
      () => navigateToReportCenter(page, 'executive'),
      { safeApiPath: '/api/v1/executive-report', safeStatus: executiveResponse.status() }
    );
    const pdfButton = await tracker.run(
      'RC13_PDF_READY',
      async () => {
        await expect(executiveCenter.locator('.executive-report-print-page')).toContainText('รายงานผู้บริหาร');
        const button = executiveCenter.getByRole('button', { name: 'ส่งออก PDF', exact: true });
        await expect(button).toBeEnabled({ timeout: 60_000 });
        return button;
      },
      { safeApiPath: '/api/v1/executive-report', safeStatus: executiveResponse.status(), safeErrorCode: 'UAT_UI_PDF_READY_FAILED' }
    );
    await tracker.run(
      'RC14_PDF_CLICK',
      () => pdfButton.click({ timeout: 10_000 }),
      { safeApiPath: '/api/v1/executive-report', safeStatus: executiveResponse.status(), safeErrorCode: 'UAT_UI_PDF_CLICK_FAILED' }
    );
    await tracker.run('RC15_MONITOR', () => monitor.assertClean());
  } finally {
    await tracker.attach();
  }
}

async function requestRoleMatrix(role, token) {
  for (const route of getRoleApiMatrix(role)) {
    let response;
    try {
      response = await authenticatedRequest(route.path, { accessToken: token });
    } catch (error) {
      const routeCode = route.label.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      const safeError = new Error(`${error?.code || 'UAT_API_REQUEST_FAILED'}_${role}_${routeCode}`);
      safeError.code = safeError.message;
      throw safeError;
    }
    expect(response.status, `${role} ${route.label} expected ${route.expectedStatus}, received ${response.status}.`).toBe(route.expectedStatus);
  }
}

  for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
  test.describe(`${role} authenticated V3`, () => {
    test(`V3 ${role}: login and role identity`, async ({ page }, testInfo) => {
      test.skip(!authenticatedMode() || !scopeAllows(role, 'login'), 'This role is outside the selected UAT scope.');
      const monitor = startPageMonitor(page);
      const tracker = createStageTracker({ role, testCode: 'LOGIN', testInfo });
      try {
        const { accessToken } = await tracker.run('NAV01_LOGIN', () => loginAs(page, role));
        expect(accessToken).toEqual(expect.any(String));
        await testInfo.attach('v3-role-status.json', { body: JSON.stringify({ role, login: 'PASS' }), contentType: 'application/json' });
        await tracker.run('RC15_MONITOR', () => monitor.assertClean());
      } finally {
        await tracker.attach();
      }
    });

    test(`V3 ${role}: read-only API authorization and scope`, async ({ page }) => {
      test.skip(!authenticatedMode() || diagnosticScope(), 'The diagnostic scope excludes the complete API matrix.');
      test.setTimeout(180_000);
      const { accessToken } = await loginAs(page, role);
      await requestRoleMatrix(role, accessToken);
    });

    test(`V3 ${role}: navigation shell`, async ({ page }, testInfo) => {
      test.skip(!authenticatedMode() || !scopeAllows(role, 'navigation'), 'This navigation contract is outside the selected UAT scope.');
      const monitor = startPageMonitor(page);
      const tracker = createStageTracker({ role, testCode: 'NAVIGATION', testInfo });
      try {
        await loginAs(page, role);
        await tracker.run('NAV02_PRIMARY_NAV', () => expectNavigation(page, role), {});
        await tracker.run('RC15_MONITOR', () => monitor.assertClean());
      } finally {
        await tracker.attach();
      }
    });

    for (const item of getRolePageChecks(role).filter(({ id }) => id !== 'reportCenter')) {
      test(`V3 ${role}: protected page ${item.id}`, async ({ page }) => {
        test.skip(!authenticatedMode() || diagnosticScope(), 'The diagnostic scope excludes the complete protected-page smoke.');
        const monitor = startPageMonitor(page);
        await loginAs(page, role);
        await navigateTo(page, item.id);
        await expect(page.getByRole('heading').first(), `${role} ${item.label} must render a page heading.`).toBeVisible();
        monitor.assertClean();
      });
    }

    if (['ADMIN', 'MANAGER'].includes(role)) {
      test(`V3 ${role}: Unified Report Center acceptance`, async ({ page }, testInfo) => {
        test.skip(!authenticatedMode() || !scopeAllows(role, 'reportCenter'), 'Unified Report Center is outside the selected UAT scope.');
        test.setTimeout(180_000);
        const monitor = startPageMonitor(page);
        await loginAs(page, role);
        await expectUnifiedReportCenter(page, role, testInfo, monitor);
      });
    }
  });
}

for (const role of ['ADMIN', 'MANAGER']) {
  test(`UAT diagnostic ${role}: dashboard observation`, async ({ page }, testInfo) => {
    test.skip(!authenticatedMode() || !scopeAllows(role, 'dashboard'), 'Dashboard diagnostic is outside the selected UAT scope.');
    test.setTimeout(90_000);
    const monitor = startPageMonitor(page);
    const tracker = createStageTracker({ role, testCode: 'DASHBOARD_DIAGNOSTIC', testInfo });
    try {
      await loginAs(page, role);
      await tracker.run(
        'NAV03_DASHBOARD',
        async () => {
          const response = await observeApiResponse(page, '/api/v1/dashboard', () => page.reload({ waitUntil: 'domcontentloaded' }));
          await expect(page.getByRole('heading').first(), `${role} Dashboard must render after the observed response.`).toBeVisible();
          return response;
        },
        { safeApiPath: '/api/v1/dashboard', safeErrorCode: 'UAT_UI_DASHBOARD_RENDER_FAILED' }
      );
      await tracker.run('RC15_MONITOR', () => monitor.assertClean());
    } finally {
      await tracker.attach();
    }
  });
}

for (const role of ['ADMIN', 'MANAGER']) {
  test(`V3 ${role}: authenticated responsive smoke`, async ({ page }, testInfo) => {
    test.skip(!authenticatedMode() || diagnosticScope(), 'The diagnostic scope excludes responsive regression coverage.');
    const monitor = startPageMonitor(page);
    const pages = role === 'ADMIN' ? ['dashboard', 'schedule', 'dataQuality', 'audit', 'reportCenter'] : ['dashboard', 'schedule', 'reportCenter'];
    await loginAs(page, role);
    for (const viewport of [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1440', width: 1440, height: 900 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if (viewport.name !== '390') await page.goto('/');
      for (const pageId of pages) {
        if (pageId === 'reportCenter') {
          const center = await navigateToReportCenter(page, 'executive');
          await expect(center.getByRole('heading', { name: 'รายงานและวิเคราะห์', exact: true })).toBeVisible();
          await expect(center.getByRole('tab', { name: 'ภาพรวมผู้บริหาร', exact: true })).toBeVisible();
        } else {
          await navigateTo(page, pageId);
          await expect(page.getByRole('heading').first()).toBeVisible();
        }
        await assertNoHorizontalOverflow(page);
      }
      await captureScreenshot(page, testInfo, `v3-${role.toLowerCase()}-${viewport.name}`);
    }
    monitor.assertClean();
  });
}

test('V3 ADMIN: Employee Lifecycle management, history, state, and preflight are available without mutation', async ({ page }) => {
  test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
  test.setTimeout(180_000);
  const { accessToken } = await loginAs(page, 'ADMIN');
  const employee = await firstEmployee(accessToken);
  const historyPath = `/api/v1/employees/${employee.id}/lifecycle?page=1&pageSize=25`;
  const history = await authenticatedRequest(historyPath, { accessToken });
  expect(history.status, 'ADMIN lifecycle history must load.').toBe(200);
  expect(history.payload?.data).toEqual(expect.any(Array));
  const statePath = `/api/v1/employees/${employee.id}/lifecycle/state?date=${new Date().toISOString().slice(0, 10)}`;
  const state = await authenticatedRequest(statePath, { accessToken });
  expect(state.status, 'ADMIN lifecycle as-of state must load.').toBe(200);
  expect(state.payload?.data?.displayName).toEqual(expect.any(String));
  const preflightPath = `/api/v1/employees/${employee.id}/lifecycle/preflight`;
  const preflight = await authenticatedRequest(preflightPath, {
    accessToken,
    method: 'POST',
    data: {
      type: 'NAME_CHANGE',
      effectiveDate: new Date().toISOString().slice(0, 10),
      changes: { firstName: employee.firstName, lastName: employee.lastName }
    }
  });
  expect(preflight.status, 'ADMIN non-mutating lifecycle preflight must load dependency impacts.').toBe(200);
  const analysis = preflight.payload?.data;
  expect(analysis?.employee?.id).toBe(employee.id);
  expect(analysis?.impacts).toEqual(expect.objectContaining({
    futureShiftAssignments: expect.any(Number),
    pendingLeaveRequests: expect.any(Number),
    leaveQuotaRecords: expect.any(Number),
    activeLicenses: expect.any(Number),
    licenseDocuments: expect.any(Number),
    linkedUser: expect.any(Object)
  }));
  await navigateTo(page, 'employees');
  const employeeRow = page.locator(`[data-personnel-id="${employee.id}"]`);
  await expect(employeeRow, 'The lifecycle acceptance employee must render in the personnel table.').toBeVisible();
  const lifecycleButton = employeeRow.locator('button.lifecycle-action:visible');
  await expect(lifecycleButton).toBeVisible();
  await lifecycleButton.click();
  await expect(page.getByRole('dialog', { name: 'จัดการวงจรพนักงาน' })).toBeVisible();
  await expect(page.getByText('ประวัติวงจรพนักงาน', { exact: true })).toBeVisible();
  await expect(page.getByText('อ่านอย่างเดียว', { exact: true })).toBeVisible();
});

test('V3 MANAGER: Employee Lifecycle history is read-only and mutations are forbidden', async ({ page }) => {
  test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
  const { accessToken } = await loginAs(page, 'MANAGER');
  const employee = await firstEmployee(accessToken);
  const historyPath = `/api/v1/employees/${employee.id}/lifecycle?page=1&pageSize=25`;
  expect((await authenticatedRequest(historyPath, { accessToken })).status).toBe(200);
  const preflightPath = `/api/v1/employees/${employee.id}/lifecycle/preflight`;
  expect((await authenticatedRequest(preflightPath, {
    accessToken,
    method: 'POST',
    data: { type: 'NAME_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { firstName: employee.firstName, lastName: employee.lastName } }
  })).status).toBe(403);
  const mutationPath = `/api/v1/employees/${employee.id}/lifecycle`;
  expect((await authenticatedRequest(mutationPath, {
    accessToken,
    method: 'POST',
    data: { type: 'NAME_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { firstName: employee.firstName, lastName: employee.lastName }, reason: 'authorization boundary only', expectedEmployeeUpdatedAt: new Date().toISOString(), idempotencyKey: '00000000-0000-4000-8000-000000000001', acknowledgeWarnings: true }
  })).status).toBe(403);
  await navigateTo(page, 'employees');
  await expect(page.getByRole('button', { name: /จัดการวงจรพนักงาน/ })).toHaveCount(0);
});

test('V3 VIEWER: Employee Lifecycle history and mutations are forbidden', async ({ page }) => {
  test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
  const { accessToken } = await loginAs(page, 'VIEWER');
  const employee = await firstEmployee(accessToken);
  const historyPath = `/api/v1/employees/${employee.id}/lifecycle?page=1&pageSize=25`;
  expect((await authenticatedRequest(historyPath, { accessToken })).status).toBe(403);
  const mutationPath = `/api/v1/employees/${employee.id}/lifecycle`;
  expect((await authenticatedRequest(mutationPath, {
    accessToken,
    method: 'POST',
    data: { type: 'POSITION_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { jobTitle: 'authorization-boundary-only' }, reason: 'authorization boundary only', expectedEmployeeUpdatedAt: new Date().toISOString(), idempotencyKey: '00000000-0000-4000-8000-000000000002', acknowledgeWarnings: true }
  })).status).toBe(403);
  await navigateTo(page, 'employees');
  await expect(page.getByRole('button', { name: /จัดการวงจรพนักงาน/ })).toHaveCount(0);
});
