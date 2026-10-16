const http = require('node:http');
const { test, expect } = require('@playwright/test');
const { roles } = require('../uat-v3/config');
const { installReadonlyBrowser } = require('../uat-v3/auth');
let server, baseURL, serverWrites = 0;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { serverWrites++; res.writeHead(500); res.end(); return; }
    if (req.url === '/api/v1/read') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ role: (req.headers.authorization || '').replace('Bearer fixture-', '') })); return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><body><output id="identity"></output><script>
      (async () => {
        const session = await (await fetch('/api/v1/auth/refresh', {method:'POST'})).json();
        const read = await (await fetch('/api/v1/read', {headers:{Authorization:'Bearer '+session.accessToken}})).json();
        document.querySelector('#identity').textContent = read.role;
        await fetch('/api/v1/licenses', {method:'POST',body:'{}'}).catch(() => {});
        window.done = true;
      })();
    </script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });
for (const role of roles) test(`local fixture ${role}: independent session and no business write reaches server`, async ({ page }) => {
  const attempts = await installReadonlyBrowser(page, { user: { id: `fixture-${role}`, role }, accessToken: `fixture-${role}` }, baseURL);
  await page.goto(baseURL);
  await expect(page.locator('#identity')).toHaveText(role);
  await page.waitForFunction(() => window.done === true);
  expect(attempts).toEqual([{ method: 'POST', path: '/api/v1/licenses' }]);
  expect(serverWrites).toBe(0);
});

test('cross-origin cookie credentials never reach a second server', async ({ page, context }) => {
  let externalRequests = 0;
  const external = http.createServer((_req, res) => {
    externalRequests++;
    res.setHeader('Access-Control-Allow-Origin', baseURL);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.end('synthetic');
  });
  await new Promise((resolve) => external.listen(0, '127.0.0.1', resolve));
  try {
    await context.addCookies([{ name: 'synthetic_session', value: 'fixture-only', url: baseURL }]);
    const attempts = await installReadonlyBrowser(page, { user: { id: 'cookie-fixture', role: 'VIEWER' }, accessToken: 'fixture-VIEWER' }, baseURL);
    await page.goto(baseURL);
    await page.waitForFunction(() => window.done === true);
    // Cookies are host-scoped, so a different port is a real origin boundary
    // that would still receive this cookie without the browser guard.
    await page.evaluate(async (url) => { await fetch(url, { credentials: 'include' }).catch(() => {}); }, `http://127.0.0.1:${external.address().port}/data`);
    expect(externalRequests).toBe(0);
    expect(attempts).toContainEqual({ method: 'GET', path: 'cross-origin-credential' });
  } finally {
    await new Promise((resolve) => external.close(resolve));
  }
});
