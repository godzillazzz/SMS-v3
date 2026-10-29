const test = require('node:test');
const assert = require('node:assert/strict');
const row = { id: 'e', deletedAt: null, address: 'Home', emergencyContact: 'Relative', emergencyPhone: '123' };
const prisma = { employee: { findFirst: async () => row, findMany: async () => [row], count: async () => 1 }, $transaction: async (queries) => Promise.all(queries) };
require.cache[require.resolve('../src/config/prisma')] = { exports: prisma };
const service = require('../src/services/employee.service');
const mutation = require('../src/services/employee-master-mutation.service');
test('private contact data is admin-only for lists and details', async () => {
  for (const role of ['VIEWER', 'MANAGER', 'SUPERVISOR']) {
    for (const item of [(await service.getById('e', role)), (await service.list({ page: 1, pageSize: 20 }, role)).data[0]]) {
      for (const field of ['address', 'emergencyContact', 'emergencyPhone']) assert.equal(item[field], undefined, `${role} leaked ${field}`);
    }
  }
  assert.equal((await service.getById('e', 'ADMIN')).emergencyPhone, '123');
});
test('admin may normalize contact changes; managers cannot propose them', () => {
  for (const field of ['address', 'emergencyContact', 'emergencyPhone']) {
    assert.equal(mutation.normalizeChanges({ [field]: '  value  ' }, 'ADMIN')[field], 'value');
    assert.throws(() => mutation.normalizeChanges({ [field]: 'value' }, 'MANAGER'), /not permitted/);
    assert.ok(mutation.IMMEDIATE_ONLY_FIELDS.includes(field));
  }
});
