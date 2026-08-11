const { expect } = require('@playwright/test');
const { getUatConfig } = require('./uat-config');
const { trustedRequestOptions } = require('./technical-smoke');

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
  const response = await page.request.get('/api/v1/audit-events?page=1&pageSize=1', trustedRequestOptions({
    headers: { Authorization: `Bearer ${accessToken}` }
  }));
  return response.status();
}

module.exports = { getAuditEventsStatus, loginAs };
