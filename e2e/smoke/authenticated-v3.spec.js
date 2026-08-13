const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { getUatConfig } = require('../helpers/uat-config');
const { automationRequestOptions } = require('../helpers/technical-smoke');
const { assertNoHorizontalOverflow, captureScreenshot, expectPrimaryNavigationItem, navigateTo, openPrimaryNavigation, primaryNavigationItem, startPageMonitor } = require('../helpers/uat-observe');
const { getRoleApiMatrix, getRoleNavigationContract, getRolePageChecks } = require('../helpers/uat-v3-role-matrix');

const authenticatedMode = () => String(process.env.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';

function authorizedOptions(accessToken, options = {}) {
  const config = getUatConfig();
  const path = options.path || '/';
  const { path: _path, ...requestOptions } = options;
  return automationRequestOptions(
    { ...requestOptions, headers: { ...(requestOptions.headers || {}), Authorization: `Bearer ${accessToken}` }, timeout: requestOptions.timeout || 60000 },
    process.env,
    config.baseURL,
    `${config.baseURL}${path}`
  );
}

async function firstEmployee(page, accessToken) {
  const path = '/api/v1/employees?page=1&pageSize=1';
  const response = await page.request.get(path, authorizedOptions(accessToken, { path }));
  expect(response.status(), 'Employee read must succeed before lifecycle acceptance.').toBe(200);
  const payload = await response.json();
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
}

async function requestRoleMatrix(page, role, token) {
  const config = getUatConfig();
  for (const route of getRoleApiMatrix(role)) {
    const response = await page.request.get(route.path, automationRequestOptions(
      { headers: { Authorization: `Bearer ${token}` }, timeout: 60000 },
      process.env,
      config.baseURL,
      `${config.baseURL}${route.path}`
    ));
    expect(response.status(), `${role} ${route.label} read contract must return ${route.expectedStatus}.`).toBe(route.expectedStatus);
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
      await requestRoleMatrix(page, role, accessToken);
    });

    test(`V3 ${role}: navigation and protected pages`, async ({ page }) => {
      test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
      const monitor = startPageMonitor(page);
      await loginAs(page, role);
      await expectNavigation(page, role);
      for (const item of getRolePageChecks(role)) {
        await navigateTo(page, item.id);
        await expect(page.getByRole('heading').first(), `${role} ${item.label} must render a page heading.`).toBeVisible();
      }
      monitor.assertClean();
    });
  });
}

