'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/smsv3_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-chars';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const Module = require('node:module');
const path = require('node:path');

const model = () => ({
  count: async () => 0,
  findMany: async () => []
});
const prisma = new Proxy({
  $transaction: async (queries) => typeof queries === 'function' ? queries(prisma) : Promise.all(queries),
  user: { findUnique: async () => ({ role: authenticatedUser.role, employeeId: authenticatedUser.employeeId || null, department: authenticatedUser.department || null }), findUniqueOrThrow: async () => ({ role: authenticatedUser.role, employeeId: authenticatedUser.employeeId || null, department: authenticatedUser.department || null }) }
}, {
  get(target, property) {
    if (!(property in target)) target[property] = model();
    return target[property];
  }
});
let authenticatedUser = { sub: 'admin-1', role: 'ADMIN' };
const fakeAuthenticate = (req, _res, next) => {
  req.user = authenticatedUser;
  next();
};

const filename = Module._resolveFilename('../src/config/prisma', module);
require.cache[filename] = { id: filename, filename, loaded: true, exports: prisma, children: [], paths: Module._nodeModulePaths(path.dirname(filename)) };
const authFilename = Module._resolveFilename('../src/middlewares/authenticate', module);
require.cache[authFilename] = { id: authFilename, filename: authFilename, loaded: true, exports: { authenticate: fakeAuthenticate, authorize: () => (_req, _res, next) => next() }, children: [], paths: Module._nodeModulePaths(path.dirname(authFilename)) };
const detailFilename = Module._resolveFilename('../src/services/dashboard-detail.service', module);
require.cache[detailFilename] = { id: detailFilename, filename: detailFilename, loaded: true, exports: {
  getDashboardDetails: async ({ filters, requestUser }) => ({
    metric: filters.metric,
    date: filters.date || '2026-10-10',
    month: filters.month || '2026-10',
    department: requestUser.role === 'ADMIN' ? (filters.department || '') : (requestUser.department || ''),
    page: filters.page || 1,
    pageSize: filters.pageSize || 20,
    total: 0,
    totalPages: 0,
    records: []
  })
}, children: [], paths: Module._nodeModulePaths(path.dirname(detailFilename)) };
const operationsRoutes = require('../src/routes/operations.routes');

const app = express();
app.use(express.json());
app.use('/api/v1', operationsRoutes);
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message, stack: error.stack }));

function assertEnvelope(response, metric) {
  if (response.status !== 200) console.error('dashboard route failure', metric, response.status, response.body);
  assert.equal(response.status, 200, metric);
}

const validQueries = [
  { metric: 'activeEmployees' },
  { metric: 'totalEmployees' },
  { metric: 'schedule', workforce: 'ON_DUTY' },
  { metric: 'leaveToday' },
  { metric: 'pendingLeaves' },
  { metric: 'leaveMonth' },
  { metric: 'leaveMonthStatus', status: 'PENDING' },
  { metric: 'licenseStatus', status: 'PENDING' },
  { metric: 'licenseExpiry', expiryBucket: 'EXPIRING_0_30' },
  { metric: 'pendingUsers' },
  { metric: 'unmatchedQuota' }
];

test('dashboard details HTTP returns the documented envelope for every supported metric', async () => {
  for (const query of validQueries) {
    const response = await request(app).get('/api/v1/dashboard/details').query({ ...query, date: '2026-10-10', month: '2026-10', page: 1, pageSize: 20 });
    assertEnvelope(response, query.metric);
    assert.equal(response.body.data.metric, query.metric);
    assert.ok(Array.isArray(response.body.data.records));
    assert.equal(response.body.data.pageSize, 20);
  }
});

test('dashboard details rejects every required-filter omission at HTTP boundary', async () => {
  for (const query of [
    { metric: 'licenseStatus' },
    { metric: 'leaveMonthStatus' },
    { metric: 'licenseExpiry' }
  ]) {
    const response = await request(app).get('/api/v1/dashboard/details').query(query);
    assert.equal(response.status, 400, query.metric);
    assert.match(response.body.error, /Dashboard detail filter is invalid/);
  }
});

test('dashboard details rejects unknown metrics rather than silently falling back', async () => {
  const response = await request(app).get('/api/v1/dashboard/details').query({ metric: 'not-a-metric' });
  assert.equal(response.status, 400);
});

test('dashboard details route preserves the authenticated role scope context', async () => {
  authenticatedUser = { sub: 'manager-1', role: 'MANAGER', employeeId: 'employee-1', department: 'AN1' };
  const response = await request(app).get('/api/v1/dashboard/details').query({ metric: 'activeEmployees' });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.department, 'AN1');
  authenticatedUser = { sub: 'admin-1', role: 'ADMIN' };
});
