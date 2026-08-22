process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLicenseDocumentService, tableDocumentSummary } = require('../src/services/license-document.service');
const { createFakeLicenseDocumentStorage } = require('./support/fake-license-document-storage');

const ids = { admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', manager: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', employee: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', license: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', document: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
const pdf = { buffer: Buffer.from('%PDF-1.7\nfixture'), mimetype: 'application/pdf', originalname: '../guard license.pdf', size: 16 };

function harness({ createFailure = false, deleteFailure = false, auditDeleteFailure = false, simulateTransactionRollback = false, requireApprovalTransactionOptions = false } = {}) {
  const state = {
    license: { id: ids.license, employeeId: ids.employee, issueDate: new Date('2026-01-01'), expiryDate: new Date('2026-12-31') },
    employee: { id: ids.employee, department: 'Operations', isActive: true, deletedAt: null },
    manager: { department: 'Operations', employee: null }, documents: [], revisions: [], audits: [], reconciles: [], transactionCalls: 0, deleteCalls: 0, deleteAuditUsedTransaction: false
  };
  const tx = {
    $queryRaw: async () => [],
    user: { findUniqueOrThrow: async () => state.manager },
    employee: { findUniqueOrThrow: async () => state.employee },
    employeeLicense: {
      findUniqueOrThrow: async () => state.license,
      update: async ({ data }) => Object.assign(state.license, data)
    },
    employeeLicenseDocumentRevision: {
      findFirst: async ({ where }) => [...state.revisions].filter((revision) => revision.documentId === where.documentId).sort((a, b) => b.revision - a.revision)[0] || null,
      create: async ({ data }) => { const revision = { id: `revision-${state.revisions.length + 1}`, ...data }; state.revisions.push(revision); return revision; },
      findMany: async ({ where }) => [...state.revisions].filter((revision) => !where?.documentId || revision.documentId === where.documentId).sort((a, b) => b.revision - a.revision)
    },
    employeeLicenseDocument: {
      findFirst: async ({ where }) => state.documents.find((document) => document.licenseId === where.licenseId && document.checksum === where.checksum && document.status === where.status) || null,
      aggregate: async () => ({ _max: { version: state.documents.reduce((max, document) => Math.max(max, document.version), 0) || null } }),
      create: async ({ data }) => { if (createFailure) throw new Error('database create failure'); const document = { id: ids.document, status: 'PENDING', isCurrent: false, uploadedAt: new Date(), reviewedAt: null, rejectionReason: null, ...data }; state.documents.push(document); return document; },
      findUniqueOrThrow: async ({ where }) => { const document = state.documents.find((item) => item.id === where.id); if (!document) { const error = new Error('missing'); error.code = 'P2025'; throw error; } return document; },
      findMany: async () => [...state.documents].sort((a, b) => b.version - a.version),
      updateMany: async ({ where, data }) => { for (const document of state.documents.filter((item) => item.licenseId === where.licenseId && item.isCurrent === where.isCurrent)) Object.assign(document, data); },
      delete: async ({ where }) => { state.deleteCalls += 1; if (deleteFailure) throw new Error('database delete failure'); const index = state.documents.findIndex((item) => item.id === where.id); return state.documents.splice(index, 1)[0]; },
      update: async ({ where, data }) => { const document = state.documents.find((item) => item.id === where.id); const next = { ...data }; if (data.storageDeleteAttempts?.increment) { document.storageDeleteAttempts = Number(document.storageDeleteAttempts || 0) + data.storageDeleteAttempts.increment; delete next.storageDeleteAttempts; } return Object.assign(document, next); }
    },
    auditLog: { deleteMany: async ({ where }) => { state.audits = state.audits.filter((entry) => entry.entityType !== where.entityType || entry.entityId !== where.entityId); } }
  };
  const prisma = { $transaction: async (callback, options) => {
    state.transactionCalls += 1;
    if (requireApprovalTransactionOptions && (!options || options.timeout < 30000 || options.maxWait < 10000)) {
      const error = new Error('Transaction expired before approval completed.'); error.code = 'P2028'; throw error;
    }
    const snapshot = simulateTransactionRollback ? {
      documents: state.documents.map((document) => ({ ...document })),
      revisions: state.revisions.map((revision) => ({ ...revision })),
      audits: state.audits.map((entry) => ({ ...entry, metadata: entry.metadata && { ...entry.metadata } }))
    } : null;
    try { return await callback(tx); }
    catch (error) {
      if (snapshot) {
        state.documents.splice(0, state.documents.length, ...snapshot.documents);
        state.revisions.splice(0, state.revisions.length, ...snapshot.revisions);
        state.audits.splice(0, state.audits.length, ...snapshot.audits);
      }
      throw error;
    }
  } };
  prisma.employeeLicense = tx.employeeLicense;
  prisma.employeeLicenseDocumentRevision = tx.employeeLicenseDocumentRevision;
  prisma.employeeLicenseDocument = tx.employeeLicenseDocument;
  prisma.employeeLicenseDocument.update = tx.employeeLicenseDocument.update;
  const storage = createFakeLicenseDocumentStorage();
  const audit = { log: async (entry, client) => {
    if (entry.action === 'DELETE') {
      state.deleteAuditUsedTransaction = client === tx;
      if (auditDeleteFailure) throw new Error('database tombstone failure');
    }
    state.audits.push({ ...entry, metadata: entry.metadata && { ...entry.metadata } });
    return entry;
  } };
  const reconcileSchedules = async (...args) => state.reconciles.push(args);
  return { state, storage, service: createLicenseDocumentService({ prisma, storage, audit, reconcileSchedules }) };
}

test('upload creates PENDING metadata without changing master dates and uses a random object key', async () => {
  const { state, storage, service } = harness();
  const before = state.license.expiryDate;
  const document = await service.upload({ licenseId: ids.license, requestUser: { sub: ids.admin, role: 'ADMIN' }, file: pdf, input: { licenseNumber: 'LN-2027', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } });
  assert.equal(document.status, 'PENDING'); assert.equal(document.isCurrent, false); assert.equal(state.license.expiryDate, before);
  assert.equal(storage.calls.put.length, 1); assert.doesNotMatch(storage.calls.put[0].objectKey, /guard license/);
  assert.equal(document.safeDisplayFileName, '.._guard license.pdf');
  assert.equal(state.revisions.length, 1); assert.equal(state.revisions[0].documentId, document.id); assert.equal(state.revisions[0].revision, 1);
});

test('inactive employees remain readable but cannot receive operational license changes', async () => {
  const { state, service } = harness();
  state.employee.isActive = false;
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'PENDING', isCurrent: false, version: 1 });
  await assert.doesNotReject(() => service.list({ licenseId: ids.license, requestUser: { sub: ids.admin, role: 'ADMIN' } }));
  await assert.rejects(
    () => service.upload({ licenseId: ids.license, requestUser: { sub: ids.admin, role: 'ADMIN' }, file: pdf, input: { licenseNumber: 'LN-2027', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } }),
    (error) => error.statusCode === 409 && error.details?.code === 'INACTIVE_EMPLOYEE_OPERATION'
  );
  await assert.rejects(
    () => service.approve({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } }),
    (error) => error.statusCode === 409 && error.details?.code === 'INACTIVE_EMPLOYEE_OPERATION'
  );
  state.employee.isActive = true;
  const document = await service.upload({ licenseId: ids.license, requestUser: { sub: ids.admin, role: 'ADMIN' }, file: pdf, input: { licenseNumber: 'LN-2028', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31') } });
  assert.equal(document.status, 'PENDING');
});

test('storage failure creates no record and database failure removes the orphan object', async () => {
  const first = harness(); first.storage.failNextPut();
  await assert.rejects(() => first.service.upload({ licenseId: ids.license, requestUser: { sub: ids.admin, role: 'ADMIN' }, file: pdf, input: { licenseNumber: 'LN-2027', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } }));
  assert.equal(first.state.documents.length, 0);
  const second = harness({ createFailure: true });
  await assert.rejects(() => second.service.upload({ licenseId: ids.license, requestUser: { sub: ids.admin, role: 'ADMIN' }, file: pdf, input: { licenseNumber: 'LN-2027', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } }));
  assert.equal(second.storage.calls.remove.length, 1); assert.equal(second.storage.objects.size, 0);
});

test('manager license access is not limited by department and read list uses no interactive transaction', async () => {
  const { state, service } = harness(); const before = state.transactionCalls;
  await service.list({ licenseId: ids.license, requestUser: { sub: ids.manager, role: 'MANAGER' } });
  state.manager.department = 'HR';
  await service.list({ licenseId: ids.license, requestUser: { sub: ids.manager, role: 'MANAGER' } });
  assert.equal(state.transactionCalls, before);
});

test('viewer access and non-admin review operations are rejected', async () => {
  const { state, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.admin, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'PENDING', isCurrent: false, version: 1 });
  await assert.rejects(() => service.list({ licenseId: ids.license, requestUser: { sub: ids.manager, role: 'VIEWER' } }), { statusCode: 403 });
  await assert.rejects(() => service.approve({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' } }), { statusCode: 403 });
  await assert.rejects(() => service.reject({ id: ids.document, requestUser: { sub: ids.manager, role: 'VIEWER' }, rejectionReason: 'invalid role' }), { statusCode: 403 });
  assert.equal(state.documents[0].status, 'PENDING');
});

test('upload rejects invalid or reversed proposed dates before storage writes', async () => {
  const { storage, service } = harness();
  const requestUser = { sub: ids.admin, role: 'ADMIN' };
  await assert.rejects(() => service.upload({ licenseId: ids.license, requestUser, file: pdf, input: { licenseNumber: 'LN-2027', proposedStartDate: new Date('invalid'), proposedExpiryDate: new Date('2027-12-31') } }), { statusCode: 400 });
  await assert.rejects(() => service.upload({ licenseId: ids.license, requestUser, file: pdf, input: { licenseNumber: 'LN-2027', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2027-12-31') } }), { statusCode: 400 });
  assert.equal(storage.calls.put.length, 0);
});

test('view uses a short-lived signed URL and returns only safe viewer metadata', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: 'licenses/e/random', safeDisplayFileName: 'safe.pdf', mimeType: 'application/pdf', status: 'PENDING', version: 1 });
  await storage.put('licenses/e/random', pdf);
  const result = await service.view({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } });
  assert.deepEqual(Object.keys(result).sort(), ['fileName', 'mimeType', 'url']);
  assert.equal(storage.calls.createSignedUrl[0].expiresIn, 600);
});

test('admin self-approval updates master dates, supersedes old current, and writes one audit', async () => {
  const { state, service } = harness();
  state.documents.push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', employeeId: ids.employee, licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 1 });
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.admin, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'PENDING', isCurrent: false, version: 2 });
  const approved = await service.approve({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } });
  assert.equal(approved.reviewedById, ids.admin); assert.equal(approved.uploadedById, ids.admin); assert.equal(approved.isCurrent, true);
  assert.equal(state.documents[0].status, 'SUPERSEDED'); assert.equal(state.documents[0].isCurrent, false);
  assert.equal(state.license.expiryDate.toISOString().slice(0, 10), '2027-12-31');
  assert.equal(state.audits.at(-1).metadata.selfApproved, true); assert.equal(state.audits.at(-1).metadata.event, 'FINAL_APPROVE'); assert.equal(state.documents.filter((item) => item.isCurrent).length, 1);
});

