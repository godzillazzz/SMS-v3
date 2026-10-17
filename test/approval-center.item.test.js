'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5433/sms_v3_test';
process.env.JWT_SECRET ||= 'test-only-jwt-secret-value-012345678901234567890123456789';
const request = require('supertest');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const prisma = require('../src/config/prisma');
const lifecycle = require('../src/services/employee-lifecycle.service');
lifecycle.synchronizeDueLifecycleEventsForRequest = async () => ({ skipped: true, reason: 'TEST' });
const app = require('../src/app');
const { createApprovalCenterService } = require('../src/services/approval-center.service');
const { REQUEST_TYPE_DEFINITIONS, defaultPolicyFor } = require('../src/services/approval-policy.service');

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = { role: 'ADMIN', sub: 'admin-1' };
const NOW = new Date('2026-08-28T01:00:00.000Z');

function policies(overrides = {}) {
  const map = new Map(REQUEST_TYPE_DEFINITIONS.map((definition) => {
    const base = defaultPolicyFor(definition);
    return [definition.type, { ...base, ...(overrides[definition.type] || {}) }];
  }));
  return { loadPolicies: async () => map };
}

function model(rows, { findMany, findFirst } = {}) {
  return {
    findMany: findMany || (async ({ where } = {}) => rows.filter((row) => !where?.department || row.department === where.department)),
    findFirst: findFirst || (async ({ where } = {}) => rows.find((row) => (!where?.id || row.id === where.id) && (!where?.department || row.department === where.department)) || null),
    count: async () => rows.length
  };
}

function employee(id, code) {
  return { id, employeeCode: code, firstName: code, lastName: 'Test', displayName: `${code} Test`, department: 'PN', jobTitle: 'Guard', user: { role: 'VIEWER' } };
}

function fixture({ scheduleRows = [], leaveRows = [], attendanceRows = [], actorEmployeeId = null, overrides = {}, failModel = null } = {}) {
  const row = (id, extra = {}) => ({ id, status: 'PENDING_APPROVAL', createdAt: NOW, ...extra });
  const models = {
    employeeChangeRequest: model([row(ID, { employeeId: 'e1', currentRevision: 2, employee: employee('e1', 'E001'), requestOwner: { id: 'm1', displayName: 'Manager', role: 'MANAGER' }, revisions: [{ revision: 2, changedFields: ['department'], submittedAt: NOW }] })]),
    employeeReferencePhoto: model([row(ID, { employeeId: 'e2', uploadedAt: NOW, safeDisplayFileName: 'photo.jpg', mimeType: 'image/jpeg', fileSize: 10, imageWidth: 10, imageHeight: 10, employee: employee('e2', 'E002'), uploadedBy: { id: 'm2', displayName: 'Manager', role: 'MANAGER' } })]),
    employeeLicenseDocument: model([row(ID, { employeeId: 'e3', licenseId: 'l1', status: 'PENDING', uploadedAt: NOW, proposedStartDate: NOW, proposedExpiryDate: NOW, proposedLicenseNumber: 'LIC-NEW', version: 1, safeDisplayFileName: 'license.pdf', employee: employee('e3', 'E003'), uploadedBy: { id: 'm3', displayName: 'Manager', role: 'MANAGER' }, license: { licenseType: 'รปภ.', licenseNumber: 'LIC-OLD' } })]),
    attendanceDeviceChangeRequest: model([row(ID, { requestType: 'REPLACEMENT', reason: 'replace', employee: employee('e4', 'E004'), requestedBy: { id: 'm4', displayName: 'Manager', role: 'MANAGER' }, candidateDevice: { displayName: 'Phone', platformHint: 'Android' } })]),
    registrationRequest: model([row(ID, { submittedName: 'สมัครใหม่', email: 'new@example.invalid', departmentHint: 'PN', status: 'MATCHED', emailVerifiedAt: NOW, matchedEmployee: employee('e5', 'E005') })]),
    user: { ...model([row(ID, { displayName: 'Pending User', email: 'pending@example.invalid', role: 'VIEWER', department: 'PN', accountStatus: 'PENDING', requestedAt: NOW })]), findUnique: async () => actorEmployeeId ? { employeeId: actorEmployeeId, employee: { jobTitle: 'Guard', isActive: true, deletedAt: null } } : null },
    leaveRequest: model(leaveRows),
    scheduleApproval: {
      groupBy: async () => [...new Map(scheduleRows.map((r) => [new Date(r.month).toISOString(), r])).values()].map((r) => ({ month: r.month, _max: { revision: Math.max(...scheduleRows.filter((x) => new Date(x.month).getTime() === new Date(r.month).getTime()).map((x) => x.revision)) } })),
      findMany: async ({ where } = {}) => scheduleRows.filter((r) => r.status === where?.status && where?.OR?.some((x) => new Date(x.month).getTime() === new Date(r.month).getTime() && x.revision === r.revision)),
      findFirst: async ({ where } = {}) => scheduleRows.find((r) => r.id === where?.id && r.status === where?.status && where?.OR?.some((x) => new Date(x.month).getTime() === new Date(r.month).getTime() && x.revision === r.revision)) || null,
      count: async ({ where } = {}) => scheduleRows.filter((r) => r.status === where?.status && where?.OR?.some((x) => new Date(x.month).getTime() === new Date(r.month).getTime() && x.revision === r.revision)).length
    },
    systemSetting: { findMany: async () => [] }
  };
  if (failModel) {
    models[failModel].findMany = async () => { throw new Error('synthetic database failure'); };
    models[failModel].findFirst = async () => { throw new Error('synthetic database failure'); };
  }
  return { ...models, attendanceAdjustment: attendanceRows };
}

