'use strict';

process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const HttpError = require('../src/utils/http-error');

function cacheModule(requestPath, exportsValue) {
  const filename = Module._resolveFilename(requestPath, module);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: exportsValue,
    children: [],
    paths: Module._nodeModulePaths(path.dirname(filename))
  };
}

function delegate(initial = {}) {
  return new Proxy(initial, {
    get(target, property) {
      if (property in target) return target[property];
      const fallback = async () => [];
      target[property] = fallback;
      return fallback;
    }
  });
}

const prisma = delegate({ $transaction: async (callback) => callback({}) });
const audit = { log: async () => ({}) };
const calls = [];
const attendanceTimePolicyService = {
  list: async () => ({ policies: [] }),
  save: async ({ actor, input }) => {
    calls.push({ actor, input });
    return { id: 'company-policy-1', scopeType: 'COMPANY', siteId: null, shiftTypeId: null, policy: input.policy };
  }
};
const fakeAuthenticate = (_req, _res, next) => {
  _req.user = { sub: 'route-admin', role: 'ADMIN' };
  next();
};
const fakeAuthorize = (...roles) => (req, _res, next) => roles.includes(req.user?.role)
  ? next()
  : next(new HttpError(403, 'You do not have permission for this action.'));

cacheModule('../src/config/prisma', prisma);
cacheModule('../src/services/audit.service', audit);
cacheModule('../src/middlewares/authenticate', { authenticate: fakeAuthenticate, authorize: fakeAuthorize });
cacheModule('../src/services/attendance-time-policy.service', {
  createAttendanceTimePolicyService: () => attendanceTimePolicyService
});

const operationsRoutes = require('../src/routes/operations.routes');
const { errorHandler } = require('../src/middlewares/error-handler');
const app = express();
app.use(express.json());
app.use('/api/v1', operationsRoutes);
app.use(errorHandler);

const policy = {
  lateGraceMinutes: 5,
  earliestCheckInEnabled: false,
  earliestCheckInMinutesBeforeStart: 0,
  latestCheckInEnabled: false,
  latestCheckInMinutesAfterStart: null,
  earliestCheckOutEnabled: false,
  earliestCheckOutMinutesAfterStart: 0,
  latestCheckOutEnabled: false,
  latestCheckOutMinutesAfterEnd: null,
  earlyLeaveEnabled: true,
  earlyCheckoutToleranceMinutes: 10,
  missingCheckoutEnabled: true,
  missingCheckoutAfterMinutes: 120,
  maxShiftDurationEnabled: false,
  maxShiftDurationMinutes: null
};

for (const [label, body] of [
  ['SITE scope', { scopeType: 'SITE', siteId: 'site-1', policy }],
  ['SHIFT_TYPE scope', { scopeType: 'SHIFT_TYPE', shiftTypeId: 'shift-1', policy }],
  ['Company with siteId extra', { scopeType: 'COMPANY', siteId: 'site-1', policy }],
  ['Company with shiftTypeId extra', { scopeType: 'COMPANY', shiftTypeId: 'shift-1', policy }]
]) {
  test(`POST time-policies rejects ${label} at the HTTP boundary`, async () => {
    const before = calls.length;
    const response = await request(app).post('/api/v1/attendance/time-policies').send(body);

    assert.equal(response.status, 400);
    assert.match(response.body.error, /^Validation failed(?:\.|:)/);
    assert.ok(response.body.details?.fieldErrors?.scopeType || response.body.details?.formErrors?.length);
    assert.equal(calls.length, before, 'invalid payload must not invoke the policy service');
  });
}

test('POST time-policies accepts a valid Company request through the route service contract', async () => {
  const response = await request(app)
    .post('/api/v1/attendance/time-policies')
    .send({ scopeType: 'COMPANY', effectiveFrom: '2026-10-01T00:00:00.000Z', policy });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.scopeType, 'COMPANY');
  assert.equal(response.body.data.siteId, null);
  assert.equal(response.body.data.shiftTypeId, null);
  assert.equal(calls.at(-1).actor.role, 'ADMIN');
  assert.deepEqual(calls.at(-1).input, { scopeType: 'COMPANY', effectiveFrom: '2026-10-01T00:00:00.000Z', policy });
});
