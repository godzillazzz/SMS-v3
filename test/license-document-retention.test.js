const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanupSupersededLicenseDocuments, cleanupDueLicenseDocuments, expireDueLicenseDocuments } = require('../src/services/license-document-retention.service');
const { createFakeLicenseDocumentStorage } = require('./support/fake-license-document-storage');

function harness(documents) {
  const updates = [];
  const prisma = {
    employeeLicenseDocument: {
      findMany: async () => documents.filter((document) => !document.isCurrent && document.status === 'EXPIRED' && document.storageDeleteAfter <= new Date('2026-08-01T00:00:00Z') && !document.storageDeletedAt),
      update: async ({ where, data }) => { const document = documents.find((item) => item.id === where.id); const next = { ...data }; if (data.storageDeleteAttempts?.increment) { document.storageDeleteAttempts += data.storageDeleteAttempts.increment; delete next.storageDeleteAttempts; } Object.assign(document, next); updates.push({ where, data }); return document; }
    }
  };
  return { prisma, updates, storage: createFakeLicenseDocumentStorage() };
}

test('workflow retention cleanup preserves superseded, rejected, and cancelled files and removes only due expired files', async () => {
  const superseded = { id: 'superseded', storageObjectKey: 'licenses/superseded', status: 'SUPERSEDED', isCurrent: false, storageDeleteAfter: new Date('2026-07-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const rejected = { id: 'rejected', storageObjectKey: 'licenses/rejected', status: 'REJECTED', isCurrent: false, storageDeleteAfter: new Date('2026-07-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const cancelled = { id: 'cancelled', storageObjectKey: 'licenses/cancelled', status: 'CANCELLED', isCurrent: false, storageDeleteAfter: new Date('2026-07-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const expired = { id: 'expired', storageObjectKey: 'licenses/expired', status: 'EXPIRED', isCurrent: false, storageDeleteAfter: new Date('2026-07-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const context = harness([superseded, rejected, cancelled, expired]);
  for (const document of [superseded, rejected, cancelled, expired]) await context.storage.put(document.storageObjectKey, { buffer: Buffer.from('%PDF-1.7\n%%EOF'), mimetype: 'application/pdf', size: 8 });
  const result = await cleanupDueLicenseDocuments({ ...context, now: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(result, { inspected: 1, deleted: 1, failed: 0 });
  assert.equal(context.storage.objectExists(expired.storageObjectKey), false); assert.ok(expired.storageDeletedAt);
  for (const document of [superseded, rejected, cancelled]) {
    assert.equal(context.storage.objectExists(document.storageObjectKey), true);
    assert.equal(document.storageDeletedAt, null);
  }
});

test('expired-file cleanup records a sanitized retry marker when storage removal fails', async () => {
  const due = { id: 'due', storageObjectKey: 'licenses/due', status: 'EXPIRED', isCurrent: false, storageDeleteAfter: new Date('2026-07-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAttempts: 0 };
  const context = harness([due]);
  await context.storage.put(due.storageObjectKey, { buffer: Buffer.from('%PDF-1.7\n%%EOF'), mimetype: 'application/pdf', size: 8 });
  context.storage.failNextRemove();
  const result = await cleanupSupersededLicenseDocuments({ ...context, now: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(result, { inspected: 1, deleted: 0, failed: 1 });
  assert.equal(due.storageDeletedAt, null); assert.equal(due.storageDeleteAttempts, 1); assert.equal(due.storageDeleteLastErrorCode, 'Error');
});

function expirationHarness(documents) {
  const storage = createFakeLicenseDocumentStorage();
  const audits = [];
  const tx = {
    $queryRaw: async () => [],
    employeeLicenseDocument: {
      findUnique: async ({ where }) => { const document = documents.find((item) => item.id === where.id); return document ? { ...document, license: { expiryDate: document.licenseExpiryDate } } : null; },
      update: async ({ where, data }) => { const document = documents.find((item) => item.id === where.id); const next = { ...data }; if (data.storageDeleteAttempts?.increment) { document.storageDeleteAttempts = Number(document.storageDeleteAttempts || 0) + data.storageDeleteAttempts.increment; delete next.storageDeleteAttempts; } return Object.assign(document, next); }
    }
  };
  const prisma = {
    employeeLicenseDocument: {
      findMany: async () => documents.filter((document) => document.status === 'APPROVED' && document.isCurrent && !document.expirationProcessedAt && document.licenseExpiryDate < new Date('2026-08-01T00:00:00Z')).map((document) => ({ id: document.id, storageObjectKey: document.storageObjectKey, licenseId: document.licenseId, employeeId: document.employeeId })),
      update: async ({ where, data }) => { const document = documents.find((item) => item.id === where.id); const next = { ...data }; if (data.storageDeleteAttempts?.increment) { document.storageDeleteAttempts = Number(document.storageDeleteAttempts || 0) + data.storageDeleteAttempts.increment; delete next.storageDeleteAttempts; } return Object.assign(document, next); }
    },
    $transaction: async (callback) => callback(tx)
  };
  return { prisma, storage, audits, audit: { log: async (entry) => { audits.push(entry); return entry; } } };
}

test('expiration transitions only approved documents after their inclusive expiry date and is idempotent', async () => {
  const expired = { id: 'expired', employeeId: 'employee', licenseId: 'license', storageObjectKey: 'licenses/expired', status: 'APPROVED', isCurrent: true, licenseExpiryDate: new Date('2026-07-31T00:00:00Z'), expirationProcessedAt: null, storageDeletedAt: null, storageDeleteAttempts: 0 };
  const stillValid = { id: 'valid', employeeId: 'employee', licenseId: 'license', storageObjectKey: 'licenses/valid', status: 'APPROVED', isCurrent: true, licenseExpiryDate: new Date('2026-08-01T00:00:00Z'), expirationProcessedAt: null, storageDeletedAt: null, storageDeleteAttempts: 0 };
  const pending = { id: 'pending', employeeId: 'employee', licenseId: 'license', storageObjectKey: 'licenses/pending', status: 'PENDING', isCurrent: false, licenseExpiryDate: new Date('2026-07-31T00:00:00Z'), expirationProcessedAt: null, storageDeletedAt: null, storageDeleteAttempts: 0 };
  const context = expirationHarness([expired, stillValid, pending]);
  await context.storage.put(expired.storageObjectKey, { buffer: Buffer.from('%PDF-1.7\n%%EOF'), mimetype: 'application/pdf', size: 8 });
  const first = await expireDueLicenseDocuments({ ...context, now: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(first, { inspected: 1, expired: 1, deleted: 1, failed: 0 });
  assert.equal(expired.status, 'EXPIRED'); assert.equal(expired.isCurrent, false); assert.ok(expired.expirationProcessedAt); assert.ok(expired.storageDeletedAt);
  assert.equal(stillValid.status, 'APPROVED'); assert.equal(stillValid.isCurrent, true); assert.equal(pending.status, 'PENDING');
  const second = await expireDueLicenseDocuments({ ...context, now: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(second, { inspected: 0, expired: 0, deleted: 0, failed: 0 }); assert.equal(context.audits.length, 1);
});

test('expiration keeps retry metadata when storage removal fails', async () => {
  const expired = { id: 'expired', employeeId: 'employee', licenseId: 'license', storageObjectKey: 'licenses/expired', status: 'APPROVED', isCurrent: true, licenseExpiryDate: new Date('2026-07-31T00:00:00Z'), expirationProcessedAt: null, storageDeletedAt: null, storageDeleteAttempts: 0 };
  const context = expirationHarness([expired]);
  await context.storage.put(expired.storageObjectKey, { buffer: Buffer.from('%PDF-1.7\n%%EOF'), mimetype: 'application/pdf', size: 8 }); context.storage.failNextRemove();
  const result = await expireDueLicenseDocuments({ ...context, now: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(result, { inspected: 1, expired: 1, deleted: 0, failed: 1 });
  assert.equal(expired.status, 'EXPIRED'); assert.equal(expired.storageDeletedAt, null); assert.equal(expired.storageDeleteAttempts, 1);
});