function service(options = {}) {
  const db = fixture(options);
  return createApprovalCenterService({
    prisma: db,
    approvalPolicyService: policies(options.overrides),
    clock: () => NOW,
    attendanceAdjustmentList: async ({ requestId }) => ({ data: db.attendanceAdjustment.filter((r) => !requestId || r.id === requestId), meta: { total: db.attendanceAdjustment.length } })
  });
}

function tokenFor(role, sub = `http-${role.toLowerCase()}`, claims = {}) {
  return jwt.sign({ sub, tokenVersion: 0, ...claims }, env.jwtSecret, {
    algorithm: env.jwtAlgorithm, issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: '1m'
  });
}

async function withViewAsUsers(callback, targetRole = 'VIEWER') {
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = async ({ where }) => where?.id === 'viewas-admin'
    ? { id: 'viewas-admin', email: 'admin@example.invalid', role: 'ADMIN', employeeId: null, isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false, tokenVersion: 0, employee: null }
    : { id: where?.id, email: `${targetRole.toLowerCase()}@example.invalid`, role: targetRole, employeeId: null, isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false, tokenVersion: 0, employee: null };
  try { return await callback(); } finally { prisma.user.findUnique = originalFindUnique; }
}

function viewAsToken(targetRole = 'VIEWER') {
  return tokenFor(targetRole, `viewas-${targetRole.toLowerCase()}`, {
    impersonation: true, impersonatorSub: 'viewas-admin', impersonatorTokenVersion: 0
  });
}

async function withAuthenticatedPrismaUser(callback, role = 'MANAGER') {
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = async ({ where }) => ({ id: where?.id, email: `${role.toLowerCase()}@example.invalid`, role, employeeId: null, isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false, tokenVersion: 0, employee: null });
  try { return await callback(); } finally { prisma.user.findUnique = originalFindUnique; }
}

// HTTP boundary: auth is checked before the new exact-item handler can run.
test('HTTP endpoint requires authentication', async () => {
  const response = await request(app).get(`/api/v1/approval-center/items/EMPLOYEE_MASTER_CHANGE/${ID}`);
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Authentication required.');
});

test('HTTP list route handles detail filters without adding an item endpoint', async () => {
  await withAuthenticatedPrismaUser(async () => {
    const viewer = await request(app).get(`/api/v1/approval-center?type=LEAVE_REQUEST&requestId=${ID}`).set('Authorization', `Bearer ${tokenFor('VIEWER')}`);
    assert.equal(viewer.status, 403);
    assert.equal(viewer.body.error, 'You do not have permission for this action.');
  }, 'VIEWER');
  const response = await withAuthenticatedPrismaUser(() => request(app)
    .get(`/api/v1/approval-center?type=NOT_A_TYPE&requestId=${ID}`)
    .set('Authorization', `Bearer ${tokenFor('MANAGER')}`));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
});

test('HTTP malformed detail-filter forms all return the canonical zero envelope', async () => {
  const auth = { Authorization: `Bearer ${tokenFor('MANAGER')}` };
  const canonical = await withAuthenticatedPrismaUser(() => request(app)
    .get('/api/v1/approval-center?type=LEAVE_REQUEST&requestId=not-a-uuid')
    .set(auth));
  assert.equal(canonical.status, 200);
  const cases = [
    ['malformed UUID', '/api/v1/approval-center?type=LEAVE_REQUEST&requestId=not-a-uuid'],
    ['missing requestId', '/api/v1/approval-center?type=LEAVE_REQUEST'],
    ['missing type', `/api/v1/approval-center?requestId=${ID}`],
    ['repeated type', `/api/v1/approval-center?type=LEAVE_REQUEST&type=USER_ACCESS&requestId=${ID}`],
    ['repeated requestId', `/api/v1/approval-center?type=LEAVE_REQUEST&requestId=${ID}&requestId=${ID}`],
    ['array type', `/api/v1/approval-center?type[]=LEAVE_REQUEST&requestId=${ID}`],
    ['array requestId', `/api/v1/approval-center?type=LEAVE_REQUEST&requestId[]=${ID}`],
    ['unknown detail parameter', `/api/v1/approval-center?type=LEAVE_REQUEST&requestId=${ID}&unexpected=true`],
    ['invalid limit with detail filter', `/api/v1/approval-center?type=LEAVE_REQUEST&requestId=${ID}&limit=not-a-number`]
  ];
  for (const [name, url] of cases) {
    await withAuthenticatedPrismaUser(async () => {
      const response = await request(app).get(url).set(auth);
      assert.equal(response.status, canonical.status, name);
      assert.deepStrictEqual(response.body, canonical.body, name);
    });
  }
});

