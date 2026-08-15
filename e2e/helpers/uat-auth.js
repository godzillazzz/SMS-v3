const { expect, request } = require('@playwright/test');
const { getUatConfig } = require('./uat-config');
const { automationBypassHeaders } = require('./technical-smoke');
const { authenticatedRequest } = require('./uat-authenticated-request');
const {
  markHarnessPreventedHeavyRead,
  performAndWaitForHeavyRequest
} = require('./uat-heavy-read-v3');
const { readRoleSession } = require('./uat-session');
const { classifyUatTarget } = require('./uat-target-contract');

const authHarnessStateByPage = new WeakMap();

function authHarnessState(page) {
  let state = authHarnessStateByPage.get(page);
  if (!state) {
    state = {
      cachedRefreshRouteInstalled: false,
      cachedRefreshHits: 0,
      dashboardSuppressorActive: 0
    };
    authHarnessStateByPage.set(page, state);
  }
  return state;
}

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
  const state = authHarnessState(page);
  if (state.cachedRefreshRouteInstalled) return;
  state.cachedRefreshRouteInstalled = true;
  await page.route('**/api/v1/auth/refresh**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    state.cachedRefreshHits += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accessToken: session.accessToken, tokenType: 'Bearer', user: session.user })
    });
  });
}

function dashboardSuppressor(page) {
  const state = authHarnessState(page);
  const pattern = '**/api/v1/dashboard**';
  const handler = async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    markHarnessPreventedHeavyRead(page, request);
    await route.abort('aborted');
  };
  let installed = false;
  return {
    activeCount: () => state.dashboardSuppressorActive,
    async install() {
      if (installed) return;
      installed = true;
      state.dashboardSuppressorActive += 1;
      await page.route(pattern, handler);
    },
    async remove() {
      if (!installed) return;
      try {
        await page.unroute(pattern, handler);
      } finally {
        installed = false;
        state.dashboardSuppressorActive = Math.max(0, state.dashboardSuppressorActive - 1);
      }
    }
  };
}

function dashboardSuppressorActiveCount(page) {
  return authHarnessState(page).dashboardSuppressorActive;
}

async function scrubLoginCredentialDom(page) {
  if (page.isClosed?.()) return;
  await page.locator('input[type="password"], input[name="password"], input[autocomplete="current-password"], input[type="email"]').evaluateAll((inputs) => {
    for (const input of inputs) {
      input.value = '';
      input.removeAttribute('value');
    }
  }).catch(() => undefined);
}

function cachedSessionDiagnostic(page, stateBefore, dashboardStatus) {
  const state = authHarnessState(page);
  return {
    identityMode: 'CACHED_PREFLIGHT_SESSION',
    targetClass: classifyUatTarget(getUatConfig().baseURL).targetClass,
    roleMatched: true,
    cachedSessionPresent: true,
    cachedRefreshUsed: state.cachedRefreshHits > stateBefore.cachedRefreshHits,
    dashboardStatus,
    dashboardRequestTerminal: true,
    authenticatedShellVisible: true,
    dashboardSuppressorActiveAtHelperReturn: state.dashboardSuppressorActive
  };
}

async function bootstrapAs(page, role) {
  const session = roleSession(role);
  const state = authHarnessState(page);
  const stateBefore = { cachedRefreshHits: state.cachedRefreshHits };
  await installCachedRefreshRoute(page, session);
  const suppressor = dashboardSuppressor(page);
  await suppressor.install();
  try {
    await page.goto('/');
    await expect(page.locator('form.login-form')).toHaveCount(0);
    await expect(page.locator('nav.nav-menu').first(), 'Authenticated navigation shell must render.').toBeVisible();
  } finally {
    await suppressor.remove();
  }
  if (suppressor.activeCount() !== 0) {
    const error = new Error('UAT_DASHBOARD_SUPPRESSOR_LEAK');
    error.code = 'UAT_DASHBOARD_SUPPRESSOR_LEAK';
    throw error;
  }
  return {
    accessToken: session.accessToken,
    authContract: {
      identityMode: 'CACHED_PREFLIGHT_SESSION',
      targetClass: classifyUatTarget(getUatConfig().baseURL).targetClass,
      roleMatched: session.user?.role === role,
      cachedSessionPresent: true,
      cachedRefreshUsed: state.cachedRefreshHits > stateBefore.cachedRefreshHits,
      authenticatedShellVisible: true,
      dashboardSuppressorActiveAtHelperReturn: state.dashboardSuppressorActive
    }
  };
}

