process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmployeeReferencePhotoService } = require('../src/services/employee-reference-photo.service');

const ids = { admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', employee: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', photo: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
function harness(storage) {
  const rows = [{ id: ids.photo, employeeId: ids.employee, status: 'ACTIVE', storageObjectKey: 'employee-reference-photos/hash/photo.jpg', storageDeletedAt: null, storageDeletionRequestedAt: null, mimeType: 'image/jpeg', safeDisplayFileName: 'photo.jpg' }];
  const audits = [];
  const prisma = {
    employee: { findUnique: async () => ({ id: ids.employee, isActive: true, deletedAt: null, department: 'Ops' }) },
    employeeReferencePhoto: {
      findUnique: async () => rows[0],
      findMany: async () => rows,
      update: async ({ data }) => Object.assign(rows[0], data),
      create: async () => rows[0]
    }
  };
  return { service: createEmployeeReferencePhotoService({ prisma, storage, audit: { log: async (entry) => audits.push(entry) } }), audits, rows };
}

test('reference view authorizes before backend sign and returns signed URL on success', async () => {
  const calls = [];
  const storage = { put: async () => ({ provider: 'fake', bucket: 'reference' }), remove: async () => {}, getBytes: async () => Buffer.from('x'), createSignedUrl: async (...args) => { calls.push(args); return 'signed://reference'; } };
  const { service, audits } = harness(storage);
  await assert.rejects(service.view({ id: ids.photo, actor: { role: 'VIEWER', sub: 'viewer' } }), /Reference photo access/);
  assert.equal(calls.length, 0);
  const result = await service.view({ id: ids.photo, actor: { role: 'ADMIN', sub: ids.admin } });
  assert.equal(result.url, 'signed://reference'); assert.equal(calls.length, 1); assert.equal(audits.at(-1).metadata.event, 'VIEW');
});

test('reference view preserves retention deletion 410 before backend sign', async () => {
  const calls = []; const storage = { createSignedUrl: async () => { calls.push(1); return 'signed://x'; } };
  const { service, rows } = harness(storage); rows[0].storageDeletedAt = new Date();
  await assert.rejects(service.view({ id: ids.photo, actor: { role: 'ADMIN', sub: ids.admin } }), /no longer viewable/); assert.equal(calls.length, 0);
});
