process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmployeeReferencePhotoService } = require('../src/services/employee-reference-photo.service');
const { createSupabaseEmployeeReferencePhotoStorage } = require('../src/services/employee-reference-photo-storage.service');
const storageSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/services/employee-reference-photo-storage.service.js'), 'utf8');
function realStorage(backend) { return createSupabaseEmployeeReferencePhotoStorage({ objectBackend: backend, environment: {} }); }

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
  const storage = realStorage({ put: async () => ({ provider: 's3', bucket: 'reference' }), remove: async () => {}, get: async () => Buffer.from('x'), sign: async (...args) => { calls.push(args); return 'signed://reference'; } });
  const { service, audits } = harness(storage);
  await assert.rejects(service.view({ id: ids.photo, actor: { role: 'VIEWER', sub: 'viewer' } }), /Reference photo access/);
  assert.equal(calls.length, 0);
  const result = await service.view({ id: ids.photo, actor: { role: 'ADMIN', sub: ids.admin } });
  assert.equal(result.url, 'signed://reference'); assert.equal(calls.length, 1); assert.equal(audits.at(-1).metadata.event, 'VIEW');
});

test('mutation deleting objectBackend branch is detected', () => {
  assert.match(storageSource, /if \(objectBackend\) return validateStoredReferenceBytes\(await objectBackend\.get\(objectKey\)\)/);
  assert.match(storageSource, /if \(objectBackend\) return objectBackend\.sign\(objectKey, expiresIn\)/);
});

test('reference view preserves retention deletion 410 before backend sign', async () => {
  const calls = []; const storage = { createSignedUrl: async () => { calls.push(1); return 'signed://x'; } };
  const { service, rows } = harness(storage); rows[0].storageDeletedAt = new Date();
  await assert.rejects(service.view({ id: ids.photo, actor: { role: 'ADMIN', sub: ids.admin } }), /no longer viewable/); assert.equal(calls.length, 0);
});
