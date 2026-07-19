process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_LIMIT_MAX = '2';
const test = require('node:test');
const assert = require('node:assert/strict');
const { authorize } = require('../src/middlewares/authenticate');
const loginRateLimit = require('../src/middlewares/login-rate-limit');

function nextResult(middleware, req) { return new Promise((resolve) => middleware(req, { setHeader() {} }, resolve)); }
test('ADMIN, HR, and USER authorization is enforced', async () => {
  assert.equal(await nextResult(authorize('ADMIN'), { user: { role: 'ADMIN' } }), undefined);
  assert.equal((await nextResult(authorize('ADMIN', 'HR'), { user: { role: 'USER' } })).statusCode, 403);
  assert.equal(await nextResult(authorize('ADMIN', 'HR'), { user: { role: 'HR' } }), undefined);
});
test('login rate limiter rejects attempts beyond its configured maximum', async () => {
  const req = { ip: '192.0.2.5' };
  assert.equal(await nextResult(loginRateLimit, req), undefined);
  assert.equal(await nextResult(loginRateLimit, req), undefined);
  assert.equal((await nextResult(loginRateLimit, req)).statusCode, 429);
});
