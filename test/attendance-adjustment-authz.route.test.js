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
      approve: async () => ({ id: '22222222-2222-4222-2222-222222222222', status: 'APPROVED' }),
      reject: async () => ({ id: '22222222-2222-4222-2222-222222222222', status: 'REJECTED' }),
      returnForCorrection: async () => ({ id: '22222222-2222-4222-2222-222222222222', status: 'RETURNED_FOR_CORRECTION' })
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

// ROUTE MATRIX LOCK — OWNER policy 18 Oct 2026 (docs/GOVERNANCE_ATTENDANCE_ADJUSTMENT_RBAC.md):
// maker routes = ADMIN/MANAGER/SUPERVISOR/VIEWER · decision routes = executive roles.
// This file proves the per-route authorize matrix. Service-level rules (7-day backdate,
// VIEWER ownership, read scope, maker-only submit) are covered by the dedicated
// attendance-adjustment service tests.
test('adjustment route: all executive roles may execute decisions and VIEWER is denied', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR']) {
    actor = { sub: `${role.toLowerCase()}-1`, role };
    assert.equal((await post(`/${requestId}/approve`)).status, 200, `${role} approve must pass`);
    assert.equal((await post(`/${requestId}/reject`, { comment: 'not approved' })).status, 200, `${role} reject must pass`);
    assert.equal((await post(`/${requestId}/return`, { comment: 'please correct' })).status, 200, `${role} return must pass`);
  }
  actor = { sub: 'viewer-1', role: 'VIEWER' };
  assert.equal((await post(`/${requestId}/approve`)).status, 403, 'VIEWER approve must be denied');
  assert.equal((await post(`/${requestId}/reject`, { comment: 'not approved' })).status, 403, 'VIEWER reject must be denied');
  assert.equal((await post(`/${requestId}/return`, { comment: 'please correct' })).status, 403, 'VIEWER return must be denied');
});

test('adjustment route: every executive and linked-employee role may create (middleware level)', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']) {
    actor = { sub: `${role.toLowerCase()}-1`, role, employeeAuthority: { id: 'employee-1' } };
    assert.equal((await post('/', draft)).status, 201, `${role} create must pass the route guard`);
  }
});
