const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanupSupersededLicenseDocuments } = require('../src/services/license-document-retention.service');
const { createFakeLicenseDocumentStorage } = require('./support/fake-license-document-storage');

function harness(documents) {
  const updates = [];
  const prisma = {
    employeeLicenseDocument: {
      findMany: async () => documents.filter((document) => document.status === 'SUPERSEDED' && !document.isCurrent && document.storageDeleteAfter <= new Date('2026-08-01T00:00:00Z') && !document.storageDeletedAt),
      update: async ({ where, data }) => { const document = documents.find((item) => item.id === where.id); const next = { ...data }; if (data.storageDeleteAttempts?.increment) { document.storageDeleteAttempts += data.storageDeleteAttempts.increment; delete next.storageDeleteAttempts; } Object.assign(document, next); updates.push({ where, data }); return document; }
    }
  };
  return { prisma, updates, storage: createFakeLicenseDocumentStorage() };
}

test('retention cleanup removes only due superseded files and keeps metadata', async () => {
  const due = { id: 'due', storageObjectKey: 'licenses/due', status: 'SUPERSEDED', isCurrent: false, storageDeleteAfter: new Date('2026-07-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const pending = { id: 'pending', storageObjectKey: 'licenses/pending', status: 'SUPERSEDED', isCurrent: false, storageDeleteAfter: new Date('2026-09-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const current = { id: 'current', storageObjectKey: 'licenses/current', status: 'APPROVED', isCurrent: true, storageDeleteAfter: new Date('2026-01-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const context = harness([due, pending, current]);
  await context.storage.put(due.storageObjectKey, { buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf', size: 8 });
  const result = await cleanupSupersededLicenseDocuments({ ...context, now: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(result, { inspected: 1, deleted: 1, failed: 0 });
  assert.equal(context.storage.objectExists(due.storageObjectKey), false);
  assert.ok(due.storageDeletedAt);
  assert.equal(pending.storageDeletedAt, null);
  assert.equal(current.storageDeletedAt, null);
});

test('retention cleanup records a sanitized retry marker when storage removal fails', async () => {
  const due = { id: 'due', storageObjectKey: 'licenses/due', status: 'SUPERSEDED', isCurrent: false, storageDeleteAfter: new Date('2026-07-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const context = harness([due]);
  await context.storage.put(due.storageObjectKey, { buffer: Buffer.from('%PDF-1.7'), mimetype: 'application/pdf', size: 8 });
  context.storage.failNextRemove();
  const result = await cleanupSupersededLicenseDocuments({ ...context, now: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(result, { inspected: 1, deleted: 0, failed: 1 });
  assert.equal(due.storageDeletedAt, null);
  assert.equal(due.storageDeleteAttempts, 1);
  assert.equal(due.storageDeleteLastErrorCode, 'Error');
});
