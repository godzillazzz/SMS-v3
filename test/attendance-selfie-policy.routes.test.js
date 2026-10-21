'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:***@localhost:5432/smsv3_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const Module = require('node:module');
const path = require('node:path');

let role = 'ADMIN';
const policyRows = [
  { role: 'ADMIN', clockInRequired: true, clockOutRequired: false, updatedAt: null },
  { role: 'VIEWER', clockInRequired: false, clockOutRequired: true, updatedAt: null }
];
const policyService = {
  list: async () => policyRows,
  update: async ({ role: policyRole, clockInRequired, clockOutRequired }) => ({
    role: policyRole, clockInRequired, clockOutRequired, updatedAt: null
  })
};

const authFilename = Module._resolveFilename('../src/middlewares/authenticate', module);
require.cache[authFilename] = {
  id: authFilename,
  filename: authFilename,
  loaded: true,
  exports: {
    authenticate: (req, _res, next) => { req.user = { sub: 'user-1', role }; next(); },
    authorize: (...allowed) => (req, _res, next) => allowed.includes(req.user.role)
      ? next()
      : next(Object.assign(new Error('You do not have permission for this action.'), { statusCode: 403 }))
  },
  children: [],
  paths: Module._nodeModulePaths(path.dirname(authFilename))
};
const serviceFilename = Module._resolveFilename('../src/services/attendance-selfie-policy.service', module);
require.cache[serviceFilename] = {
  id: serviceFilename,
  filename: serviceFilename,
  loaded: true,
  exports: {
    ROLES: ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'],
    createAttendanceSelfiePolicyService: () => policyService
  },
  children: [],
  paths: Module._nodeModulePaths(path.dirname(serviceFilename))
};

const operationsRoutes = require('../src/routes/operations.routes');
const app = express();
app.use(express.json());
app.use(operationsRoutes);
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));

const paths = [
  '/attendance/selfie-policies',
  '/operations/attendance/selfie-policies'
];
const rolePaths = [
  '/attendance/selfie-policies/VIEWER',
  '/operations/attendance/selfie-policies/VIEWER'
];

test('canonical and legacy selfie policy routes both require ADMIN', async () => {
  role = 'VIEWER';
  for (const pathName of [...paths, ...rolePaths]) {
    const response = pathName.includes('/VIEWER')
      ? await request(app).put(pathName).send({ clockInRequired: true, clockOutRequired: false })
      : await request(app).get(pathName);
    assert.equal(response.status, 403, pathName);
  }
  role = 'ADMIN';
});

test('canonical and legacy selfie policy routes return equivalent service behavior', async () => {
  role = 'ADMIN';
  const canonicalGet = await request(app).get(paths[0]);
  const legacyGet = await request(app).get(paths[1]);
  assert.equal(canonicalGet.status, 200);
  assert.deepEqual(legacyGet.body, canonicalGet.body);
  assert.equal(legacyGet.headers['cache-control'], 'no-store');

  const payload = { clockInRequired: true, clockOutRequired: false };
  const canonicalPut = await request(app).put(rolePaths[0]).send(payload);
  const legacyPut = await request(app).put(rolePaths[1]).send(payload);
  assert.equal(canonicalPut.status, 200);
  assert.deepEqual(legacyPut.body, canonicalPut.body);
  assert.equal(legacyPut.headers['cache-control'], 'no-store');
});
