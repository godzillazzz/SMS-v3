const test = require('node:test');
const assert = require('node:assert/strict');
const employees = [];
const audits = [];
const fakePrisma = {
  employee: {
    create: async ({ data }) => { const value = { id: '22222222-2222-4222-8222-222222222222', ...data, deletedAt: null }; employees.push(value); return value; },
    findFirst: async ({ where }) => employees.find((item) => item.id === where.id && item.deletedAt === null) || null,
    update: async ({ where, data }) => { const item = employees.find((entry) => entry.id === where.id); Object.assign(item, data); return item; },
    count: async () => employees.filter((item) => !item.deletedAt).length,
    findMany: async () => employees.filter((item) => !item.deletedAt)
  },
  auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  $transaction: async (work) => Array.isArray(work) ? Promise.all(work) : work(fakePrisma)
};
require.cache[require.resolve('../src/config/prisma')] = { exports: fakePrisma };
const service = require('../src/services/employee.service');
test('employee create, list, update, and soft delete create safe audit entries', async () => {
  const actor = '11111111-1111-4111-8111-111111111111';
  const created = await service.create({ employeeCode: 'E-1', firstName: 'A', lastName: 'B', email: 'private@example.com', phone: '123' }, actor);
  const listed = await service.list({ page: 1, pageSize: 20 }, 'VIEWER');
  assert.equal(listed.data[0].email, undefined); assert.equal(listed.meta.total, 1);
  await service.update(created.id, { department: 'Ops' }, actor);
  await service.remove(created.id, actor);
  assert.ok(employees[0].deletedAt); assert.equal(employees[0].isActive, false);
  const listedAfterDelete = await service.list({ page: 1, pageSize: 20 }, 'ADMIN');
  assert.equal(listedAfterDelete.data.length, 0); assert.equal(listedAfterDelete.meta.total, 0);
  assert.equal(audits.length, 3); assert.equal(audits[0].metadata.after.email, undefined);
});
