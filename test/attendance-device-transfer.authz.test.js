'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const Module = require('node:module');
const path = require('node:path');
const HttpError = require('../src/utils/http-error');

const state = {
  enrollment: { id: 'enrollment-1', status: 'ACTIVE', employeeId: 'employee-1' },
  request: { id: 'request-1', status: 'PENDING_APPROVAL', candidateDeviceEnrollmentId: 'enrollment-2' }
};
const authFilename = Module._resolveFilename('../src/middlewares/authenticate', module);
const serviceFilename = Module._resolveFilename('../src/services/attendance-device.service', module);
const authenticate = (req, _res, next) => {
  const token = req.headers.authorization;
  if (!token) return next(new HttpError(401, 'Authentication required.'));
  req.user = { sub: 'user-' + token.slice(7).toLowerCase(), role: token.slice(7) };
  return next();
};
const authorize = (...roles) => (req, _res, next) => roles.includes(req.user.role)
  ? next() : next(new HttpError(403, 'You do not have permission for this action.'));
require.cache[authFilename] = { id: authFilename, filename: authFilename, loaded: true,
  exports: { authenticate, authorize }, children: [], paths: Module._nodeModulePaths(path.dirname(authFilename)) };
const service = {
  listRequests: async () => [state.request],
  approve: async () => { state.request = { ...state.request, status: 'APPROVED' }; state.enrollment = { ...state.enrollment, status: 'REVOKED' }; return state.request; },
  reject: async () => { state.request = { ...state.request, status: 'REJECTED' }; return state.request; }
};
require.cache[serviceFilename] = { id: serviceFilename, filename: serviceFilename, loaded: true,
  exports: { createAttendanceDeviceService: () => service }, children: [], paths: Module._nodeModulePaths(path.dirname(serviceFilename)) };
const router = require('../src/routes/attendance-device-transfer.routes');
const app = express();
app.use(express.json());
app.use('/api/v1/admin/attendance/device-transfers', router);
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
const id = '11111111-1111-4111-8111-111111111111';

test.beforeEach(() => {
  state.enrollment = { id: 'enrollment-1', status: 'ACTIVE', employeeId: 'employee-1' };
  state.request = { id: 'request-1', status: 'PENDING_APPROVAL', candidateDeviceEnrollmentId: 'enrollment-2' };
});

test('device transfer GET ADMIN positive control', async () => {
  assert.equal((await request(app).get('/api/v1/admin/attendance/device-transfers').set('Authorization', 'Bearer ADMIN')).status, 200);
});

test('device transfer approve and reject ADMIN positive controls', async () => {
  assert.equal((await request(app).post(`/api/v1/admin/attendance/device-transfers/${id}/approve`).set('Authorization', 'Bearer ADMIN')).status, 200);
  state.request = { id: 'request-1', status: 'PENDING_APPROVAL', candidateDeviceEnrollmentId: 'enrollment-2' };
  assert.equal((await request(app).post(`/api/v1/admin/attendance/device-transfers/${id}/reject`).set('Authorization', 'Bearer ADMIN').send({ reason: 'valid reason' })).status, 200);
});

test('device transfer list and mutations deny every non-ADMIN role without mutation', async () => {
  for (const role of ['MANAGER', 'SUPERVISOR', 'VIEWER']) {
    const before = structuredClone(state);
    assert.equal((await request(app).get('/api/v1/admin/attendance/device-transfers').set('Authorization', `Bearer ${role}`)).status, 403);
    assert.equal((await request(app).post(`/api/v1/admin/attendance/device-transfers/${id}/approve`).set('Authorization', `Bearer ${role}`)).status, 403);
    assert.equal((await request(app).post(`/api/v1/admin/attendance/device-transfers/${id}/reject`).set('Authorization', `Bearer ${role}`).send({ reason: 'denied role' })).status, 403);
    assert.deepEqual(state, before, `${role} changed enrollment/request state`);
  }
});

test('device transfer endpoints require a token', async () => {
  assert.equal((await request(app).get('/api/v1/admin/attendance/device-transfers')).status, 401);
  assert.equal((await request(app).post(`/api/v1/admin/attendance/device-transfers/${id}/approve`)).status, 401);
  assert.equal((await request(app).post(`/api/v1/admin/attendance/device-transfers/${id}/reject`).send({ reason: 'missing token' })).status, 401);
});
