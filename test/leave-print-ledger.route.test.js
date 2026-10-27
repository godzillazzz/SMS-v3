'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:password@localhost:5432/smsv3_test';
process.env.JWT_SECRET = 'leave-print-ledger-test-secret-minimum-length';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const env = require('../src/config/env');
const { leaveRequestListActorScopeWhere } = require('../src/utils/leave-request-list-scope');

const auditPath = Module._resolveFilename('../src/services/audit.service', module);
require.cache[auditPath] = {
  id: auditPath,
  filename: auditPath,
  loaded: true,
  exports: new Proxy({}, { get: () => async () => { throw new Error('leave print ledger must not audit'); } }),
  children: [],
  paths: Module._nodeModulePaths(path.dirname(auditPath))
};

const ids = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  manager: 'a0000000-0000-4000-8000-000000000002',
  supervisor: 'a0000000-0000-4000-8000-000000000003',
  viewer: 'a0000000-0000-4000-8000-000000000004',
  employee: 'b0000000-0000-4000-8000-000000000001',
  leave: 'c0000000-0000-4000-8000-000000000001',
  missing: 'c0000000-0000-4000-8000-000000000099'
};
const calls = [];
let currentLeave;
let priorLeaves = [];
let quota;
let legacyQuotas = [];
let dueLifecycleEvent = null;
const roleById = new Map(Object.entries({
  [ids.admin]: 'ADMIN',
  [ids.manager]: 'MANAGER',
  [ids.supervisor]: 'SUPERVISOR',
  [ids.viewer]: 'VIEWER'
}));
const users = {
  findUnique: async ({ where }) => {
    calls.push('user.findUnique');
    const role = roleById.get(where.id);
    if (!role) return null;
    return {
      id: where.id,
      role,
      employeeId: ids.employee,
      isActive: true,
      accountStatus: 'ACTIVE',
      passwordResetRequired: false,
      tokenVersion: 0,
      employee: { id: ids.employee, isActive: true, deletedAt: null }
    };
  }
};
const leaveRequests = {
  findFirst: async ({ where }) => {
    calls.push({ method: 'leaveRequest.findFirst', where });
    const predicates = Array.isArray(where.AND) ? where.AND : [where];
    if (predicates.some((predicate) => predicate.id && predicate.id !== currentLeave?.id)) return null;
    if (predicates.some((predicate) => predicate.employeeId && predicate.employeeId !== currentLeave.employeeId)) return null;
    return currentLeave;
  },
  findUnique: async ({ where }) => {
    calls.push({ method: 'leaveRequest.findUnique', where });
    return where.id === currentLeave?.id ? currentLeave : null;
  },
  findMany: async (query) => {
    calls.push({ method: 'leaveRequest.findMany', query });
    const where = query?.where || {};
    return priorLeaves.filter((row) => row.employeeId === where.employeeId
      && row.status === where.status
      && row.id !== where.id?.not
      && row.startDate < where.startDate.lt
      && row.endDate >= where.endDate.gte);
  }
};
const leaveQuotas = {
  findUnique: async (query) => {
    calls.push({ method: 'leaveQuota.findUnique', query });
    return quota;
  },
  findMany: async (query) => {
    calls.push({ method: 'leaveQuota.findMany', query });
    return legacyQuotas;
  }
};
const prisma = new Proxy({
  user: users,
  employeeLifecycleEvent: {
    findMany: async (query) => {
      calls.push({ method: 'employeeLifecycleEvent.findMany', query });
      return dueLifecycleEvent ? [dueLifecycleEvent] : [];
    }
  },
  leaveRequest: leaveRequests,
  leaveQuota: leaveQuotas
}, {
  get(target, property) {
    if (property in target) return target[property];
    throw new Error(`Unexpected Prisma access: ${String(property)}`);
  }
});
const prismaPath = Module._resolveFilename('../src/config/prisma', module);
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: prisma,
  children: [],
  paths: Module._nodeModulePaths(path.dirname(prismaPath))
};
const router = require('../src/routes/leave-print-ledger.routes');
const { errorHandler } = require('../src/middlewares/error-handler');
const { getLeavePrintLedger } = require('../src/services/leave-print-ledger.service');
const app = express();
app.use('/api/v1/leave-requests', router);
app.use(errorHandler);