async function loginAs(page, role) {
  const session = roleSession(role);
  const state = authHarnessState(page);
  const stateBefore = { cachedRefreshHits: state.cachedRefreshHits };
  await installCachedRefreshRoute(page, session);
  const dashboardResponse = await performAndWaitForHeavyRequest(page, '/api/v1/dashboard', () => page.goto('/'));
  await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();
  return {
    accessToken: session.accessToken,
    authContract: cachedSessionDiagnostic(page, stateBefore, dashboardResponse.status())
  };
}

async function loginViaUi(page, role) {
  const config = getUatConfig();
  const targetClass = classifyUatTarget(config.baseURL).targetClass;
  if (targetClass !== 'CANONICAL') {
    const error = new Error('UAT_REAL_LOGIN_ORIGIN_NOT_CANONICAL');
    error.code = error.message;
    throw error;
  }
  const account = config.accounts[role];
  if (!account?.configured) throw new Error(`UAT credentials unavailable for role: ${role}`);

  const state = authHarnessState(page);
  if (state.cachedRefreshRouteInstalled || state.cachedRefreshHits !== 0) {
    const error = new Error('UAT_REAL_LOGIN_CACHED_REFRESH_ROUTE_ACTIVE');
    error.code = 'UAT_REAL_LOGIN_CACHED_REFRESH_ROUTE_ACTIVE';
    throw error;
  }
  if (state.dashboardSuppressorActive !== 0) {
    const error = new Error('UAT_DASHBOARD_SUPPRESSOR_LEAK');
    error.code = 'UAT_DASHBOARD_SUPPRESSOR_LEAK';
    throw error;
  }

  await page.goto('/');
  const loginRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/v1/auth/login' && request.method() === 'POST';
  }, { timeout: 15_000 });
  const loginResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/auth/login' && response.request().method() === 'POST';
  }, { timeout: 15_000 });

  let payload;
  let loginStatus;
  try {
    await page.getByLabel('อีเมล').fill(account.email);
    await page.getByLabel('รหัสผ่าน').fill(account.password);

    const dashboardResponse = await performAndWaitForHeavyRequest(page, '/api/v1/dashboard', async () => {
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
      await loginRequest;
      await scrubLoginCredentialDom(page);

      const response = await loginResponse;
      loginStatus = response.status();
      if (loginStatus < 200 || loginStatus >= 300) {
        const error = new Error(`UAT_REAL_LOGIN_HTTP_${loginStatus}`);
        error.code = error.message;
        error.status = loginStatus;
        throw error;
      }
      payload = await response.json();
      if (payload?.user?.role !== role) {
        const error = new Error('UAT_REAL_LOGIN_ROLE_MISMATCH');
        error.code = error.message;
        throw error;
      }
      if (typeof payload?.accessToken !== 'string' || payload.accessToken.length === 0) {
        const error = new Error('UAT_REAL_LOGIN_TOKEN_MISSING');
        error.code = error.message;
        throw error;
      }
    });

    await expect(page.locator('form.login-form')).toHaveCount(0);
    await expect(page.locator('nav.nav-menu').first(), 'Successful real login must establish the authenticated shell.').toBeVisible();
    await expect(page.getByRole('heading', { name: 'Executive Operations Dashboard' })).toBeVisible();

    return {
      accessToken: payload.accessToken,
      authContract: {
        identityMode: 'REAL_BROWSER_LOGIN',
        targetClass,
        loginStatus,
        dashboardStatus: dashboardResponse.status(),
        roleMatched: payload?.user?.role === role,
        accessTokenPresent: typeof payload?.accessToken === 'string' && payload.accessToken.length > 0,
        cachedSessionPresent: false,
        cachedRefreshUsed: false,
        dashboardRequestTerminal: true,
        authenticatedShellVisible: true,
        dashboardSuppressorActiveAtHelperReturn: dashboardSuppressorActiveCount(page)
      }
    };
  } finally {
    await scrubLoginCredentialDom(page);
  }
}

async function authenticateRoleIdentity(page, role) {
  const config = getUatConfig();
  const targetClass = classifyUatTarget(config.baseURL).targetClass;
  if (targetClass === 'CANONICAL') return loginViaUi(page, role);
  if (targetClass === 'IMMUTABLE') return bootstrapAs(page, role);
  const error = new Error('UAT_TARGET_CLASS_INVALID');
  error.code = error.message;
  throw error;
}

async function getAuditEventsStatus(accessToken) {
  const response = await authenticatedRequest('/api/v1/audit-events?page=1&pageSize=1', { accessToken });
  return response.status;
}

module.exports = {
  authHarnessState,
  authenticateRoleIdentity,
  bootstrapAs,
  dashboardSuppressor,
  dashboardSuppressorActiveCount,
  getAuditEventsStatus,
  installCachedRefreshRoute,
  loginAs,
  loginViaUi,
  preflightRoleAccounts,
  roleAccessToken,
  scrubLoginCredentialDom
};
