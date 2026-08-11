const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const request = require('supertest');
const { authorize } = require('../src/middlewares/authenticate');
const app = require('../src/app');

test('data quality route is mounted under the API router and is read-only ADMIN-only', () => {
  const route = fs.readFileSync('src/routes/data-quality.routes.js', 'utf8');
  const index = fs.readFileSync('src/routes/index.js', 'utf8');
  assert.match(route, /router\.get\('\/issues'/);
  assert.match(route, /authenticate/);
  assert.match(route, /authorize\('ADMIN'\)/);
  assert.doesNotMatch(route, /router\.(post|put|patch|delete)\(/);
  assert.match(index, /router\.use\('\/data-quality', dataQualityRoutes\)/);
});

test('ADMIN-only access contract allows ADMIN and rejects MANAGER/VIEWER/unauthenticated', async () => {
  const nextResult = (middleware, user) => new Promise((resolve) => middleware({ user }, { setHeader() {} }, resolve));
  assert.equal(await nextResult(authorize('ADMIN'), { role: 'ADMIN' }), undefined);
  assert.equal((await nextResult(authorize('ADMIN'), { role: 'MANAGER' })).statusCode, 403);
  assert.equal((await nextResult(authorize('ADMIN'), { role: 'VIEWER' })).statusCode, 403);
  assert.equal((await request(app).get('/api/v1/data-quality/issues')).status, 401);
});