test('HTTP View-As detail filters return the deterministic zero envelope for every target role', async () => {
  const expected = await withAuthenticatedPrismaUser(() => request(app)
    .get('/api/v1/approval-center?type=LEAVE_REQUEST&requestId=not-a-uuid')
    .set('Authorization', `Bearer ${tokenFor('MANAGER')}`));
  assert.equal(expected.status, 200);
  for (const role of ['VIEWER', 'MANAGER', 'SUPERVISOR']) {
    await withViewAsUsers(async () => {
      const response = await request(app)
        .get(`/api/v1/approval-center?type=LEAVE_REQUEST&requestId=${ID}`)
        .set('Authorization', `Bearer ${viewAsToken(role)}`);
      assert.equal(response.status, 200);
      assert.deepStrictEqual(response.body, expected.body);
    }, role);
  }
});

test('HTTP View-As mutations remain forbidden', async () => {
  await withViewAsUsers(async () => {
    const response = await request(app)
      .post('/api/v1/approval-center')
      .set('Authorization', `Bearer ${viewAsToken('VIEWER')}`)
      .send({ requestId: ID });
    assert.equal(response.status, 403);
  });
});

test('HTTP inactive View-As impersonator remains unauthenticated', async () => {
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = async ({ where }) => where?.id === 'viewas-admin'
    ? { id: 'viewas-admin', email: 'admin@example.invalid', role: 'ADMIN', employeeId: null, isActive: false, accountStatus: 'ACTIVE', passwordResetRequired: false, tokenVersion: 0, employee: null }
    : { id: where?.id, email: 'viewer@example.invalid', role: 'VIEWER', employeeId: null, isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false, tokenVersion: 0, employee: null };
  try {
    const response = await request(app)
      .get(`/api/v1/approval-center?type=LEAVE_REQUEST&requestId=${ID}`)
      .set('Authorization', `Bearer ${viewAsToken('VIEWER')}`);
    assert.equal(response.status, 401);
  } finally { prisma.user.findUnique = originalFindUnique; }
});


// This table obtains type names and the definitions used by the production policy service.
test('table-driven exact item supports every production approval type', async (t) => {
  const cases = REQUEST_TYPE_DEFINITIONS.map((definition) => ({ type: definition.type, definition }));
  assert.equal(cases.length, 9);
  for (const { type, definition } of cases) {
    await t.test(type, async () => {
      const options = {};
      if (type === 'SCHEDULE_APPROVAL') options.scheduleRows = [{ id: ID, month: new Date('2026-08-01T00:00:00Z'), revision: 1, status: 'PENDING', changedAt: NOW }];
      if (type === 'LEAVE_REQUEST') options.leaveRows = [{ id: ID, employeeId: 'e-leave', status: 'PENDING', requestedAt: NOW, createdAt: NOW, leaveType: 'SICK', startDate: NOW, endDate: NOW, dayCount: 1, employeeNameSnapshot: 'E-LEAVE', departmentSnapshot: 'PN', employee: employee('e-leave', 'E-LEAVE'), createdByUser: null }];
      if (type === 'ATTENDANCE_ADJUSTMENT_REQUEST') options.attendanceRows = [{ id: ID, status: 'PENDING_APPROVAL', employeeId: 'e7', employeeCode: 'E007', employeeName: 'E007 Test', department: 'PN', makerUserId: 'm7', makerDisplayName: 'Maker', makerRoleSnapshot: 'MANAGER', currentRevision: 1, workDate: '2026-08-27', reason: 'correction', createdAt: NOW }];
      const current = service(options);
      const listed = await current.list({ actor: ACTOR, onlyType: type, limit: 100 });
      assert.equal(listed.data.length, 1, `${type} list must contain fixture`);
      const exact = await current.getItem({ actor: ACTOR, type, requestId: ID });
      assert.deepStrictEqual(exact.data, [listed.data[0]], `${type} exact mapper must return one list item`);
      assert.equal(exact.data[0].type, definition.type);
      assert.equal(exact.data[0].requestId, ID);
    });
  }
});

