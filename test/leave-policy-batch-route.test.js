'use strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/smsv3_test';
process.env.JWT_SECRET = 'leave-policy-batch-test-secret-minimum-length';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { DEFAULT_LEAVE_POLICY } = require('../src/services/leave-policy.service');
const auth = require('../src/middlewares/authenticate');
auth.authenticate = (req, res, next) => { if (!req.headers['x-test-role']) return res.sendStatus(401); req.user = { sub: 'admin', role: req.headers['x-test-role'] }; next(); };
const prisma = require('../src/config/prisma');
let transactions = 0;
prisma.$transaction = async (fn) => { transactions++; return fn({ systemSetting: { findUnique: async () => null, upsert: async ({ create }) => create } }); };
const audit = require('../src/services/audit.service');
audit.log = async () => {};
const app = express();
app.use(express.json());
app.use(require('../src/routes/operations.routes'));
app.use(require('../src/middlewares/error-handler').errorHandler);

test('batch endpoint permits only ADMIN and requires authentication', async () => {
  transactions = 0;
  for (const role of ['MANAGER', 'SUPERVISOR', 'VIEWER']) {
    const response = await request(app).put('/leave-policy').set('x-test-role', role).send(DEFAULT_LEAVE_POLICY);
    assert.equal(response.status, 403);
  }
  assert.equal((await request(app).put('/leave-policy').send(DEFAULT_LEAVE_POLICY)).status, 401);
  assert.equal(transactions, 0);
  const response = await request(app).put('/leave-policy').set('x-test-role', 'ADMIN').send(DEFAULT_LEAVE_POLICY);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.data.length, 10);
  assert.equal(transactions, 1);
});

test('batch endpoint rejects malformed policy without starting transaction', async () => {
  transactions = 0;
  const response = await request(app).put('/leave-policy').set('x-test-role', 'ADMIN').send({ ...DEFAULT_LEAVE_POLICY, viewerRetroactiveMaxDaysBack: -5 });
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.equal(transactions, 0);
});
