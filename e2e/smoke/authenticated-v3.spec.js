const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { authenticatedRequest } = require('../helpers/uat-authenticated-request');
const { assertNoHorizontalOverflow, captureScreenshot, expectPrimaryNavigationItem, navigateTo, navigateToReportCenter, openPrimaryNavigation, primaryNavigationItem, primaryNavigationItemByLabel, startPageMonitor } = require('../helpers/uat-observe');
const { getRoleApiMatrix, getRoleNavigationContract, getRolePageChecks } = require('../helpers/uat-v3-role-matrix');

const authenticatedMode = () => String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';

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

async function expectUnifiedReportCenter(page, role) {
  const center = await navigateToReportCenter(page, 'executive');
  await expect(center.getByRole('heading', { name: 'รายงานและวิเคราะห์', exact: true })).toBeVisible();
  await expect(center.locator('section.executive-report-page[aria-label="รายงานผู้บริหาร"]')).toBeVisible({ timeout: 60_000 });
  await expect(center.locator('.executive-report-kpis')).toBeVisible({ timeout: 60_000 });
  await expect(center.locator('.executive-report-print')).toHaveCount(1, { timeout: 60_000 });
  await expect(center.locator('.report-center-filters select')).toHaveCount(role === 'ADMIN' ? 3 : 2);

  const filterValues = await center.locator('.report-center-filters select').evaluateAll((selects) => selects.map((select) => select.value));
  await center.getByRole('tab', { name: 'รายงานรายละเอียด', exact: true }).click();
  await expect(center.getByRole('heading', { name: 'รายงานรายละเอียด', exact: true })).toBeVisible();
  const detailFilterValues = await center.locator('.report-center-filters select').evaluateAll((selects) => selects.map((select) => select.value));
  expect(detailFilterValues).toEqual(filterValues);
  await expect(center.locator('.metrics-grid.report-grid')).toBeVisible({ timeout: 60_000 });

  await center.getByRole('tab', { name: 'Export', exact: true }).click();
  await expect(center.getByRole('heading', { name: 'Export', exact: true })).toBeVisible();
  await expect(center.getByRole('button', { name: 'ส่งออก PDF', exact: true })).toBeVisible();

  const executiveCenter = await navigateToReportCenter(page, 'executive');
  await expect(executiveCenter.locator('.executive-report-print')).toContainText('รายงานผู้บริหาร');
  const pdfButton = executiveCenter.getByRole('button', { name: 'ส่งออก PDF', exact: true });
  await expect(pdfButton).toBeEnabled({ timeout: 60_000 });
  let printFrame;
  const onFrameAttached = (frame) => {
    if (frame.parentFrame() === page.mainFrame()) printFrame = frame;
  };
  page.on('frameattached', onFrameAttached);
  try {
    await pdfButton.click();
    await expect.poll(() => Boolean(printFrame), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => printFrame ? printFrame.locator('.executive-report-print-page').count() : 0, { timeout: 10_000 }).toBe(1);
    await expect(printFrame.locator('.executive-report-print-page')).toContainText('รายงานผู้บริหาร');
  } finally {
    page.off('frameattached', onFrameAttached);
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
      test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
      const monitor = startPageMonitor(page);
      const { accessToken } = await loginAs(page, role);
      expect(accessToken).toEqual(expect.any(String));
      await testInfo.attach('v3-role-status.json', { body: JSON.stringify({ role, login: 'PASS' }), contentType: 'application/json' });
      monitor.assertClean();
    });

    test(`V3 ${role}: read-only API authorization and scope`, async ({ page }) => {
      test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
      test.setTimeout(180_000);
      const { accessToken } = await loginAs(page, role);
      await requestRoleMatrix(role, accessToken);
    });

    test(`V3 ${role}: navigation and protected pages`, async ({ page }) => {
      test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
      const monitor = startPageMonitor(page);
      await loginAs(page, role);
      await expectNavigation(page, role);
      for (const item of getRolePageChecks(role)) {
        if (item.id === 'reportCenter') await expectUnifiedReportCenter(page, role);
        else {
          await navigateTo(page, item.id);
          await expect(page.getByRole('heading').first(), `${role} ${item.label} must render a page heading.`).toBeVisible();
        }
      }
      monitor.assertClean();
    });
  });
}

for (const role of ['ADMIN', 'MANAGER']) {
  test(`V3 ${role}: authenticated responsive smoke`, async ({ page }, testInfo) => {
    test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
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