test('old schedule revision is not eligible and returns the uniform not-found error', async () => {
  const current = service({ scheduleRows: [
    { id: 'old-schedule', month: new Date('2026-08-01Z'), revision: 1, status: 'PENDING', changedAt: NOW },
    { id: 'latest-schedule', month: new Date('2026-08-01Z'), revision: 2, status: 'PENDING', changedAt: NOW }
  ] });
  assert.deepStrictEqual((await current.getItem({ actor: ACTOR, type: 'SCHEDULE_APPROVAL', requestId: 'old-schedule' })).data, []);
});

test('leave self and non-retroactive Supervisor position denial return not-found', async () => {
  const rows = [
    { id: ID, employeeId: 'self', status: 'PENDING', requestedAt: NOW, createdAt: NOW, leaveType: 'SICK', startDate: NOW, endDate: NOW, dayCount: 1, employee: employee('self', 'SELF'), createdByUser: null },
    {    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', employeeId: 'supervisor', status: 'PENDING', requestedAt: NOW, createdAt: NOW, leaveType: 'SICK', startDate: new Date('2026-08-29T00:00:00Z'), endDate: NOW, dayCount: 1, employee: Object.assign(employee('supervisor', 'SUPERVISOR'), { jobTitle: 'Supervisor' }), createdByUser: null }
  ];
  rows[1].employee.jobTitle = 'Supervisor';
  const current = service({ actorEmployeeId: 'manager', leaveRows: rows });
  assert.deepStrictEqual((await current.getItem({ actor: { role: 'MANAGER', sub: 'manager' }, type: 'LEAVE_REQUEST', requestId: rows[1].id })).data, []);
  const selfOnly = service({ actorEmployeeId: 'self', leaveRows: [rows[0]] });
  assert.deepStrictEqual((await selfOnly.getItem({ actor: { role: 'MANAGER', sub: 'manager' }, type: 'LEAVE_REQUEST', requestId: ID })).data, []);
});

test('out-of-scope attendance adjustment returns not-found', async () => {
  const current = service({ attendanceRows: [] });
  assert.deepStrictEqual((await current.getItem({ actor: ACTOR, type: 'ATTENDANCE_ADJUSTMENT_REQUEST', requestId: ID })).data, []);
});

test('missing ID is indistinguishable from existing-but-denied record', async () => {
  const deniedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const current = service({ actorEmployeeId: 'manager', leaveRows: [{
    id: deniedId, employeeId: 'supervisor', status: 'PENDING', requestedAt: NOW, createdAt: NOW,
    leaveType: 'SICK', startDate: new Date('2026-08-29T00:00:00Z'), endDate: NOW, dayCount: 1,
    employee: Object.assign(employee('supervisor', 'SUPERVISOR'), { jobTitle: 'Supervisor' }), createdByUser: null
  }] });
  const envelopes = [];
  for (const requestId of ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', deniedId]) {
    envelopes.push(await current.getItem({ actor: { role: 'MANAGER', sub: 'manager' }, type: 'LEAVE_REQUEST', requestId }));
  }
  assert.deepStrictEqual(envelopes[0], envelopes[1]);
});

test('type-level policy denial is a uniform zero envelope', async () => {
  const result = await service({ overrides: { LICENSE_DOCUMENT: { reviewerRoles: ['ADMIN'] } } }).getItem({ actor: { role: 'MANAGER' }, type: 'LICENSE_DOCUMENT', requestId: ID });
  assert.deepEqual(result.data, []);
});

test('database failure propagates instead of becoming not-found', async () => {
  await assert.rejects(() => service({ failModel: 'employeeChangeRequest' }).getItem({ actor: ACTOR, type: 'EMPLOYEE_MASTER_CHANGE', requestId: ID }), (error) => error.message === 'synthetic database failure');
});

test('performance logging uses correlation ID and excludes target UUID, PII, and row payload', async () => {
  const records = [];
  const db = fixture();
  const current = createApprovalCenterService({ prisma: db, approvalPolicyService: policies(), clock: () => NOW, logger: { info: (event, fields) => records.push({ event, fields }) }, attendanceAdjustmentList: async () => ({ data: [], meta: { total: 0 } }) });
  await current.getItem({ actor: ACTOR, type: 'EMPLOYEE_MASTER_CHANGE', requestId: ID, correlationId: 'corr-safe-1' });
  const record = records.at(-1);
  assert.equal(record.event, 'performance_stage');
  assert.equal(record.fields.requestId, 'corr-safe-1');
  assert.equal(JSON.stringify(record).includes(ID), false);
  assert.equal(JSON.stringify(record).includes('E001'), false);
  assert.deepStrictEqual(Object.keys(record.fields).sort(), ['durationMs', 'operation', 'queryCount', 'requestId', 'role', 'stage', 'status'].sort());
});
