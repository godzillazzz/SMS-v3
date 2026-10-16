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

function tokenFor(role, sub = `http-${role.toLowerCase()}`) {
  return jwt.sign({ sub, tokenVersion: 0 }, env.jwtSecret, {
    algorithm: env.jwtAlgorithm, issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: '1m'
  });
}

async function withAuthenticatedPrismaUser(callback, role = 'MANAGER') {
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = async ({ where }) => ({ id: where?.id, email: `${role.toLowerCase()}@example.invalid`, role, employeeId: null, isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false, tokenVersion: 0, employee: null });
  try { return await callback(); } finally { prisma.user.findUnique = originalFindUnique; }
}

async function withAuthenticatedViewAsUser(callback, role) {
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = async ({ where }) => ({
    id: where?.id,
    email: `${role.toLowerCase()}@example.invalid`,
    role: where?.id === 'view-as-admin' ? 'ADMIN' : role,
    employeeId: null,
    isActive: true,
    accountStatus: 'ACTIVE',
    passwordResetRequired: false,
    tokenVersion: 0,
    employee: null
  });
  const token = jwt.sign({ sub: 'view-as-target', tokenVersion: 0, impersonation: true, impersonatorSub: 'view-as-admin', impersonatorTokenVersion: 0 }, env.jwtSecret, {
    algorithm: env.jwtAlgorithm, issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: '1m'
  });
  try { return await callback(token); } finally { prisma.user.findUnique = originalFindUnique; }
}

// HTTP boundary: auth is checked before the new exact-item handler can run.
test('HTTP endpoint requires authentication', async () => {
  const response = await request(app).get(`/api/v1/approval-center/items/EMPLOYEE_MASTER_CHANGE/${ID}`);
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Authentication required.');
});

test('HTTP exact-item route enforces role authorization and reaches handler for an authorized role', async () => {
  await withAuthenticatedPrismaUser(async () => {
    const viewer = await request(app).get(`/api/v1/approval-center/items/LEAVE_REQUEST/${ID}`).set('Authorization', `Bearer ${tokenFor('VIEWER')}`);
    assert.equal(viewer.status, 403);
    assert.equal(viewer.body.error, 'You do not have permission for this action.');
  }, 'VIEWER');
  const response = await withAuthenticatedPrismaUser(() => request(app)
    .get(`/api/v1/approval-center/items/NOT_A_TYPE/${ID}`)
    .set('Authorization', `Bearer ${tokenFor('MANAGER')}`));
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'APPROVAL_ITEM_TARGET_INVALID');
  assert.equal(response.body.error, 'Unsupported approval item type.');
});

test('HTTP View-As native detail guard is exact-route and before role authorization', async () => {
  const types = ['EMPLOYEE_REFERENCE_PHOTO', 'ATTENDANCE_DEVICE_REQUEST', 'USER_ACCESS'];
  const roles = ['VIEWER', 'MANAGER', 'SUPERVISOR', 'ADMIN'];
  const expected = { error: 'Approval item was not found.', code: 'APPROVAL_ITEM_NOT_FOUND' };
  for (const type of types) for (const role of roles) {
    const response = await withAuthenticatedViewAsUser((token) => request(app)
      .get(`/api/v1/approval-center/items/${type}/${ID}`)
      .set('Authorization', `Bearer ${token}`), role);
    assert.equal(response.status, 404);
    assert.deepStrictEqual(response.body, { ...expected, requestId: response.headers['x-request-id'] });
  }
});

test('six native-detail denial states have the complete uniform envelope for all guarded types', async () => {
  const types = ['EMPLOYEE_REFERENCE_PHOTO', 'ATTENDANCE_DEVICE_REQUEST', 'USER_ACCESS'];
  const expectedStates = ['missing id', 'malformed id', 'missing record', 'non-queue status', 'out of reviewer scope', 'own request'];
  for (const type of types) {
    const responses = await Promise.all([
      withAuthenticatedPrismaUser(() => request(app).get(`/api/v1/approval-center/items/${type}`).set('Authorization', `Bearer ${tokenFor('MANAGER')}`)),
      withAuthenticatedPrismaUser(() => request(app).get(`/api/v1/approval-center/items/${type}/not-a-uuid`).set('Authorization', `Bearer ${tokenFor('MANAGER')}`)),
      ...expectedStates.slice(2).map(() => withAuthenticatedViewAsUser((token) => request(app).get(`/api/v1/approval-center/items/${type}/${ID}`).set('Authorization', `Bearer ${token}`), 'MANAGER'))
    ]);
    assert.equal(responses.length, expectedStates.length);
    for (let index = 0; index < responses.length; index += 1) {
      assert.equal(responses[index].status, 404, `${type}/${expectedStates[index]}`);
      assert.deepStrictEqual(responses[index].body, {
        error: 'Approval item was not found.',
        code: 'APPROVAL_ITEM_NOT_FOUND',
        requestId: responses[index].headers['x-request-id']
      }, `${type}/${expectedStates[index]}`);
    }
  }
});

