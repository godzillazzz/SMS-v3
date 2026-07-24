process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const env = require('../src/config/env');
const calls = [];
const logoutAllCalls = [];
require.cache[require.resolve('../src/services/auth.service')] = { exports: {
  login: async () => ({ accessToken: 'access-token', refreshToken: 'refresh-token-not-in-json', tokenType: 'Bearer', user: { id: 'user-1', email: 'sample@example.test', displayName: 'Sample', role: 'VIEWER' } }),
  refresh: async (token) => { calls.push(token); return { accessToken: 'rotated-access', refreshToken: 'rotated-refresh', tokenType: 'Bearer' }; },
  logout: async (token) => calls.push(token), logoutAll: async (userId) => logoutAllCalls.push(userId), genericFailure: 'Invalid email or password.', refreshFailure: 'Invalid or expired refresh token.'
} };
require.cache[require.resolve('../src/middlewares/authenticate')] = { exports: {
  authenticate: (req, _res, next) => { req.user = { sub: 'browser-user' }; next(); },
  authorize: () => (_req, _res, next) => next()
} };
const routes = require('../src/routes/auth.routes');
const { errorHandler } = require('../src/middlewares/error-handler');
const app = express(); app.use(express.json()); app.use('/auth', routes); app.use(errorHandler);

test('browser login returns no refresh token and sets HttpOnly cookies', async () => {
  const response = await request(app).post('/auth/login').send({ email: 'sample@example.test', password: 'password', clientType: 'browser' });
  assert.equal(response.status, 200); assert.equal(response.body.refreshToken, undefined); assert.equal(response.body.accessToken, 'access-token');
  assert.match(response.headers['set-cookie'].join(';'), new RegExp(`${env.authCookieName}=refresh-token-not-in-json`)); assert.match(response.headers['set-cookie'].join(';'), /HttpOnly/);
});
test('browser refresh requires CSRF and logout clears browser cookies', async () => {
  const cookie = `${env.authCookieName}=cookie-refresh; ${env.csrfCookieName}=csrf-value`;
  assert.equal((await request(app).post('/auth/refresh').send({ clientType: 'browser' }).set('Cookie', cookie)).status, 403);
  const refreshed = await request(app).post('/auth/refresh').send({ clientType: 'browser' }).set('Cookie', cookie).set('X-CSRF-Token', 'csrf-value');
  assert.equal(refreshed.status, 200); assert.equal(refreshed.body.refreshToken, undefined); assert.equal(calls.at(-1), 'cookie-refresh');
  const logout = await request(app).post('/auth/logout').send({ clientType: 'browser' }).set('Cookie', cookie).set('X-CSRF-Token', 'csrf-value');
  assert.equal(logout.status, 204); assert.match(logout.headers['set-cookie'].join(';'), /Expires=Thu, 01 Jan 1970/);
});
test('browser logout-all requires a matching CSRF cookie and header', async () => {
  const cookie = `${env.authCookieName}=cookie-refresh; ${env.csrfCookieName}=csrf-value`;
  const missing = await request(app).post('/auth/logout-all').send({ clientType: 'browser' }).set('Cookie', cookie);
  assert.equal(missing.status, 403); assert.equal(logoutAllCalls.length, 0);
  const valid = await request(app).post('/auth/logout-all').send({ clientType: 'browser' }).set('Cookie', cookie).set('X-CSRF-Token', 'csrf-value');
  assert.equal(valid.status, 204); assert.deepEqual(logoutAllCalls, ['browser-user']);
});
