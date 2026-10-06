'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const request = require('supertest');
const HttpError = require('../src/utils/http-error');

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

const prisma = delegate({
  $transaction: async (callback) => callback({}),
  user: delegate(),
  scheduleApproval: delegate()
});
const audit = { log: async () => ({}) };
const notifications = { notifyScheduleApproved: async () => ({}) };
const fakeAuthenticate = (_req, _res, next) => next();
const fakeAuthorize = (...roles) => (req, _res, next) => roles.includes(req.user?.role)
  ? next()
  : next(new HttpError(403, 'You do not have permission for this action.'));

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

cacheModule('../src/config/prisma', prisma);
cacheModule('../src/services/audit.service', audit);
cacheModule('../src/services/notification-email.service', notifications);
cacheModule('../src/middlewares/authenticate', { authenticate: fakeAuthenticate, authorize: fakeAuthorize });

const operationsRoutes = require('../src/routes/operations.routes');
const { errorHandler } = require('../src/middlewares/error-handler');

const approvalId = '8a8a8a8a-8a8a-48a8-88a8-8a8a8a8a8a8a';
const month = new Date('2026-09-01T00:00:00.000Z');

function approval(status = 'PENDING', revision = 3) {
  return {
    id: approvalId,
    month,
    status,
    revision,
    changeType: 'BATCH_UPDATE_SHIFT',
    approvedAt: status === 'APPROVED' ? new Date('2026-09-02T00:00:00.000Z') : null,
    approvedByLegacyRef: status === 'APPROVED' ? 'previous-admin' : null,
    approvalNote: null
  };
}

function appFor(t, initialApproval, newerRevision = null) {
  const state = {
    approval: structuredClone(initialApproval),
    newerRevision: newerRevision ? structuredClone(newerRevision) : null,
    listedRows: [structuredClone(initialApproval), ...(newerRevision ? [structuredClone(newerRevision)] : [])],
    updateCalls: 0
  };
  const tx = {
    scheduleApproval: {
      findUniqueOrThrow: async () => structuredClone(state.approval),
      findFirst: async ({ where }) => where.revision?.gt !== undefined
        ? (state.newerRevision ? structuredClone(state.newerRevision) : null)
        : structuredClone(state.approval),
      update: async ({ data }) => {
        state.updateCalls += 1;
        state.approval = { ...state.approval, ...data };
        return structuredClone(state.approval);
      }
    },
    auditLog: { create: async () => ({}) }
  };

  prisma.$transaction = async (operation) => typeof operation === 'function' ? operation(tx) : Promise.all(operation);
  prisma.user.findUnique = async () => ({ displayName: 'ผู้ดูแลทดสอบ' });
  prisma.user.findMany = async () => [];
  prisma.scheduleApproval.count = async () => state.listedRows.length;
  prisma.scheduleApproval.findMany = async () => structuredClone(state.listedRows);
  prisma.scheduleApproval.groupBy = async () => {
    const rowsByMonth = new Map();
    for (const row of state.listedRows) {
      const key = new Date(row.month).getTime();
      rowsByMonth.set(key, Math.max(rowsByMonth.get(key) || 0, row.revision));
    }
    return [...rowsByMonth.entries()].map(([monthKey, revision]) => ({ month: new Date(monthKey), _max: { revision } }));
  };
  audit.log = async () => ({});
  notifications.notifyScheduleApproved = async () => ({});

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { sub: 't04-admin', role: 'ADMIN' };
    next();
  });
  app.use('/api/v1', operationsRoutes);
  app.use(errorHandler);
  return { app, state };
}

test('schedule approval API approves a pending latest revision', async (t) => {
  const { app, state } = appFor(t, approval('PENDING', 3));
  const response = await request(app)
    .put(`/api/v1/schedule-approvals/${approvalId}`)
    .send({ status: 'APPROVED', approvalNote: 'ตรวจสอบแล้ว' });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, 'APPROVED');
  assert.equal(state.approval.status, 'APPROVED');
  assert.equal(state.approval.revision, 4);
  assert.equal(state.updateCalls, 1);
});

test('schedule approval API rejects a decision on an already approved row without changing it', async (t) => {
  const before = approval('APPROVED', 3);
  const { app, state } = appFor(t, before);
  const response = await request(app)
    .put(`/api/v1/schedule-approvals/${approvalId}`)
    .send({ status: 'REJECTED', approvalNote: 'แก้ไขให้ถูกต้อง' });

  assert.equal(response.status, 409);
  assert.equal(response.body.details.code, 'SCHEDULE_APPROVAL_INVALID_STATE');
  assert.deepEqual(state.approval, before);
  assert.equal(state.updateCalls, 0);
});

for (const status of ['PENDING', 'DRAFT']) {
  test(`schedule approval API prevents an approved row from reverting to ${status}`, async (t) => {
    const before = approval('APPROVED', 3);
    const approvedAt = before.approvedAt;
    const { app, state } = appFor(t, before);
    const response = await request(app)
      .put(`/api/v1/schedule-approvals/${approvalId}`)
      .send({ status });

    assert.equal(response.status, 409);
    assert.equal(response.body.details.code, 'SCHEDULE_APPROVAL_INVALID_STATE');
    assert.deepEqual(state.approval, before);
    assert.equal(state.approval.approvedAt.getTime(), approvedAt.getTime());
    assert.equal(state.updateCalls, 0);
  });
}

test('schedule approval API rejects a decision on a superseded revision', async (t) => {
  const before = approval('PENDING', 3);
  const { app, state } = appFor(t, before, { id: 'newer-row', revision: 4 });
  const response = await request(app)
    .put(`/api/v1/schedule-approvals/${approvalId}`)
    .send({ status: 'APPROVED' });

  assert.equal(response.status, 409);
  assert.equal(response.body.details.code, 'SCHEDULE_APPROVAL_SUPERSEDED');
  assert.deepEqual(state.approval, before);
  assert.equal(state.updateCalls, 0);
});

test('schedule approval API requires at least five reason characters before rejecting', async (t) => {
  const before = approval('PENDING', 3);
  const { app, state } = appFor(t, before);
  const response = await request(app)
    .put(`/api/v1/schedule-approvals/${approvalId}`)
    .send({ status: 'REJECTED', approvalNote: '  ab  ' });

  assert.equal(response.status, 400);
  assert.equal(response.body.details.code, 'SCHEDULE_REJECTION_REASON_REQUIRED');
  assert.deepEqual(state.approval, before);
  assert.equal(state.updateCalls, 0);
});

test('schedule approval list identifies the latest revision for each month', async (t) => {
  const older = approval('PENDING', 3);
  const latest = { ...approval('PENDING', 4), id: '9b9b9b9b-9b9b-49b9-89b9-9b9b9b9b9b9b' };
  const { app } = appFor(t, older, latest);
  const response = await request(app).get('/api/v1/schedule-approvals?page=1&pageSize=100');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((row) => row.isLatestRevision), [false, true]);
});
