'use strict';
const http = require('node:http');
const { test, expect } = require('@playwright/test');
const { roles } = require('../uat-v3/config');
const { getRoleNavigationContract } = require('../uat-v3/role-matrix');
const { installReadonlyBrowser } = require('../uat-v3/auth');

let server;
let baseURL;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
        res.writeHead(405); return res.end();
      }
      const status = url.pathname.endsWith('/forbidden') ? 403 : url.pathname.endsWith('/unauthorized') ? 401 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status }));
    }
    const role = roles.includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'VIEWER';
    const contract = getRoleNavigationContract(role);
    const ids = contract.required.map((item) => item.id);
    const sidebar = ids.map((id) => `<a data-navigation-id="${id}">${id}</a>`).join('');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><body><nav class="nav-menu">${sidebar}</nav><output id="role">${role}</output></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
test.afterEach(async ({ page }) => { await page?.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); });

for (const role of roles) {
  const cases = [
    ['sidebar required items', async (page) => {
      const contract = getRoleNavigationContract(role);
      for (const item of contract.required) await expect(page.locator(`[data-navigation-id="${item.id}"]`)).toHaveCount(1);
    }],
    ['sidebar forbidden items', async (page) => {
      const contract = getRoleNavigationContract(role);
      for (const item of contract.forbidden) await expect(page.locator(`[data-navigation-id="${item.id}"]`)).toHaveCount(0);
    }],
    ['API 200 response', async (page) => { expect(await page.evaluate(() => fetch('/api/v1/ok').then((r) => r.status))).toBe(200); }],
    ['API 401 response', async (page) => { expect(await page.evaluate(() => fetch('/api/v1/unauthorized').then((r) => r.status))).toBe(401); }],
    ['API 403 response', async (page) => { expect(await page.evaluate(() => fetch('/api/v1/forbidden').then((r) => r.status))).toBe(403); }],
    ['readonly guard', async (page) => { expect(await page.evaluate(() => fetch('/api/v1/write', { method: 'POST' }).then((r) => r.status).catch(() => 0))).toBe(0); }]
  ];
  for (const [name, check] of cases) {
    test(`${role}: loopback ${name}`, async ({ page }) => {
      await installReadonlyBrowser(page, { user: { id: `fixture-${role}`, role }, accessToken: `fixture-${role}` }, baseURL);
      await page.goto(`${baseURL}/app?role=${role}`);
      await expect(page.locator('#role')).toHaveText(role);
      await check(page);
    });
  }
}