for (const role of ['ADMIN', 'MANAGER']) {
  test(`V3 ${role}: authenticated responsive smoke`, async ({ page }, testInfo) => {
    test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
    const monitor = startPageMonitor(page);
    const pages = role === 'ADMIN' ? ['dashboard', 'schedule', 'dataQuality', 'audit', 'executiveReport'] : ['dashboard', 'schedule', 'executiveReport'];
    await loginAs(page, role);
    for (const viewport of [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1440', width: 1440, height: 900 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if (viewport.name !== '390') await page.goto('/');
      for (const pageId of pages) {
        await navigateTo(page, pageId);
        await expect(page.getByRole('heading').first()).toBeVisible();
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
  const employee = await firstEmployee(page, accessToken);
  const historyPath = `/api/v1/employees/${employee.id}/lifecycle?page=1&pageSize=25`;
  const history = await page.request.get(historyPath, authorizedOptions(accessToken, { path: historyPath }));
  expect(history.status(), 'ADMIN lifecycle history must load.').toBe(200);
  expect((await history.json())?.data).toEqual(expect.any(Array));
  const statePath = `/api/v1/employees/${employee.id}/lifecycle/state?date=${new Date().toISOString().slice(0, 10)}`;
  const state = await page.request.get(statePath, authorizedOptions(accessToken, { path: statePath }));
  expect(state.status(), 'ADMIN lifecycle as-of state must load.').toBe(200);
  expect((await state.json())?.data?.displayName).toEqual(expect.any(String));
  const preflightPath = `/api/v1/employees/${employee.id}/lifecycle/preflight`;
  const preflight = await page.request.post(preflightPath, authorizedOptions(accessToken, {
    path: preflightPath,
    data: {
      type: 'NAME_CHANGE',
      effectiveDate: new Date().toISOString().slice(0, 10),
      changes: { firstName: employee.firstName, lastName: employee.lastName }
    }
  }));
  expect(preflight.status(), 'ADMIN non-mutating lifecycle preflight must load dependency impacts.').toBe(200);
  const analysis = (await preflight.json())?.data;
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
  const lifecycleButton = page.getByRole('button', { name: /จัดการวงจรพนักงาน/ }).first();
  await expect(lifecycleButton).toBeVisible();
  await lifecycleButton.click();
  await expect(page.getByRole('dialog', { name: 'จัดการวงจรพนักงาน' })).toBeVisible();
  await expect(page.getByText('ประวัติวงจรพนักงาน', { exact: true })).toBeVisible();
  await expect(page.getByText('อ่านอย่างเดียว', { exact: true })).toBeVisible();
});

test('V3 MANAGER: Employee Lifecycle history is read-only and mutations are forbidden', async ({ page }) => {
  test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
  const { accessToken } = await loginAs(page, 'MANAGER');
  const employee = await firstEmployee(page, accessToken);
  const historyPath = `/api/v1/employees/${employee.id}/lifecycle?page=1&pageSize=25`;
  expect((await page.request.get(historyPath, authorizedOptions(accessToken, { path: historyPath }))).status()).toBe(200);
  const preflightPath = `/api/v1/employees/${employee.id}/lifecycle/preflight`;
  expect((await page.request.post(preflightPath, authorizedOptions(accessToken, {
    path: preflightPath,
    data: { type: 'NAME_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { firstName: employee.firstName, lastName: employee.lastName } }
  }))).status()).toBe(403);
  const mutationPath = `/api/v1/employees/${employee.id}/lifecycle`;
  expect((await page.request.post(mutationPath, authorizedOptions(accessToken, {
    path: mutationPath,
    data: { type: 'NAME_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { firstName: employee.firstName, lastName: employee.lastName }, reason: 'authorization boundary only', expectedEmployeeUpdatedAt: new Date().toISOString(), idempotencyKey: '00000000-0000-4000-8000-000000000001', acknowledgeWarnings: true }
  }))).status()).toBe(403);
  await navigateTo(page, 'employees');
  await expect(page.getByRole('button', { name: /จัดการวงจรพนักงาน/ })).toHaveCount(0);
});

test('V3 VIEWER: Employee Lifecycle history and mutations are forbidden', async ({ page }) => {
  test.skip(!authenticatedMode(), 'UAT_MODE=authenticated is required for role coverage.');
  const { accessToken } = await loginAs(page, 'VIEWER');
  const employee = await firstEmployee(page, accessToken);
  const historyPath = `/api/v1/employees/${employee.id}/lifecycle?page=1&pageSize=25`;
  expect((await page.request.get(historyPath, authorizedOptions(accessToken, { path: historyPath }))).status()).toBe(403);
  const mutationPath = `/api/v1/employees/${employee.id}/lifecycle`;
  expect((await page.request.post(mutationPath, authorizedOptions(accessToken, {
    path: mutationPath,
    data: { type: 'POSITION_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { jobTitle: 'authorization-boundary-only' }, reason: 'authorization boundary only', expectedEmployeeUpdatedAt: new Date().toISOString(), idempotencyKey: '00000000-0000-4000-8000-000000000002', acknowledgeWarnings: true }
  }))).status()).toBe(403);
  await navigateTo(page, 'employees');
  await expect(page.getByRole('button', { name: /จัดการวงจรพนักงาน/ })).toHaveCount(0);
});
