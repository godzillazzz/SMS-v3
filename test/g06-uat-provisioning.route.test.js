'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const HttpError = require('../src/utils/http-error');

const calls = [];
const authorityCalls = [];
const fakeService = {
  prepareAttendanceAuthority: async ({ actorUserId, location }) => {
    authorityCalls.push({ actorUserId, location });
    return {
      idempotent: false,
      workDate: '2026-09-28T00:00:00.000Z',
      assignment: { id: '66666666-6666-4666-8666-666666666666', source: 'G06_PREVIEW_UAT', locked: true },
      shift: { code: 'D', name: 'ZZZ UAT Day', startTime: '07:00', endTime: '19:00' },
      site: { id: '55555555-5555-4555-8555-555555555555', code: 'SITE-A', name: 'Test Site', geofenceRadiusMeters: 100 },
      approval: { status: 'APPROVED', revision: 2, month: '2026-09-01T00:00:00.000Z' },
      provisioningPath: 'GOVERNED_PREVIEW_ONLY',
      previewDatabaseTarget: 'verified'
    };
  },
  provision: async ({ actorUserId }) => {
    calls.push(actorUserId);
    return {
      created: true,
      duplicate: false,
      employee: { id: '11111111-1111-4111-8111-111111111111', employeeCode: 'UAT-G06-20260911-01', displayName: 'G06 Preview UAT', department: 'UAT-PREVIEW', jobTitle: 'Officer', isActive: true, deleted: false, accountLinked: true },
      account: { id: '22222222-2222-4222-8222-222222222222', email: 'uat-g06-20260911-01@example.invalid', displayName: 'G06 Preview UAT', role: 'VIEWER', employeeId: '11111111-1111-4111-8111-111111111111', isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false },
      temporaryPassword: 'x'.repeat(20),
      provisioningPath: 'GOVERNED_PREVIEW_ONLY',
      otpPublicFlowChanged: false,
      previewDatabaseTarget: 'verified'
    };
  }
};

require.cache[require.resolve('../src/services/g06-uat-provisioning.service')] = { exports: { createG06UatProvisioningService: () => fakeService } };
require.cache[require.resolve('../src/middlewares/authenticate')] = { exports: {
  authenticate: (req, _res, next) => {
    const role = req.get('x-test-role');
    if (!role) return next(new HttpError(401, 'Authentication required.'));
    req.user = { sub: `${role.toLowerCase()}-user`, role };
    return next();
  },
  authorize: (...roles) => (req, _res, next) => roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'Forbidden.'))
} };

const route = require('../src/routes/g06-uat-provisioning.routes');
const { errorHandler } = require('../src/middlewares/error-handler');
const app = express();
app.use(express.json());
app.use('/admin/g06-uat', route);
app.use(errorHandler);

test('anonymous and non-ADMIN callers are denied', async () => {
  assert.equal((await request(app).post('/admin/g06-uat/provision').send({})).status, 401);
  assert.equal((await request(app).post('/admin/g06-uat/provision').set('x-test-role', 'VIEWER').send({})).status, 403);
  assert.equal(calls.length, 0);
});

test('route rejects client-supplied target or role fields', async () => {
  const response = await request(app).post('/admin/g06-uat/provision').set('x-test-role', 'ADMIN').send({ employeeCode: 'REAL-EMPLOYEE', role: 'ADMIN' });
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test('ADMIN route invokes fixed Preview-only service and does not cache response', async () => {
  const response = await request(app).post('/admin/g06-uat/provision').set('x-test-role', 'ADMIN').send({});
  assert.equal(response.status, 201);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.data.employee.employeeCode, 'UAT-G06-20260911-01');
  assert.equal(response.body.data.account.role, 'VIEWER');
  assert.deepEqual(calls, ['admin-user']);
});

test('Attendance authority route is ADMIN-only, validates GPS, and does not cache response', async () => {
  const body = { location: { latitude: 13.7563, longitude: 100.5018, accuracyMeters: 6, capturedAt: '2026-09-28T09:17:00.000Z' } };
  assert.equal((await request(app).post('/admin/g06-uat/attendance-authority').send(body)).status, 401);
  assert.equal((await request(app).post('/admin/g06-uat/attendance-authority').set('x-test-role', 'VIEWER').send(body)).status, 403);
  assert.equal(authorityCalls.length, 0);

  const invalid = await request(app).post('/admin/g06-uat/attendance-authority').set('x-test-role', 'ADMIN').send({ location: { ...body.location, latitude: 999 } });
  assert.equal(invalid.status, 400);
  assert.equal(authorityCalls.length, 0);

  const response = await request(app).post('/admin/g06-uat/attendance-authority').set('x-test-role', 'ADMIN').send(body);
  assert.equal(response.status, 201);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.data.assignment.source, 'G06_PREVIEW_UAT');
  assert.equal(response.body.data.site.code, 'SITE-A');
  assert.equal(response.body.data.approval.status, 'APPROVED');
  assert.equal(authorityCalls.length, 1);
  assert.equal(authorityCalls[0].actorUserId, 'admin-user');
  assert.deepEqual(authorityCalls[0].location, body.location);
});