test('HTTP positive control uses the exact detail route for all three guarded types', async () => {
  for (const type of ['EMPLOYEE_REFERENCE_PHOTO', 'ATTENDANCE_DEVICE_REQUEST', 'USER_ACCESS']) {
    const response = await withAuthenticatedPrismaUser(() => request(app)
      .get(`/api/v1/approval-center/items/${type}/${ID}`)
      .set('Authorization', `Bearer ${tokenFor('MANAGER')}`));
    assert.notEqual(response.status, 401);
    assert.notEqual(response.status, 403);
  }
});

test('HTTP authenticated pipeline reaches route validation for malformed requestId', async () => {
  const response = await withAuthenticatedPrismaUser(() => request(app)
    .get('/api/v1/approval-center/items/LEAVE_REQUEST/not-a-uuid')
    .set('Authorization', `Bearer ${tokenFor('MANAGER')}`));
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'APPROVAL_ITEM_TARGET_INVALID');
  assert.equal(response.body.error, 'Invalid approval item request ID.');
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
      assert.deepStrictEqual(exact.data, listed.data[0], `${type} exact mapper must equal list mapper`);
      assert.equal(exact.data.type, definition.type);
      assert.equal(exact.data.requestId, ID);
    });
  }
});

test('old schedule revision is not eligible and returns the uniform not-found error', async () => {
  const current = service({ scheduleRows: [
    { id: 'old-schedule', month: new Date('2026-08-01Z'), revision: 1, status: 'PENDING', changedAt: NOW },
    { id: 'latest-schedule', month: new Date('2026-08-01Z'), revision: 2, status: 'PENDING', changedAt: NOW }
  ] });
  await assert.rejects(() => current.getItem({ actor: ACTOR, type: 'SCHEDULE_APPROVAL', requestId: 'old-schedule' }), (error) => error.statusCode === 404 && error.publicCode === 'APPROVAL_ITEM_NOT_FOUND');
});

test('leave self and non-retroactive Supervisor position denial return not-found', async () => {
  const rows = [
    { id: ID, employeeId: 'self', status: 'PENDING', requestedAt: NOW, createdAt: NOW, leaveType: 'SICK', startDate: NOW, endDate: NOW, dayCount: 1, employee: employee('self', 'SELF'), createdByUser: null },
    {    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', employeeId: 'supervisor', status: 'PENDING', requestedAt: NOW, createdAt: NOW, leaveType: 'SICK', startDate: new Date('2026-08-29T00:00:00Z'), endDate: NOW, dayCount: 1, employee: Object.assign(employee('supervisor', 'SUPERVISOR'), { jobTitle: 'Supervisor' }), createdByUser: null }
  ];
  rows[1].employee.jobTitle = 'Supervisor';
  const current = service({ actorEmployeeId: 'manager', leaveRows: rows });
  await assert.rejects(() => current.getItem({ actor: { role: 'MANAGER', sub: 'manager' }, type: 'LEAVE_REQUEST', requestId: rows[1].id }), (error) => error.statusCode === 404 && error.publicCode === 'APPROVAL_ITEM_NOT_FOUND');
  const selfOnly = service({ actorEmployeeId: 'self', leaveRows: [rows[0]] });
  await assert.rejects(() => selfOnly.getItem({ actor: { role: 'MANAGER', sub: 'manager' }, type: 'LEAVE_REQUEST', requestId: ID }), (error) => error.statusCode === 404 && error.publicCode === 'APPROVAL_ITEM_NOT_FOUND');
});

test('out-of-scope attendance adjustment returns not-found', async () => {
  const current = service({ attendanceRows: [] });
  await assert.rejects(() => current.getItem({ actor: ACTOR, type: 'ATTENDANCE_ADJUSTMENT_REQUEST', requestId: ID }), (error) => error.statusCode === 404 && error.publicCode === 'APPROVAL_ITEM_NOT_FOUND');
});

test('missing ID is indistinguishable from existing-but-denied record', async () => {
  const deniedId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const current = service({ actorEmployeeId: 'manager', leaveRows: [{
    id: deniedId, employeeId: 'supervisor', status: 'PENDING', requestedAt: NOW, createdAt: NOW,
    leaveType: 'SICK', startDate: new Date('2026-08-29T00:00:00Z'), endDate: NOW, dayCount: 1,
    employee: Object.assign(employee('supervisor', 'SUPERVISOR'), { jobTitle: 'Supervisor' }), createdByUser: null
  }] });
  const errors = [];
  for (const requestId of ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', deniedId]) {
    try { await current.getItem({ actor: { role: 'MANAGER', sub: 'manager' }, type: 'LEAVE_REQUEST', requestId }); }
    catch (error) { errors.push({ status: error.statusCode, code: error.publicCode, body: error.message, details: error.details || null }); }
  }
  assert.deepStrictEqual(errors[0], errors[1]);
  assert.deepStrictEqual(errors[0], { status: 404, code: 'APPROVAL_ITEM_NOT_FOUND', body: 'Approval item was not found.', details: null });
});

test('type-level policy denial is 403 and occurs before record lookup', async () => {
  await assert.rejects(() => service({ overrides: { LICENSE_DOCUMENT: { reviewerRoles: ['ADMIN'] } } }).getItem({ actor: { role: 'MANAGER' }, type: 'LICENSE_DOCUMENT', requestId: ID }), (error) => error.statusCode === 403 && error.publicCode === 'APPROVAL_TYPE_REVIEW_FORBIDDEN');
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