function token(userId) {
  return jwt.sign({ sub: userId, tokenVersion: 0 }, env.jwtSecret, {
    algorithm: env.jwtAlgorithm,
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    expiresIn: '5m'
  });
}
function auth(role) {
  const userId = { ADMIN: ids.admin, MANAGER: ids.manager, SUPERVISOR: ids.supervisor, VIEWER: ids.viewer }[role];
  return `Bearer ${token(userId)}`;
}
function makeLeave(overrides = {}) {
  return {
    id: ids.leave,
    employeeId: ids.employee,
    status: 'APPROVED',
    leaveType: 'SICK',
    leaveTypeNameSnapshot: 'ชื่อประเภทเดิมที่ไม่ตรงกับ bucket',
    leaveQuotaBucketSnapshot: 'VACATION',
    startDate: new Date('2026-01-10T00:00:00.000Z'),
    endDate: new Date('2026-01-11T00:00:00.000Z'),
    dayCount: 2,
    ...overrides
  };
}
function resetFixtures(overrides = {}) {
  calls.length = 0;
  dueLifecycleEvent = null;
  currentLeave = makeLeave(overrides.currentLeave);
  priorLeaves = overrides.priorLeaves || [];
  legacyQuotas = overrides.legacyQuotas || [];
  quota = overrides.quota === undefined ? {
    employeeId: ids.employee,
    quotaYear: 2026,
    matchStatus: 'MATCHED',
    vacationLeave: 6,
    sickLeave: 30,
    personalLeave: 3
  } : overrides.quota;
}

for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR']) {
  test(`GET print ledger permits ${role} under request-id scope only`, async () => {
    resetFixtures();
    const response = await request(app)
      .get(`/api/v1/leave-requests/${ids.leave}/print-ledger`)
      .set('Authorization', auth(role));
    assert.equal(response.status, 200, `${JSON.stringify(response.body)} calls=${JSON.stringify(calls)}`);
    assert.equal(response.body.data.available, true);
    assert.equal(response.body.data.bucket, 'VACATION');
    assert.equal(response.body.data.entitlementDays, 6);
    assert.equal(response.body.data.previouslyApprovedDays, 0);
    assert.equal(response.body.data.requestDays, 2);
    assert.equal(response.body.data.remainingBeforeDays, 6);
    assert.equal(response.body.data.remainingAfterDays, 4);
    assert.equal(response.body.data.unit, 'วัน (ปฏิทิน)');
    const requestRead = calls.find((call) => typeof call === 'object' && call.method === 'leaveRequest.findFirst');
    assert.deepEqual(requestRead.where, { id: ids.leave });
    assert.equal(calls.filter((call) => typeof call === 'object' && call.method === 'leaveRequest.findMany')[0].query.where.employeeId, ids.employee);
  });
}

for (const role of ['MANAGER', 'SUPERVISOR']) {
  test(`GET print ledger matches global /leave-requests visibility for ${role}`, async () => {
    const otherEmployeeId = 'b0000000-0000-4000-8000-000000000002';
    resetFixtures({
      currentLeave: { employeeId: otherEmployeeId },
      quota: { employeeId: otherEmployeeId, quotaYear: 2026, matchStatus: 'MATCHED', vacationLeave: 6, sickLeave: 30, personalLeave: 3 }
    });
    const response = await request(app)
      .get(`/api/v1/leave-requests/${ids.leave}/print-ledger`)
      .set('Authorization', auth(role));
    assert.equal(response.status, 200, `${JSON.stringify(response.body)} calls=${JSON.stringify(calls)}`);
    assert.equal(response.body.data.available, true);
    const requestRead = calls.find((call) => typeof call === 'object' && call.method === 'leaveRequest.findFirst');
    assert.deepEqual(requestRead.where, { id: ids.leave });
    assert.equal(calls.some((call) => typeof call === 'object' && call.method === 'leaveRequest.findFirst' && Object.hasOwn(call.where, 'employeeId')), false);
  });
}

