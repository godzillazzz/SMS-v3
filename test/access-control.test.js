process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_LIMIT_MAX = '2';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { authorize } = require('../src/middlewares/authenticate');
const loginRateLimit = require('../src/middlewares/login-rate-limit');
const app = require('../src/app');

function nextResult(middleware, req) { return new Promise((resolve) => middleware(req, { setHeader() {} }, resolve)); }
test('ADMIN, MANAGER, and VIEWER authorization is enforced', async () => {
  assert.equal(await nextResult(authorize('ADMIN'), { user: { role: 'ADMIN' } }), undefined);
  assert.equal((await nextResult(authorize('ADMIN'), { user: { role: 'MANAGER' } })).statusCode, 403);
  assert.equal((await nextResult(authorize('ADMIN'), { user: { role: 'VIEWER' } })).statusCode, 403);
  assert.equal((await nextResult(authorize('ADMIN', 'MANAGER'), { user: { role: 'VIEWER' } })).statusCode, 403);
  assert.equal(await nextResult(authorize('ADMIN', 'MANAGER'), { user: { role: 'MANAGER' } }), undefined);
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
  const lifecycleResponse = await request(app).get('/api/v1/employees/11111111-1111-4111-8111-111111111111/lifecycle');
  assert.equal(lifecycleResponse.status, 401);
  assert.equal(lifecycleResponse.body.error, 'Authentication required.');
});
test('all operational data endpoints reject unauthenticated requests', async () => {
  for (const path of ['/api/v1/dashboard', '/api/v1/licenses', '/api/v1/shift-types', '/api/v1/shifts', '/api/v1/schedule-calendar?month=2026-07', '/api/v1/schedule-approvals', '/api/v1/scheduling-rules', '/api/v1/rule-checks?month=2026-07', '/api/v1/system-settings', '/api/v1/leave-requests', '/api/v1/leave-summary', '/api/v1/leave-quotas', '/api/v1/audit-events', '/api/v1/reports/summary']) {
    const response = await request(app).get(path);
    assert.equal(response.status, 401, path);
    assert.equal(response.body.error, 'Authentication required.', path);
  }
});
test('all operational mutation endpoints reject unauthenticated requests', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const requests = [
    request(app).post('/api/v1/licenses').send({}),
    request(app).put(`/api/v1/licenses/${id}`).send({}),
    request(app).delete(`/api/v1/licenses/${id}`),
    request(app).post(`/api/v1/licenses/${id}/documents`).field('proposedStartDate', '2026-01-01'),
    request(app).get(`/api/v1/licenses/${id}/documents`),
    request(app).get(`/api/v1/license-documents/${id}/view`),
    request(app).post(`/api/v1/license-documents/${id}/approve`).send({}),
    request(app).post(`/api/v1/license-documents/${id}/reject`).send({ rejectionReason: 'test' }),
    request(app).post('/api/v1/shift-types').send({}),
    request(app).delete(`/api/v1/shift-types/${id}`),
    request(app).post('/api/v1/shifts').send({}),
    request(app).post('/api/v1/schedule/auto-preview').send({ month: '2026-07' }),
    request(app).post('/api/v1/schedule/auto-commit').send({ month: '2026-07' }),
    request(app).post('/api/v1/schedule/employee-auto-preview').send({ month: '2026-07', employeeId: id }),
    request(app).post('/api/v1/schedule/employee-auto-commit').send({ month: '2026-07', employeeId: id }),
    request(app).post('/api/v1/schedule/export.xlsx').send({ month: '2026-07', scope: 'all', departments: [] }),
    request(app).put(`/api/v1/shifts/${id}`).send({}),
    request(app).delete(`/api/v1/shifts/${id}`),
    request(app).put(`/api/v1/schedule-approvals/${id}`).send({}),
    request(app).put(`/api/v1/scheduling-rules/${id}`).send({}),
    request(app).put('/api/v1/system-settings/UI_LABEL').send({}),
    request(app).post('/api/v1/leave-requests').send({}),
    request(app).post('/api/v1/leave-requests/with-attachment').field('leaveType', 'Sick'),
    request(app).get(`/api/v1/leave-requests/${id}/attachment`),
    request(app).put(`/api/v1/leave-requests/${id}`).send({}),
    request(app).put(`/api/v1/leave-quotas/${id}`).send({}),
    request(app).put(`/api/v1/users/${id}`).send({}),
    request(app).post(`/api/v1/users/${id}/reset-password`).send({}),
    request(app).post(`/api/v1/users/${id}/view-as`).send({}),
    request(app).post(`/api/v1/employees/${id}/lifecycle/preflight`).send({}),
    request(app).post(`/api/v1/employees/${id}/lifecycle`).send({})
  ];
  for (const pendingRequest of requests) {
    const response = await pendingRequest;
    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication required.');
  }
});