test('approval uses an extended transaction budget for schedule reconciliation', async () => {
  const { state, service } = harness({ requireApprovalTransactionOptions: true });
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.admin, proposedLicenseNumber: 'LN-2027', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'PENDING', isCurrent: false, version: 1 });
  const approved = await service.approve({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } });
  assert.equal(approved.status, 'APPROVED');
});

test('double approval and non-pending rejection return conflict without deleting storage', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.admin, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'APPROVED', isCurrent: true, version: 1 });
  await assert.rejects(() => service.approve({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } }), { statusCode: 409 });
  await assert.rejects(() => service.reject({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' }, rejectionReason: 'invalid' }), { statusCode: 409 });
  assert.equal(storage.calls.remove.length, 0);
});

test('reject records reviewer and reason while preserving master, current approval, storage, and history', async () => {
  const { state, storage, service } = harness();
  const masterExpiry = state.license.expiryDate;
  state.documents.push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', employeeId: ids.employee, licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 1 });
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.manager, storageProvider: 'fake', storageBucket: 'private', storageObjectKey: 'licenses/e/rejected', originalFileName: 'rejected.pdf', safeDisplayFileName: 'rejected.pdf', mimeType: 'application/pdf', fileSize: pdf.size, proposedLicenseNumber: 'LN-REJECT', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'PENDING', isCurrent: false, version: 2 });
  await storage.put('licenses/e/rejected', pdf);
  const rejected = await service.reject({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' }, rejectionReason: 'Unreadable' });
  assert.equal(rejected.status, 'REJECTED'); assert.equal(rejected.reviewedById, ids.admin); assert.equal(rejected.rejectionReason, 'Unreadable');
  assert.equal(state.documents[0].isCurrent, true); assert.equal(state.license.expiryDate, masterExpiry);
  assert.equal(storage.calls.remove.length, 0); assert.equal(storage.objectExists('licenses/e/rejected'), true); assert.equal(state.documents[1].storageDeletedAt ?? null, null);
  assert.equal(state.audits.at(-1).metadata.event, 'REJECT'); assert.equal(state.audits.at(-1).metadata.fromStatus, 'PENDING'); assert.equal(state.audits.at(-1).metadata.toStatus, 'REJECTED');
});

test('admin can return pending document for correction without deleting or changing master/current', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', employeeId: ids.employee, licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 1 });
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: 'licenses/e/returned', status: 'PENDING', isCurrent: false, version: 2 });
  await storage.put('licenses/e/returned', pdf);
  const beforeExpiry = state.license.expiryDate;
  const returned = await service.returnForCorrection({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' }, correctionReason: '  กรุณาแนบวันที่ให้ชัดเจน  ' });
  assert.equal(returned.status, 'RETURNED_FOR_CORRECTION');
  assert.equal(returned.correctionReason, 'กรุณาแนบวันที่ให้ชัดเจน');
  assert.equal(returned.returnedById, ids.admin);
  assert.equal(state.documents[0].status, 'APPROVED'); assert.equal(state.documents[0].isCurrent, true);
  assert.equal(state.license.expiryDate, beforeExpiry);
  assert.equal(storage.calls.remove.length, 0); assert.equal(storage.objectExists('licenses/e/returned'), true);
  await service.view({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' } });
  assert.equal(state.audits.at(-1).metadata.event, 'VIEW');
});

test('return for correction validates reason, role, and pending state', async () => {
  const { state, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 1 });
  await assert.rejects(() => service.returnForCorrection({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' }, correctionReason: 'fix' }), { statusCode: 403 });
  await assert.rejects(() => service.returnForCorrection({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' }, correctionReason: '   ' }), { statusCode: 400 });
  await assert.rejects(() => service.returnForCorrection({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' }, correctionReason: 'fix' }), { statusCode: 409 });
});

test('request owner resubmits a returned document with the existing file', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.manager, storageProvider: 'fake', storageBucket: 'private', originalFileName: 'reuse.pdf', safeDisplayFileName: 'reuse.pdf', mimeType: 'application/pdf', fileSize: pdf.size, storageObjectKey: 'licenses/e/reuse', proposedLicenseNumber: 'OLD', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'RETURNED_FOR_CORRECTION', isCurrent: false, version: 1, correctionReason: 'แก้เลขใบอนุญาต', uploadedAt: new Date('2026-08-01') });
  await storage.put('licenses/e/reuse', pdf);
  const updated = await service.resubmit({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' }, input: { licenseNumber: 'NEW', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31'), note: 'แก้แล้ว' } });
  assert.equal(updated.status, 'PENDING'); assert.equal(updated.proposedLicenseNumber, 'NEW'); assert.equal(updated.note, 'แก้แล้ว');
  assert.equal(updated.storageObjectKey, 'licenses/e/reuse'); assert.equal(storage.calls.put.length, 1); assert.equal(storage.calls.remove.length, 0);
  assert.equal(state.license.expiryDate.toISOString().slice(0, 10), '2026-12-31');
  assert.equal(state.audits.at(-1).metadata.event, 'RESUBMIT'); assert.equal(state.audits.at(-1).metadata.revision, 2);
});

test('replacement resubmit preserves the previous revision file and creates immutable next revision', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.manager, storageProvider: 'fake', storageBucket: 'private', originalFileName: 'old.pdf', safeDisplayFileName: 'old.pdf', mimeType: 'application/pdf', fileSize: pdf.size, storageObjectKey: 'licenses/e/old', proposedLicenseNumber: 'OLD', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'RETURNED_FOR_CORRECTION', isCurrent: false, version: 1, uploadedAt: new Date('2026-08-01') });
  await storage.put('licenses/e/old', pdf);
  const replacement = { buffer: Buffer.from('%PDF-1.7\nreplacement'), mimetype: 'application/pdf', originalname: 'replacement.pdf', size: 23 };
  const updated = await service.resubmit({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' }, input: { licenseNumber: 'NEW', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31') }, file: replacement });
  assert.equal(updated.status, 'PENDING'); assert.notEqual(updated.storageObjectKey, 'licenses/e/old');
  assert.equal(storage.calls.put.length, 2); assert.equal(storage.calls.remove.length, 0);
  assert.equal(storage.objectExists('licenses/e/old'), true); assert.equal(storage.objectExists(updated.storageObjectKey), true);
  assert.equal(state.revisions.length, 2); assert.equal(state.revisions[0].revision, 1); assert.equal(state.revisions[0].storageObjectKey, 'licenses/e/old');
  assert.equal(state.revisions[1].revision, 2); assert.equal(state.revisions[1].storageObjectKey, updated.storageObjectKey);
});

