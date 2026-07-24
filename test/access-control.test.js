process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_LIMIT_MAX = '2';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { authorize } = require('../src/middlewares/authenticate');
const loginRateLimit = require('../src/middlewares/login-rate-limit');
const app = require('../src/app');

function nextResult(middleware, req) { return new Promise((resolve) => middleware(req, { setHeader() {} }, resolve)); }
test('ADMIN, HR, MANAGER, VIEWER, and USER authorization is enforced', async () => {
  assert.equal(await nextResult(authorize('ADMIN'), { user: { role: 'ADMIN' } }), undefined);
  assert.equal((await nextResult(authorize('ADMIN', 'HR'), { user: { role: 'USER' } })).statusCode, 403);
  assert.equal(await nextResult(authorize('ADMIN', 'HR'), { user: { role: 'HR' } }), undefined);
  assert.equal(await nextResult(authorize('ADMIN', 'HR', 'MANAGER'), { user: { role: 'MANAGER' } }), undefined);
  assert.equal((await nextResult(authorize('ADMIN', 'HR', 'MANAGER'), { user: { role: 'VIEWER' } })).statusCode, 403);
});
test('login rate limiter rejects attempts beyond its configured maximum', async () => {
  const req = { ip: '192.0.2.5' };
  assert.equal(await nextResult(loginRateLimit, req), undefined);
  assert.equal(await nextResult(loginRateLimit, req), undefined);
  assert.equal((await nextResult(loginRateLimit, req)).statusCode, 429);
});
test('protected employee endpoints reject unauthenticated requests', async () => {
  const response = await request(app).get('/api/v1/employees');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Authentication required.');
});
