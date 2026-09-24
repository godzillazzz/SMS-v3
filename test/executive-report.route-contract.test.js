const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const request = require('supertest');
const { authorize } = require('../src/middlewares/authenticate');
const app = require('../src/app');

test('Executive Report endpoint is authenticated, ADMIN/MANAGER/SUPERVISOR, and read-only', async () => {
  const source = fs.readFileSync('src/routes/operations.routes.js', 'utf8');
  assert.match(source, /router\.get\('\/executive-report', authorize\('ADMIN', 'MANAGER', 'SUPERVISOR'\)/);
  assert.doesNotMatch(source, /router\.(post|put|patch|delete)\('\/executive-report'/);
  const nextResult = (middleware, user) => new Promise((resolve) => middleware({ user }, { setHeader() {} }, resolve));
  assert.equal(await nextResult(authorize('ADMIN', 'MANAGER', 'SUPERVISOR'), { role: 'ADMIN' }), undefined);
  assert.equal(await nextResult(authorize('ADMIN', 'MANAGER', 'SUPERVISOR'), { role: 'MANAGER' }), undefined);
  assert.equal(await nextResult(authorize('ADMIN', 'MANAGER', 'SUPERVISOR'), { role: 'SUPERVISOR' }), undefined);
  assert.equal((await nextResult(authorize('ADMIN', 'MANAGER', 'SUPERVISOR'), { role: 'VIEWER' })).statusCode, 403);
  assert.equal((await request(app).get('/api/v1/executive-report')).status, 401);
});

test('Executive Report uses bounded validated Gregorian period filters', () => {
  const source = fs.readFileSync('src/routes/operations.routes.js', 'utf8');
  assert.match(source, /const executiveReportQuery = z\.object/);
  assert.match(source, /month: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(12\)/);
  assert.match(source, /year: z\.coerce\.number\(\)\.int\(\)\.min\(2020\)\.max\(2100\)/);
});
