process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const env = require('../src/config/env');
const { setBrowserSession, clearBrowserSession, csrfProtection, refreshCookiePath, csrfCookiePath } = require('../src/middlewares/browser-session');

test('browser refresh cookie is HttpOnly, Lax, narrowly scoped, and Secure in production mode', () => {
  const cookies = []; const response = { cookie: (...args) => cookies.push(args), clearCookie: (...args) => cookies.push(args) };
  const previous = env.cookieSecure; env.cookieSecure = true;
  setBrowserSession(response, 'refresh-token-value');
  const refresh = cookies.find(([name]) => name === env.authCookieName);
  assert.equal(refresh[1], 'refresh-token-value'); assert.equal(refresh[2].httpOnly, true); assert.equal(refresh[2].secure, true); assert.equal(refresh[2].sameSite, 'lax'); assert.equal(refresh[2].path, refreshCookiePath);
  const csrf = cookies.find(([name]) => name === env.csrfCookieName)[2];
  assert.equal(csrf.httpOnly, false); assert.equal(csrf.secure, true); assert.equal(csrf.sameSite, 'lax'); assert.equal(csrf.path, csrfCookiePath);
  clearBrowserSession(response); env.cookieSecure = previous;
});
test('production configuration cannot disable the Secure cookie attribute', () => {
  const script = "process.stdout.write(String(require('./src/config/env').cookieSecure))";
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/smsv3_test',
      JWT_SECRET: 'test-secret-with-at-least-thirty-two-chars',
      CORS_ORIGIN: 'https://staging.example.test',
      COOKIE_SECURE: 'false'
    }
  }).toString();
  assert.equal(output, 'true');
});
test('CSRF protection rejects missing tokens and accepts matching cookie/header tokens', async () => {
  const run = (headers) => new Promise((resolve) => csrfProtection({ headers, get: (name) => headers[name] }, {}, resolve));
  assert.equal((await run({})).statusCode, 403);
  assert.equal(await run({ cookie: `${env.csrfCookieName}=valid-token`, 'x-csrf-token': 'valid-token' }), undefined);
});
