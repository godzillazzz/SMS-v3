'use strict';
const fs = require('node:fs');
const { test, expect, request } = require('@playwright/test');
const { readConfig, roles } = require('./config');
const { preflightAccounts, readRoleApi, installReadonlyBrowser, loginPreflightRequestOptions } = require('./auth');
const { getRoleApiMatrix, getRoleNavigationContract } = require('./role-matrix');
let config, sessions;
function requestOptions() {
  return loginPreflightRequestOptions(process.env, config.baseURL);
}
test.beforeAll(async () => {
  const preflight = Object.fromEntries(roles.map((role) => [role, 'NOT_RUN']));
  try {
    config = readConfig();
    sessions = await preflightAccounts(
      () => request.newContext(requestOptions()),
      config,
      ({ role, code }) => { if (roles.includes(role)) preflight[role] = code; }
    );
  } finally {
    // Only fixed role identifiers and coarse status codes are persisted.
    fs.mkdirSync('test-results/uat-v3-safe', { recursive: true });
    fs.writeFileSync('test-results/uat-v3-safe/preflight.json', JSON.stringify(preflight));
  }
});
test.afterAll(() => sessions?.clear());
for (const role of roles) {
  test(`${role}: real browser login and exact identity`, async ({ page }) => {
    const attempts = await installReadonlyBrowser(page, undefined, config.baseURL, { realLogin: true });
    await test.step('BROWSER_PAGE_READY', async () => {
      await page.goto(config.baseURL + '/app');
      await expect(page.locator('.nexus-public #auth-login-form')).toBeVisible();
    });
    await test.step('BROWSER_CREDENTIAL_INPUTS', async () => {
      await page.locator('#auth-login-form input#email').fill(config.accounts[role].email);
      await page.locator('form.login-form input#password').fill(config.accounts[role].password);
    });
    let response;
    await test.step('BROWSER_LOGIN_REQUEST', async () => {
      const pending = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/auth/login' && r.request().method() === 'POST');
      await page.locator('#auth-login-form button[type="submit"]').click();
      response = await pending;
    });
    await test.step('BROWSER_LOGIN_IDENTITY', async () => {
      // Never attach payload, tokens, DOM snapshots, passwords, or login screenshots.
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.user?.role).toBe(role);
      expect(payload.user?.id === sessions.get(role).user.id).toBe(true);
    });
    await test.step('BROWSER_AUTH_TRANSITION', async () => {
      await expect(page.locator('form.login-form')).toHaveCount(0);
    });
    await test.step('BROWSER_READONLY_GUARD', async () => {
      expect(attempts).toEqual([]);
    });
  });
  test(`${role}: API authorization and expected denial`, async () => {
    const context = await request.newContext({ baseURL: config.baseURL, extraHTTPHeaders: requestOptions().extraHTTPHeaders });
    try {
      for (const route of getRoleApiMatrix(role)) {
        const response = await readRoleApi(context, role, sessions.get(role), route.path);
        expect(response.status(), `${role} ${route.label}`).toBe(route.expectedStatus);
      }
      expect((await context.get('/api/v1/approval-center/summary', { maxRedirects: 0 })).status()).toBe(401);
      expect((await context.get('/api/v1/approval-center/summary', { maxRedirects: 0, headers: { Authorization: 'Bearer invalid-uat-boundary-token' } })).status()).toBe(401);
    } finally { await context.dispose(); }
  });
  for (const [name, width, height] of [['desktop', 1366, 768], ['mobile', 375, 812]]) {
    for (const theme of ['light', 'dark']) {
      test(`${role}: ${name} ${theme} navigation and approval visibility`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((value) => localStorage.setItem('sms-v3-theme', value), theme);
        const attempts = await installReadonlyBrowser(page, sessions.get(role), config.baseURL);
        await page.goto(config.baseURL + '/app/employees');
        if (name === 'mobile') await page.getByRole('button', { name: 'เปิดเมนูหลัก', exact: true }).click();
        const nav = page.locator('nav.nav-menu').first();
        await expect(nav).toBeVisible();
        const matrix = getRoleNavigationContract(role);
        for (const item of matrix.required) await expect(nav.locator(`[data-navigation-id="${item.id}"]`)).toBeVisible();
        for (const item of matrix.forbidden) await expect(nav.locator(`[data-navigation-id="${item.id}"]`)).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        expect(attempts).toEqual([]);
      });
    }
  }
}
