const { expect, request } = require('@playwright/test');
const { getUatConfig } = require('./uat-config');
const { automationBypassHeaders } = require('./technical-smoke');
const { authenticatedRequest } = require('./uat-authenticated-request');
const { preventHarnessBootstrapHeavyRead } = require('./uat-heavy-read-settlement');
const { navigateTo } = require('./uat-observe');
const { readRoleSession } = require('./uat-session');

async function preflightRoleAccounts(environment = process.env) {
  const config = getUatConfig(environment);
  const results = [];
  if (config.mode !== 'authenticated') {
    return { allReady: true, results: ['ADMIN', 'MANAGER', 'VIEWER'].map((role) => ({ role, ready: false, status: 'SKIPPED' })) };
  }

  const context = await request.newContext({
    baseURL: config.baseURL,
    extraHTTPHeaders: automationBypassHeaders(environment, config.baseURL, `${config.baseURL}/api/v1/auth/login`, { setBypassCookie: true })
  });
  const sessions = {};
  const rolesToCheck = config.scope === 'report-center-diagnostic' ? ['ADMIN', 'MANAGER'] : ['ADMIN', 'MANAGER', 'VIEWER'];
  try {
    for (const role of rolesToCheck) {
      const account = config.accounts[role];
      try {
        const response = await context.post('/api/v1/auth/login', {
          data: { email: account.email, password: account.password, clientType: 'browser' },
          timeout: 15000
        });
        const payload = await response.json().catch(() => ({}));
        const ready = response.status() >= 200
          && response.status() < 300
          && payload?.user?.role === role
          && typeof payload?.accessToken === 'string'
          && payload.accessToken.length > 0;
        results.push({ role, ready, status: ready ? 'READY' : `HTTP_${response.status()}` });
        if (ready) sessions[role] = { accessToken: payload.accessToken, user: payload.user };
      } catch (error) {
        results.push({ role, ready: false, status: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'REQUEST_FAILED' });
      }
    }
  } finally {
    await context.dispose();
  }
  for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
    if (!results.some((result) => result.role === role)) results.push({ role, ready: false, status: 'SKIPPED' });
  }
  return { allReady: results.filter((result) => rolesToCheck.includes(result.role)).every((result) => result.ready), results, sessions };
}

function roleSession(role) {
  const session = readRoleSession(role);
  if (!session?.accessToken || session.user?.role !== role) {
    const error = new Error('AUTH_SESSION_UNAVAILABLE');
    error.code = 'AUTH_SESSION_UNAVAILABLE';
    throw error;
  }
  return session;
}

function roleAccessToken(role) {
  return roleSession(role).accessToken;
}

async function installCachedRefreshRoute(page, session) {
  await page.route('**/api/v1/auth/refresh**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: session.accessToken, tokenType: 'Bearer', user: session.user })
    });
  });
}

async function loginAs(page, role) {
  const config = getUatConfig();
  const account = config.accounts[role];
  if (!account?.configured) throw new Error(`UAT credentials unavailable for role: ${role}`);

  const cachedSession = readRoleSession(role);
  if (cachedSession) {
    await installCachedRefreshRoute(page, cachedSession);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();
    return { accessToken: cachedSession.accessToken };
  }

  return loginViaUi(page, role);
}

async function loginViaUi(page, role) {
  const config = getUatConfig();
  const account = config.accounts[role];
  if (!account?.configured) throw new Error(`UAT credentials unavailable for role: ${role}`);

  await page.goto('/');
  const loginResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/auth/login' && response.request().method() === 'POST';
  });
  await page.getByLabel('อีเมล').fill(account.email);
  await page.getByLabel('รหัสผ่าน').fill(account.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();

  const response = await loginResponse;
  expect(response.status(), 'Login response must be successful.').toBeGreaterThanOrEqual(200);
  expect(response.status(), 'Login response must be successful.').toBeLessThan(300);
  const payload = await response.json();
  expect(payload?.user?.role, 'UAT identity must match its expected role.').toBe(role);
  expect(typeof payload?.accessToken, 'Login must establish an access token.').toBe('string');
  await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();

  return { accessToken: payload.accessToken };
}

async function bootstrapAs(page, role, { initialNavigationId = 'employees' } = {}) {
  const session = roleSession(role);
  await installCachedRefreshRoute(page, session);

  const dashboardPattern = '**/api/v1/dashboard**';
  const dashboardHandler = async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    preventHarnessBootstrapHeavyRead(page, request);
    await route.abort('aborted');
  };

  await page.route(dashboardPattern, dashboardHandler);
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();
    if (initialNavigationId && initialNavigationId !== 'dashboard') await navigateTo(page, initialNavigationId);
  } finally {
    await page.unroute(dashboardPattern, dashboardHandler);
  }

  return { accessToken: session.accessToken };
}

async function getAuditEventsStatus(accessToken) {
  const response = await authenticatedRequest('/api/v1/audit-events?page=1&pageSize=1', { accessToken });
  return response.status;
}

module.exports = {
  bootstrapAs,
  getAuditEventsStatus,
  loginAs,
  loginViaUi,
  preflightRoleAccounts,
  roleAccessToken
};
