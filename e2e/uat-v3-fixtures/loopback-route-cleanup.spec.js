'use strict';
const http = require('node:http');
const { test, expect } = require('@playwright/test');
const { installReadonlyBrowser } = require('../uat-v3/auth');

let baseURL;
let slowServer;

test.beforeAll(async () => {
  slowServer = http.createServer((_req, res) => setTimeout(() => res.end('late'), 250));
  await new Promise((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${slowServer.address().port}`;
});
test.afterAll(async () => { await new Promise((resolve) => slowServer.close(resolve)); });
test.afterEach(async ({ page }) => { await page?.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); });

test('loopback delayed route can finish after the page closes without unhandled error', async ({ page }) => {
  await installReadonlyBrowser(page, { user: { id: 'delayed', role: 'VIEWER' }, accessToken: 'delayed' }, baseURL);
  const pending = page.evaluate((url) => fetch(url).catch(() => undefined), `${baseURL}/slow`);
  await page.close();
  await pending.catch(() => {});
});

test('following test remains clean after delayed route teardown', async ({ page }) => {
  await installReadonlyBrowser(page, { user: { id: 'following', role: 'VIEWER' }, accessToken: 'following' }, baseURL);
  await page.goto(baseURL);
  await expect(page).toHaveURL(baseURL + '/');
});
