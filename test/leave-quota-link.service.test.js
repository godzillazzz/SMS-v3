process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { linkLeaveQuota } = require('../src/services/leave-quota-link.service');

function fakeClient({ quota, employee, existingQuota = null }) {
  const updateCalls = [];
  const auditCalls = [];
  const tx = {
    leaveQuota: {
      findUnique: async () => quota,
      findFirst: async () => existingQuota,
      update: async ({ data, select }) => {
        updateCalls.push(data);
        return { ...select, id: quota.id, employeeId: data.employeeId, employeeNameSnapshot: quota.employeeNameSnapshot, matchStatus: data.matchStatus };
      }
    },
    employee: { findFirst: async () => employee },
    auditLog: { create: async (input) => { auditCalls.push(input); return input; } }
  };
  return {
    client: { $transaction: async (callback) => callback(tx) },
    updateCalls,
    auditCalls,
    auditService: { log: async (input, transaction) => transaction.auditLog.create(input) }
  };
}

test('admin linkage updates only the quota foreign key and match status', async () => {
  const fixture = fakeClient({
    quota: { id: 'quota-1', employeeId: null, employeeNameSnapshot: 'Different Spelling', matchStatus: 'UNMATCHED' },
    employee: { id: 'employee-1', employeeCode: 'EMP001', displayName: 'Correct Employee', department: 'Security' }
  });
  const result = await linkLeaveQuota({ quotaId: 'quota-1', employeeId: 'employee-1', actorUserId: 'admin-1', prismaClient: fixture.client, auditService: fixture.auditService });
  assert.equal(result.employeeId, 'employee-1');
  assert.deepEqual(fixture.updateCalls, [{ employeeId: 'employee-1', matchStatus: 'MATCHED' }]);
  assert.equal(fixture.auditCalls.length, 1);
});

test('admin linkage rejects an unknown employee ID', async () => {
  const fixture = fakeClient({ quota: { id: 'quota-1', employeeId: null, employeeNameSnapshot: 'Name', matchStatus: 'UNMATCHED' }, employee: null });
  await assert.rejects(() => linkLeaveQuota({ quotaId: 'quota-1', employeeId: 'missing', actorUserId: 'admin-1', prismaClient: fixture.client, auditService: fixture.auditService }), (error) => error.statusCode === 404);
  assert.equal(fixture.updateCalls.length, 0);
});

test('admin linkage rejects an employee that already has a quota', async () => {
  const fixture = fakeClient({
    quota: { id: 'quota-1', employeeId: null, employeeNameSnapshot: 'Name', matchStatus: 'UNMATCHED' },
    employee: { id: 'employee-1', employeeCode: 'EMP001', displayName: 'Employee', department: 'Security' },
    existingQuota: { id: 'quota-2' }
  });
  await assert.rejects(() => linkLeaveQuota({ quotaId: 'quota-1', employeeId: 'employee-1', actorUserId: 'admin-1', prismaClient: fixture.client, auditService: fixture.auditService }), (error) => error.statusCode === 409);
  assert.equal(fixture.updateCalls.length, 0);
});

test('admin linkage never relinks an already matched quota', async () => {
  const fixture = fakeClient({ quota: { id: 'quota-1', employeeId: 'employee-1', employeeNameSnapshot: 'Name', matchStatus: 'MATCHED' }, employee: null });
  await assert.rejects(() => linkLeaveQuota({ quotaId: 'quota-1', employeeId: 'employee-2', actorUserId: 'admin-1', prismaClient: fixture.client, auditService: fixture.auditService }), (error) => error.statusCode === 409);
  assert.equal(fixture.updateCalls.length, 0);
});
