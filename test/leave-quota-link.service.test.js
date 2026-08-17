process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { linkLeaveQuota } = require('../src/services/leave-quota-link.service');

function fakeClient({ quota, employee, annual = null, otherLegacy = [], activationValue = 'true', activationExists = true }) {
  const updates = [];
  const audits = [];
  let uniqueCalls = 0;
  const tx = {
    leaveQuota: {
      findUnique: async ({ where }) => { uniqueCalls += 1; return where.id ? quota : annual; },
      findMany: async () => otherLegacy,
      update: async ({ data }) => { updates.push(data); return { ...quota, ...data }; }
    },
    employee: { findFirst: async () => employee },
    systemSetting: { findUnique: async () => activationExists ? { value: activationValue } : null },
    auditLog: { create: async ({ data }) => { audits.push(data); return data; } }
  };
  const auditService = { log: async (input, client) => client.auditLog.create({ data: input }) };
  return { client: { $transaction: async (callback) => callback(tx) }, auditService, updates, audits, uniqueCalls: () => uniqueCalls };
}

const legacy = { id: 'quota-1', employeeId: null, quotaYear: null, employeeNameSnapshot: 'Legacy', matchStatus: 'UNMATCHED' };
const employee = { id: 'employee-1', employeeCode: 'EMP001', displayName: 'Employee', department: 'Security' };

test('legacy link explicitly assigns employee + Gregorian quotaYear + MATCHED', async () => {
  const f = fakeClient({ quota: legacy, employee });
  const result = await linkLeaveQuota({ quotaId: legacy.id, employeeId: employee.id, quotaYear: 2027, actorUserId: 'admin', prismaClient: f.client, auditService: f.auditService });
  assert.equal(result.quotaYear, 2027);
  assert.deepEqual(f.updates, [{ employeeId: 'employee-1', quotaYear: 2027, matchStatus: 'MATCHED' }]);
  assert.equal(f.audits.length, 1);
});

test('legacy classification to non-base year is blocked while inactive but base-year 2026 remains allowed', async () => {
  const blocked = fakeClient({ quota: legacy, employee, activationValue: 'false' });
  await assert.rejects(() => linkLeaveQuota({ quotaId: legacy.id, employeeId: employee.id, quotaYear: 2027, actorUserId: 'admin', prismaClient: blocked.client, auditService: blocked.auditService }), (e) => e.statusCode === 409 && e.details?.code === 'G03_1_MULTI_YEAR_WRITES_NOT_ACTIVATED');
  assert.equal(blocked.updates.length, 0);
  const base = fakeClient({ quota: legacy, employee, activationExists: false });
  const result = await linkLeaveQuota({ quotaId: legacy.id, employeeId: employee.id, quotaYear: 2026, actorUserId: 'admin', prismaClient: base.client, auditService: base.auditService });
  assert.equal(result.quotaYear, 2026);
});

test('legacy link requires a valid explicit year', async () => {
  const f = fakeClient({ quota: legacy, employee });
  await assert.rejects(() => linkLeaveQuota({ quotaId: legacy.id, employeeId: employee.id, actorUserId: 'admin', prismaClient: f.client, auditService: f.auditService }), (e) => e.statusCode === 400);
});

test('year-classified row cannot be moved through legacy linking', async () => {
  const f = fakeClient({ quota: { ...legacy, quotaYear: 2026 }, employee });
  await assert.rejects(() => linkLeaveQuota({ quotaId: legacy.id, employeeId: employee.id, quotaYear: 2027, actorUserId: 'admin', prismaClient: f.client, auditService: f.auditService }), (e) => e.statusCode === 409);
});

test('annual employee/year conflict blocks legacy link', async () => {
  const f = fakeClient({ quota: legacy, employee, annual: { id: 'annual' } });
  await assert.rejects(() => linkLeaveQuota({ quotaId: legacy.id, employeeId: employee.id, quotaYear: 2027, actorUserId: 'admin', prismaClient: f.client, auditService: f.auditService }), (e) => e.statusCode === 409 && e.details?.code === 'LEAVE_QUOTA_ALREADY_EXISTS');
});

test('another linked unclassified legacy row blocks link ambiguity', async () => {
  const f = fakeClient({ quota: legacy, employee, otherLegacy: [{ id: 'other' }] });
  await assert.rejects(() => linkLeaveQuota({ quotaId: legacy.id, employeeId: employee.id, quotaYear: 2027, actorUserId: 'admin', prismaClient: f.client, auditService: f.auditService }), (e) => e.statusCode === 409 && e.details?.code === 'LEAVE_QUOTA_LEGACY_AMBIGUOUS');
});

test('linked null-year quota can be classified to a year without changing employee', async () => {
  const linked = { ...legacy, employeeId: employee.id, matchStatus: 'MATCHED' };
  const f = fakeClient({ quota: linked, employee });
  const result = await linkLeaveQuota({ quotaId: linked.id, employeeId: employee.id, quotaYear: 2026, actorUserId: 'admin', prismaClient: f.client, auditService: f.auditService });
  assert.equal(result.employeeId, employee.id);
  assert.equal(result.quotaYear, 2026);
  assert.equal(f.audits[0].metadata.event, 'ADMIN_ANNUAL_QUOTA_CLASSIFIED');
});

test('linked null-year quota cannot be reassigned to another employee during classification', async () => {
  const linked = { ...legacy, employeeId: 'employee-original', matchStatus: 'MATCHED' };
  const f = fakeClient({ quota: linked, employee });
  await assert.rejects(() => linkLeaveQuota({ quotaId: linked.id, employeeId: employee.id, quotaYear: 2026, actorUserId: 'admin', prismaClient: f.client, auditService: f.auditService }), (e) => e.statusCode === 409);
  assert.equal(f.updates.length, 0);
});