test('rejected document keeps its private storage object and remains available to authorized history viewers', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.manager, storageProvider: 'fake', storageBucket: 'private', storageObjectKey: 'licenses/e/rejected-history', originalFileName: 'rejected.pdf', safeDisplayFileName: 'rejected.pdf', mimeType: 'application/pdf', fileSize: pdf.size, proposedLicenseNumber: 'LN-R', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'PENDING', isCurrent: false, version: 1, uploadedAt: new Date('2026-08-01') });
  await storage.put('licenses/e/rejected-history', pdf);
  const rejected = await service.reject({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' }, rejectionReason: 'อ่านไม่ได้' });
  assert.equal(rejected.status, 'REJECTED'); assert.equal(state.documents[0].status, 'REJECTED');
  assert.equal(storage.calls.remove.length, 0); assert.equal(storage.objectExists('licenses/e/rejected-history'), true);
  const viewed = await service.view({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } });
  assert.equal(viewed.fileName, 'rejected.pdf');
});

test('returned request can be resubmitted or cancelled only by uploadedById owner', async () => {
  const unrelatedManager = '12121212-1212-4121-8121-121212121212';
  const { state, storage, service } = harness();
  const document = await service.upload({ licenseId: ids.license, requestUser: { sub: ids.manager, role: 'MANAGER' }, file: pdf, input: { licenseNumber: 'LN-OWNER', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } });
  await service.returnForCorrection({ id: document.id, requestUser: { sub: ids.admin, role: 'ADMIN' }, correctionReason: 'แก้ไขข้อมูล' });
  await assert.rejects(() => service.resubmit({ id: document.id, requestUser: { sub: unrelatedManager, role: 'MANAGER' }, input: { licenseNumber: 'NOPE', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31') } }), (error) => error.statusCode === 403 && error.details?.code === 'LICENSE_DOCUMENT_REQUEST_OWNER_REQUIRED');
  await assert.rejects(() => service.cancel({ id: document.id, requestUser: { sub: ids.admin, role: 'ADMIN' } }), (error) => error.statusCode === 403 && error.details?.code === 'LICENSE_DOCUMENT_REQUEST_OWNER_REQUIRED');
  const cancelled = await service.cancel({ id: document.id, requestUser: { sub: ids.manager, role: 'MANAGER' } });
  assert.equal(cancelled.status, 'CANCELLED'); assert.equal(state.license.expiryDate.toISOString().slice(0, 10), '2026-12-31');
  assert.equal(storage.calls.remove.length, 0); assert.equal(storage.objects.size, 1);
  assert.equal(state.audits.at(-1).metadata.event, 'CANCEL'); assert.equal(state.audits.at(-1).metadata.toStatus, 'CANCELLED');
  await assert.rejects(() => service.resubmit({ id: document.id, requestUser: { sub: ids.manager, role: 'MANAGER' }, input: { licenseNumber: 'AFTER-CANCEL', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31') } }), { statusCode: 409 });
});

test('cancel is limited to returned owner requests and blocks pending, approved, and rejected states', async () => {
  for (const status of ['PENDING', 'APPROVED', 'REJECTED']) {
    const { state, service } = harness();
    state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, uploadedById: ids.manager, storageProvider: 'fake', storageBucket: 'private', storageObjectKey: `licenses/e/${status}`, originalFileName: 'x.pdf', safeDisplayFileName: 'x.pdf', mimeType: 'application/pdf', fileSize: pdf.size, proposedLicenseNumber: 'LN-X', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status, isCurrent: status === 'APPROVED', version: 1, uploadedAt: new Date() });
    await assert.rejects(() => service.cancel({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' } }), (error) => error.statusCode === 409 && error.details?.code === 'LICENSE_DOCUMENT_CANCEL_NOT_ALLOWED');
    assert.equal(state.documents[0].status, status);
  }
});

test('two correction cycles preserve revisions 1-3 and final approval applies only revision 3', async () => {
  const { state, storage, service } = harness();
  const document = await service.upload({ licenseId: ids.license, requestUser: { sub: ids.manager, role: 'MANAGER' }, file: pdf, input: { licenseNumber: 'LN-R1', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), note: 'revision one' } });
  await service.returnForCorrection({ id: document.id, requestUser: { sub: ids.admin, role: 'ADMIN' }, correctionReason: 'แก้รอบหนึ่ง' });
  await service.resubmit({ id: document.id, requestUser: { sub: ids.manager, role: 'MANAGER' }, input: { licenseNumber: 'LN-R2', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31'), note: 'revision two' } });
  const revision1Snapshot = { ...state.revisions[0] };
  await service.returnForCorrection({ id: document.id, requestUser: { sub: ids.admin, role: 'ADMIN' }, correctionReason: 'แก้รอบสอง' });
  await service.resubmit({ id: document.id, requestUser: { sub: ids.manager, role: 'MANAGER' }, input: { licenseNumber: 'LN-R3', proposedStartDate: new Date('2029-01-01'), proposedExpiryDate: new Date('2029-12-31'), note: '' } });
  assert.equal(state.revisions.length, 3);
  assert.equal(state.revisions[0].revision, 1); assert.equal(state.revisions[0].proposedLicenseNumber, 'LN-R1'); assert.equal(state.revisions[0].note, 'revision one');
  assert.equal(state.revisions[1].revision, 2); assert.equal(state.revisions[1].proposedLicenseNumber, 'LN-R2'); assert.equal(state.revisions[1].note, 'revision two');
  assert.equal(state.revisions[2].revision, 3); assert.equal(state.revisions[2].proposedLicenseNumber, 'LN-R3'); assert.equal(state.revisions[2].note, null);
  assert.deepEqual({ ...state.revisions[0] }, revision1Snapshot);
  const approved = await service.approve({ id: document.id, requestUser: { sub: ids.admin, role: 'ADMIN' } });
  assert.equal(approved.status, 'APPROVED'); assert.equal(state.license.licenseNumber, 'LN-R3'); assert.equal(state.license.expiryDate.toISOString().slice(0, 10), '2029-12-31');
  assert.equal(state.audits.at(-1).metadata.event, 'FINAL_APPROVE'); assert.equal(state.audits.at(-1).metadata.revision, 3); assert.equal(state.audits.at(-1).metadata.selfApproved, false);
  assert.equal(storage.calls.remove.length, 0);
});
test('admin permanently deletes a historical document, preserves prior audits, and appends one minimal tombstone', async () => {
  const { state, storage, service } = harness();
  const id = ids.document;
  state.documents.push({ id, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: 'licenses/e/historical', status: 'RETURNED_FOR_CORRECTION', isCurrent: false, version: 1, uploadedAt: new Date('2026-01-01'), resubmittedAt: new Date('2026-02-01') });
  state.documents.push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', employeeId: ids.employee, licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 2, uploadedAt: new Date('2026-03-01') });
  await storage.put('licenses/e/historical', pdf);
  const priorAudit = { actorUserId: ids.admin, action: 'CREATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'UPLOAD' } };
  state.audits.push(priorAudit);
  await assert.deepEqual(await service.permanentlyDelete({ id, requestUser: { sub: ids.admin, role: 'ADMIN' } }), { id, deleted: true });
  assert.equal(state.documents.some((document) => document.id === id), false);
  assert.equal(storage.objectExists('licenses/e/historical'), false);
  assert.equal(storage.calls.remove.length, 1);
  assert.equal(state.audits.includes(priorAudit), true);
  const tombstones = state.audits.filter((entry) => entry.entityType === 'EmployeeLicenseDocument' && entry.entityId === id && entry.action === 'DELETE');
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].actorUserId, ids.admin);
  assert.deepEqual(tombstones[0].metadata, { event: 'PERMANENT_DELETE', licenseId: ids.license });
  assert.deepEqual(Object.keys(tombstones[0].metadata).sort(), ['event', 'licenseId']);
  assert.equal(state.deleteAuditUsedTransaction, true);
  await assert.rejects(() => service.permanentlyDelete({ id, requestUser: { sub: ids.admin, role: 'ADMIN' } }));
  assert.equal(state.audits.filter((entry) => entry.entityId === id && entry.action === 'DELETE').length, 1);
});

test('permanent delete transaction never commits tombstone or row deletion independently', async () => {
  for (const failure of ['audit', 'delete']) {
    const { state, storage, service } = harness({ auditDeleteFailure: failure === 'audit', deleteFailure: failure === 'delete', simulateTransactionRollback: true });
    const id = ids.document;
    const objectKey = `licenses/e/atomic-${failure}`;
    state.documents.push({ id, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: objectKey, status: 'RETURNED_FOR_CORRECTION', isCurrent: false, version: 1, uploadedAt: new Date('2026-01-01'), resubmittedAt: new Date('2026-02-01') });
    state.documents.push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', employeeId: ids.employee, licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 2, uploadedAt: new Date('2026-03-01') });
    state.audits.push({ actorUserId: ids.admin, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'PRIOR' } });
    await storage.put(objectKey, pdf);
    await assert.rejects(() => service.permanentlyDelete({ id, requestUser: { sub: ids.admin, role: 'ADMIN' } }), { statusCode: 503 });
    assert.equal(state.documents.some((document) => document.id === id), true);
    assert.equal(state.audits.some((entry) => entry.entityId === id && entry.action === 'UPDATE'), true);
    assert.equal(state.audits.filter((entry) => entry.entityId === id && entry.action === 'DELETE').length, 0);
    assert.equal(state.deleteAuditUsedTransaction, true);
    assert.equal(state.deleteCalls, failure === 'delete' ? 1 : 0);
  }
});

test('permanent delete is admin-only and rejects current, pending, and active correction', async () => {
  const { state, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 1, uploadedAt: new Date('2026-01-01') });
  await assert.rejects(() => service.permanentlyDelete({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' } }), { statusCode: 403 });
  await assert.rejects(() => service.permanentlyDelete({ id: ids.document, requestUser: { sub: ids.manager, role: 'VIEWER' } }), { statusCode: 403 });
  await assert.rejects(() => service.permanentlyDelete({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } }), { statusCode: 409 });
  state.documents[0].status = 'PENDING'; state.documents[0].isCurrent = false;
  await assert.rejects(() => service.permanentlyDelete({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } }), { statusCode: 409 });
  state.documents[0].status = 'RETURNED_FOR_CORRECTION';
  await assert.rejects(() => service.permanentlyDelete({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } }), { statusCode: 409 });
});

test('storage failure returns sanitized 503 and does not report deletion success', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: 'licenses/e/failing-hard-delete', status: 'REJECTED', isCurrent: false, version: 1, uploadedAt: new Date('2026-01-01') });
  await storage.put('licenses/e/failing-hard-delete', pdf); storage.failNextRemove();
  await assert.rejects(() => service.permanentlyDelete({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } }), { statusCode: 503 });
  assert.equal(state.documents[0].status, 'REJECTED');
  assert.equal(state.audits.filter((entry) => entry.entityId === ids.document && entry.action === 'DELETE').length, 0);
});


test('license table summaries batch safe metadata without storage internals and preserve selection parity', async () => {
  const { state, service } = harness();
  state.documents.push({ id: 'approved', licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 2, uploadedAt: new Date('2026-08-01T00:00:00Z'), storageDeletedAt: null, storageDeleteAfter: null }, { id: 'pending', licenseId: ids.license, status: 'PENDING', isCurrent: false, version: 3, uploadedAt: new Date('2026-08-02T00:00:00Z'), storageDeletedAt: null, storageDeleteAfter: null, storageObjectKey: 'must-not-leak' });
  const result = await service.tableSummaries({ licenses: [state.license], requestUser: { sub: ids.admin, role: 'ADMIN' } });
  assert.deepEqual(result[ids.license], { state: 'CURRENT_WITH_PENDING', selectedDocumentId: 'approved', selectedFileAvailable: true, selectedFileDeleted: false, currentDocumentId: 'approved', pendingDocumentId: 'pending', reviewAvailable: true });
  assert.equal(JSON.stringify(result).includes('storageObjectKey'), false);
  await assert.rejects(() => service.tableSummaries({ licenses: [state.license], requestUser: { role: 'VIEWER' } }), { statusCode: 403 });
});

test('table document summary marks retention-deleted selected files unavailable', () => {
  const result = tableDocumentSummary([{ id: 'approved', licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 1, uploadedAt: new Date(), storageDeletedAt: new Date(), storageDeleteAfter: null }]);
  assert.equal(result.state, 'CURRENT'); assert.equal(result.selectedDocumentId, 'approved'); assert.equal(result.selectedFileAvailable, false); assert.equal(result.selectedFileDeleted, true);
});
