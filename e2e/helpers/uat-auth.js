const { expect, request } = require('@playwright/test');
const { getUatConfig } = require('./uat-config');
const { automationBypassHeaders, automationRequestOptions } = require('./technical-smoke');

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
  try {
    for (const role of ['ADMIN', 'MANAGER', 'VIEWER']) {
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
      } catch (error) {
        results.push({ role, ready: false, status: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'REQUEST_FAILED' });
      }
    }
  } finally {
    await context.dispose();
  }
  return { allReady: results.every((result) => result.ready), results };
}

async function loginAs(page, role) {
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

async function getAuditEventsStatus(page, accessToken) {
  const response = await page.request.get(
    '/api/v1/audit-events?page=1&pageSize=1',
    automationRequestOptions(
      { headers: { Authorization: `Bearer ${accessToken}` } },
      process.env,
      process.env.UAT_BASE_URL,
      '/api/v1/audit-events?page=1&pageSize=1'
    )
  );
  return response.status();
}

module.exports = { getAuditEventsStatus, loginAs, preflightRoleAccounts };