for (const role of ['MANAGER', 'SUPERVISOR']) {
  test(`GET print ledger returns no data for unknown ${role} request ids`, async () => {
    resetFixtures();
    const response = await request(app)
      .get(`/api/v1/leave-requests/${ids.missing}/print-ledger`)
      .set('Authorization', auth(role));
    assert.equal(response.status, 404);
    assert.equal(response.body.data, undefined);
    assert.equal(calls.some((call) => typeof call === 'object' && call.method.startsWith('leaveQuota.')), false);
    const requestRead = calls.find((call) => typeof call === 'object' && call.method === 'leaveRequest.findFirst');
    assert.deepEqual(requestRead.where, { id: ids.missing });
  });
}

test('unauthenticated request returns 401 without querying leave or quota data', async () => {
  resetFixtures();
  const response = await request(app).get(`/api/v1/leave-requests/${ids.leave}/print-ledger`);
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

test('VIEWER is denied before the request or quota is read', async () => {
  resetFixtures();
  dueLifecycleEvent = { type: 'EMPLOYMENT_TERMINATION', newValue: { employee: { isActive: false } } };
  const response = await request(app)
    .get(`/api/v1/leave-requests/${ids.leave}/print-ledger`)
    .set('Authorization', auth('VIEWER'));
  assert.equal(response.status, 403);
  assert.deepEqual(calls.map((call) => typeof call === 'string' ? call : call.method), ['user.findUnique']);
  assert.equal(calls.some((call) => typeof call === 'object' && /leaveRequest|leaveQuota/.test(call.method)), false);
});

test('read-only authentication fails closed for due lifecycle events without applying or auditing them', async () => {
  resetFixtures();
  dueLifecycleEvent = { type: 'EMPLOYMENT_TERMINATION', newValue: { employee: { isActive: false } } };
  const response = await request(app)
    .get(`/api/v1/leave-requests/${ids.leave}/print-ledger`)
    .set('Authorization', auth('MANAGER'));
  assert.equal(response.status, 401);
  assert.equal(calls.some((call) => typeof call === 'object' && /leaveRequest|leaveQuota/.test(call.method)), false);
  assert.deepEqual(calls.map((call) => typeof call === 'string' ? call : call.method), ['user.findUnique', 'employeeLifecycleEvent.findMany']);
});

test('print-ledger actor predicate exactly matches GET /leave-requests scope', () => {
  assert.deepEqual(leaveRequestListActorScopeWhere({ role: 'ADMIN', employeeId: ids.employee }), {});
  assert.deepEqual(leaveRequestListActorScopeWhere({ role: 'MANAGER', employeeId: ids.employee }), {});
  assert.deepEqual(leaveRequestListActorScopeWhere({ role: 'SUPERVISOR', employeeId: ids.employee }), {});
  assert.deepEqual(leaveRequestListActorScopeWhere({ role: 'VIEWER', employeeId: ids.employee }), { employeeId: ids.employee });
});

test('ledger service applies the same Viewer employee predicate even when called directly', async () => {
  resetFixtures();
  await assert.rejects(
    getLeavePrintLedger(prisma, ids.leave, { role: 'VIEWER', employeeId: 'b0000000-0000-4000-8000-000000000002' }),
    (error) => error.statusCode === 403
  );
  assert.equal(calls.some((call) => typeof call === 'object' && call.method.startsWith('leaveRequest.')), false);
  assert.equal(calls.some((call) => typeof call === 'object' && call.method.startsWith('leaveQuota.')), false);
});

test('request id must be a UUID and unknown ids return 404', async () => {
  resetFixtures();
  const invalid = await request(app).get('/api/v1/leave-requests/not-a-uuid/print-ledger').set('Authorization', auth('ADMIN'));
  assert.equal(invalid.status, 400);
  assert.equal(calls.includes('leaveRequest.findUnique'), false);

  resetFixtures();
  const missing = await request(app).get(`/api/v1/leave-requests/${ids.missing}/print-ledger`).set('Authorization', auth('ADMIN'));
  assert.equal(missing.status, 404);
  assert.deepEqual(calls.find((call) => typeof call === 'object' && call.method === 'leaveRequest.findFirst').where, { id: ids.missing });
});

test('employeeId/year query selection is rejected and cannot expand request scope', async () => {
  for (const query of [{ employeeId: ids.employee }, { year: '2026' }]) {
    resetFixtures();
    const response = await request(app)
      .get(`/api/v1/leave-requests/${ids.leave}/print-ledger`)
      .query(query)
      .set('Authorization', auth('MANAGER'));
    assert.equal(response.status, 400);
    assert.equal(calls.includes('leaveRequest.findUnique'), false);
  }
});

test('non-PENDING/APPROVED statuses fail closed without any balance numbers', async () => {
  resetFixtures({ currentLeave: { status: 'REJECTED' } });
  const response = await request(app).get(`/api/v1/leave-requests/${ids.leave}/print-ledger`).set('Authorization', auth('ADMIN'));
  assert.equal(response.status, 200, `${JSON.stringify(response.body)} calls=${JSON.stringify(calls)}`);
  assert.equal(response.body.data.available, false);
  assert.equal(JSON.stringify(response.body.data).match(/(?:entitlement|previouslyApproved|requestDays|remaining\w*Days)/g), null);
  assert.equal(calls.some((call) => typeof call === 'object' && call.method === 'leaveQuota.findUnique'), false);
});

test('pending requests are eligible and the current request is excluded from prior approved totals', async () => {
  resetFixtures({
    currentLeave: { status: 'PENDING' },
    priorLeaves: [makeLeave(), {
      id: 'c0000000-0000-4000-8000-000000000002', employeeId: ids.employee, status: 'APPROVED', leaveType: 'VACATION',
      leaveQuotaBucketSnapshot: 'VACATION', startDate: new Date('2026-02-01T00:00:00.000Z'), endDate: new Date('2026-02-02T00:00:00.000Z'), dayCount: 2
    }]
  });
  const response = await request(app).get(`/api/v1/leave-requests/${ids.leave}/print-ledger`).set('Authorization', auth('ADMIN'));
  assert.equal(response.status, 200, `${JSON.stringify(response.body)} calls=${JSON.stringify(calls)}`);
  assert.equal(response.body.data.available, true);
  assert.equal(response.body.data.previouslyApprovedDays, 2);
  assert.equal(response.body.data.requestDays, 2);
  assert.equal(response.body.data.remainingBeforeDays, 4);
  assert.equal(response.body.data.remainingAfterDays, 2);
  const usageQuery = calls.find((call) => typeof call === 'object' && call.method === 'leaveRequest.findMany').query;
  assert.deepEqual(usageQuery.where.id, { not: ids.leave });
});

test('ambiguous bucket, missing quota, legacy day mismatch, and cross-year requests fail closed', async (t) => {
  const scenarios = [
    ['unknown current bucket', { currentLeave: { leaveQuotaBucketSnapshot: 'FUTURE' } }],
    ['missing current bucket snapshot', { currentLeave: { leaveQuotaBucketSnapshot: null } }],
    ['missing quota row', { quota: null }],
    ['unmatched legacy quota', { quota: { employeeId: ids.employee, quotaYear: 2026, matchStatus: 'UNMATCHED', vacationLeave: 6 } }],
    ['ambiguous legacy quota row', { legacyQuotas: [{ id: 'd0000000-0000-4000-8000-000000000001', matchStatus: 'MATCHED' }] }],
    ['current request day-count mismatch', { currentLeave: { dayCount: 1 } }],
    ['current request spans quota years', { currentLeave: { startDate: new Date('2026-12-31T00:00:00.000Z'), endDate: new Date('2027-01-01T00:00:00.000Z') } }],
    ['approved legacy usage day-count mismatch', { priorLeaves: [{ id: 'c0000000-0000-4000-8000-000000000002', employeeId: ids.employee, status: 'APPROVED', leaveType: 'VACATION', leaveQuotaBucketSnapshot: 'VACATION', startDate: new Date('2026-02-01T00:00:00.000Z'), endDate: new Date('2026-02-02T00:00:00.000Z'), dayCount: 1 }] }],
    ['approved cross-year usage with mismatched day count', { priorLeaves: [{ id: 'c0000000-0000-4000-8000-000000000002', employeeId: ids.employee, status: 'APPROVED', leaveType: 'VACATION', leaveQuotaBucketSnapshot: 'VACATION', startDate: new Date('2026-12-31T00:00:00.000Z'), endDate: new Date('2027-01-01T00:00:00.000Z'), dayCount: 1 }] }]
  ];
  for (const [name, fixtures] of scenarios) await t.test(name, async () => {
    resetFixtures(fixtures);
    const response = await request(app).get(`/api/v1/leave-requests/${ids.leave}/print-ledger`).set('Authorization', auth('ADMIN'));
    assert.equal(response.status, 200, `${JSON.stringify(response.body)} calls=${JSON.stringify(calls)}`);
    assert.equal(response.body.data.available, false);
    assert.equal(JSON.stringify(response.body.data).match(/(?:entitlement|previouslyApproved|requestDays|remaining\w*Days)/g), null);
  });
});

test('historical cross-year approved usage counts only exact target-year calendar days', async () => {
  resetFixtures({
    priorLeaves: [{
      id: 'c0000000-0000-4000-8000-000000000002', employeeId: ids.employee, status: 'APPROVED', leaveType: 'VACATION',
      leaveQuotaBucketSnapshot: 'VACATION', startDate: new Date('2025-12-30T00:00:00.000Z'), endDate: new Date('2026-01-05T00:00:00.000Z'), dayCount: 7
    }]
  });
  const response = await request(app).get(`/api/v1/leave-requests/${ids.leave}/print-ledger`).set('Authorization', auth('ADMIN'));
  assert.equal(response.status, 200, `${JSON.stringify(response.body)} calls=${JSON.stringify(calls)}`);
  assert.equal(response.body.data.available, true);
  assert.equal(response.body.data.previouslyApprovedDays, 5);
  assert.equal(response.body.data.remainingBeforeDays, 1);
  assert.equal(response.body.data.remainingAfterDays, -1);
});

test('zero-write contract: only authenticated user and leave/quota read methods are invoked', async () => {
  resetFixtures();
  const response = await request(app).get(`/api/v1/leave-requests/${ids.leave}/print-ledger`).set('Authorization', auth('ADMIN'));
  assert.equal(response.status, 200, `${JSON.stringify(response.body)} calls=${JSON.stringify(calls)}`);
  const calledMethods = calls.map((call) => typeof call === 'string' ? call : call.method);
  assert.ok(calledMethods.every((method) => ['user.findUnique', 'employeeLifecycleEvent.findMany', 'leaveRequest.findFirst', 'leaveRequest.findMany', 'leaveQuota.findUnique', 'leaveQuota.findMany'].includes(method)));
  assert.equal(calledMethods.some((method) => /create|update|delete|upsert|audit|provision|transaction/i.test(method)), false);
});
