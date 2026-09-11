'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const HttpError = require('../src/utils/http-error');

const calls = [];
const fakeService = {
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
