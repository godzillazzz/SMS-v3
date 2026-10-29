const test = require('node:test');
const assert = require('node:assert/strict');
const { log } = require('../src/services/audit.service');
const { createEmployeeLifecycleService } = require('../src/services/employee-lifecycle.service');

test('employee audit omits private contact values while preserving unrelated audit metadata', async () => {
  const client = { auditLog: { create: async ({ data }) => data } };
  const metadata = { before: { address: 'HOME', emergencyContact: 'PERSON', emergencyPhone: '123', firstName: 'A' }, changedFields: ['address'] };
  const employee = await log({ action: 'UPDATE', entityType: 'Employee', metadata }, client);
  assert.deepEqual(employee.metadata, { before: { firstName: 'A' }, changedFields: ['address'] });
  const other = await log({ action: 'UPDATE', entityType: 'Other', metadata }, client);
  assert.equal(other.metadata.before.address, 'HOME');
});

test('lifecycle history projects private contacts away for management roles', async () => {
  const state = { employeeCode: 'E', firstName: 'A', lastName: 'B', isActive: true, address: 'HOME', emergencyContact: 'PERSON', emergencyPhone: '123' };
  const event = { oldValue: { employee: state }, newValue: { employee: state } };
  const client = { employee: { findFirst: async () => ({ id: 'e' }) }, employeeLifecycleEvent: { count: async () => 1, findMany: async () => [event] }, $transaction: async (ops) => Promise.all(ops) };
  const service = createEmployeeLifecycleService({ prismaClient: client });
  for (const role of ['MANAGER', 'SUPERVISOR']) {
    const result = await service.history('e', {}, role);
    for (const snapshot of [result.data[0].oldValue, result.data[0].newValue]) {
      for (const field of ['address', 'emergencyContact', 'emergencyPhone']) assert.equal(snapshot.employee[field], undefined);
    }
  }
  assert.equal((await service.history('e', {}, 'ADMIN')).data[0].newValue.employee.address, 'HOME');
});

test('legacy pending master edits preserve newly added contacts', async () => {
  const old = { employeeCode: 'E', firstName: 'A', lastName: 'B', displayName: 'A B', email: null, phone: null, department: null, jobTitle: null, hiredAt: null, skill: null, isActive: true };
  const employee = { ...old, id: 'e', address: 'HOME', emergencyContact: 'PERSON', emergencyPhone: '123' };
  const event = { id: 'event', employeeId: 'e', type: 'MASTER_EDIT', status: 'PENDING', effectiveDate: new Date('2020-01-01'), oldValue: { employee: old }, newValue: { employee: { ...old, firstName: 'C' } } };
  let update;
  const tx = { user: { findUnique: async () => null }, employeeLifecycleEvent: { findUnique: async () => event, update: async () => ({ ...event, status: 'APPLIED' }) }, employee: { findUniqueOrThrow: async () => employee, update: async ({ data }) => { update = data; return { ...employee, ...data }; } } };
  const client = { $transaction: async (fn) => fn(tx) };
  const service = createEmployeeLifecycleService({ prismaClient: client, auditService: { log: async () => {} }, clock: () => new Date('2026-10-29') });
  await service.applyPendingEvent('event');
  assert.equal(update.firstName, 'C');
  for (const field of ['address', 'emergencyContact', 'emergencyPhone']) assert.equal(Object.hasOwn(update, field), false);
});
