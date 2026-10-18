'use strict';

process.env.NODE_ENV = 'test';
process.env.ATTENDANCE_API_PREVIEW_ENABLED = 'true';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@fixture.example.com:5432/smsv3';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const Module = require('node:module');
const path = require('node:path');

let actor = { sub: 'employee-1', role: 'EMPLOYEE' };
const authenticate = (req, _res, next) => { req.user = actor; next(); };
const actualAuthorize = require('../src/middlewares/authenticate').authorize;
const authFilename = Module._resolveFilename('../src/middlewares/authenticate', module);
require.cache[authFilename] = {
  id: authFilename,
  filename: authFilename,
  loaded: true,
  exports: { authenticate, authorize: actualAuthorize },
  children: [],
  paths: Module._nodeModulePaths(path.dirname(authFilename))
};

const serviceFilename = Module._resolveFilename('../src/services/attendance-adjustment.service', module);
require.cache[serviceFilename] = {
  id: serviceFilename,
  filename: serviceFilename,
  loaded: true,
  exports: {
    createAttendanceAdjustmentService: () => ({
      createDraft: async () => ({ id: '22222222-2222-4222-8222-222222222222', status: 'DRAFT' }),
      submit: async () => ({ id: '22222222-2222-4222-8222-222222222222', status: 'PENDING_APPROVAL' }),
      approve: async () => ({ id: '22222222-2222-4222-8222-222222222222', status: 'APPROVED' })
    })
  },
  children: [],
  paths: Module._nodeModulePaths(path.dirname(serviceFilename))
};

process.env.VERCEL_ENV = 'preview';
const { router } = require('../src/routes/attendance-adjustment.routes');
const app = express();
app.use(express.json());
app.use('/api/v1/attendance/adjustment-requests', router);
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));

const assignmentId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const draft = {
  assignmentId,
  requestType: 'CONFIRM_WORK_PERFORMED',
  proposal: { checkInAt: '2026-10-17T01:00:00.000Z', checkOutAt: '2026-10-17T09:00:00.000Z' },
  reason: 'Employee confirmation'
};

async function post(path, body = {}) {
  return request(app).post(`/api/v1/attendance/adjustment-requests${path}`).send(body);
}

test('adjustment route: decision actions are ADMIN-only', async () => {
  actor = { sub: 'admin-1', role: 'ADMIN' };
  assert.equal((await post(`/${requestId}/approve`)).status, 200, 'ADMIN approve positive control');

  for (const role of ['MANAGER', 'SUPERVISOR', 'EMPLOYEE', 'VIEWER']) {
    actor = { sub: `${role.toLowerCase()}-1`, role };
    assert.equal((await post(`/${requestId}/approve`)).status, 403, `${role} approve must be denied`);
    assert.equal((await post(`/${requestId}/reject`)).status, 403, `${role} reject must be denied`);
    assert.equal((await post(`/${requestId}/return`)).status, 403, `${role} return must be denied`);
  }
});

test('adjustment route: maker access follows governed per-route roles', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'EMPLOYEE']) {
    actor = { sub: `${role.toLowerCase()}-1`, role };
    assert.equal((await post('/', draft)).status, 201, `${role} create currently allowed`);
  }
  for (const role of ['SUPERVISOR', 'VIEWER']) {
    actor = { sub: `${role.toLowerCase()}-1`, role };
    assert.equal((await post('/', draft)).status, 403, `${role} create must be denied`);
  }
});

test('adjustment route: read authorization allows governed roles and denies VIEWER', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR', 'EMPLOYEE']) {
    actor = { sub: `${role.toLowerCase()}-1`, role };
    assert.notEqual((await request(app).get('/api/v1/attendance/adjustment-requests')).status, 403, `${role} list route is allowed`);
    assert.notEqual((await request(app).get(`/api/v1/attendance/adjustment-requests/${requestId}`)).status, 403, `${role} get route is allowed`);
  }
  actor = { sub: 'viewer-1', role: 'VIEWER' };
  assert.equal((await request(app).get('/api/v1/attendance/adjustment-requests')).status, 403);
  assert.equal((await request(app).get(`/api/v1/attendance/adjustment-requests/${requestId}`)).status, 403);
});

test('adjustment route: PUT and submit are maker-only routes', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'EMPLOYEE']) {
    actor = { sub: `${role.toLowerCase()}-1`, role };
    assert.notEqual((await request(app).put(`/api/v1/attendance/adjustment-requests/${requestId}`).send({ requestType: draft.requestType, proposal: draft.proposal, reason: draft.reason })).status, 403, `${role} revise route is allowed`);
    assert.notEqual((await post(`/${requestId}/submit`)).status, 403, `${role} submit route is allowed`);
  }
  for (const role of ['SUPERVISOR', 'VIEWER']) {
    actor = { sub: `${role.toLowerCase()}-1`, role };
    assert.equal((await request(app).put(`/api/v1/attendance/adjustment-requests/${requestId}`).send({ requestType: draft.requestType, proposal: draft.proposal, reason: draft.reason })).status, 403, `${role} revise must be denied`);
    assert.equal((await post(`/${requestId}/submit`)).status, 403, `${role} submit must be denied`);
  }
});
