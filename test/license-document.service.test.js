process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLicenseDocumentService } = require('../src/services/license-document.service');
const { createFakeLicenseDocumentStorage } = require('./support/fake-license-document-storage');

const ids = { admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', manager: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', employee: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', license: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', document: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' };
const pdf = { buffer: Buffer.from('%PDF-1.7\nfixture'), mimetype: 'application/pdf', originalname: '../guard license.pdf', size: 16 };

function harness({ createFailure = false, requireApprovalTransactionOptions = false } = {}) {
  const state = {
    license: { id: ids.license, employeeId: ids.employee, issueDate: new Date('2026-01-01'), expiryDate: new Date('2026-12-31') },
    employee: { id: ids.employee, department: 'Operations' },
    manager: { department: 'Operations', employee: null }, documents: [], audits: [], reconciles: []
  };
  const tx = {
    $queryRaw: async () => [],
    user: { findUniqueOrThrow: async () => state.manager },
    employee: { findUniqueOrThrow: async () => state.employee },
    employeeLicense: {
      findUniqueOrThrow: async () => state.license,
      update: async ({ data }) => Object.assign(state.license, data)
    },
    employeeLicenseDocument: {
      findFirst: async ({ where }) => state.documents.find((document) => document.licenseId === where.licenseId && document.checksum === where.checksum && document.status === where.status) || null,
      aggregate: async () => ({ _max: { version: state.documents.reduce((max, document) => Math.max(max, document.version), 0) || null } }),
      create: async ({ data }) => { if (createFailure) throw new Error('database create failure'); const document = { id: ids.document, status: 'PENDING', isCurrent: false, uploadedAt: new Date(), reviewedAt: null, rejectionReason: null, ...data }; state.documents.push(document); return document; },
      findUniqueOrThrow: async ({ where }) => { const document = state.documents.find((item) => item.id === where.id); if (!document) { const error = new Error('missing'); error.code = 'P2025'; throw error; } return document; },
      findMany: async () => [...state.documents].sort((a, b) => b.version - a.version),
      updateMany: async ({ where, data }) => { for (const document of state.documents.filter((item) => item.licenseId === where.licenseId && item.isCurrent === where.isCurrent)) Object.assign(document, data); },
      update: async ({ where, data }) => { const document = state.documents.find((item) => item.id === where.id); const next = { ...data }; if (data.storageDeleteAttempts?.increment) { document.storageDeleteAttempts = Number(document.storageDeleteAttempts || 0) + data.storageDeleteAttempts.increment; delete next.storageDeleteAttempts; } return Object.assign(document, next); }
    }
  };
  const prisma = { $transaction: async (callback, options) => {
    if (requireApprovalTransactionOptions && (!options || options.timeout < 30000 || options.maxWait < 10000)) {
      const error = new Error('Transaction expired before approval completed.'); error.code = 'P2028'; throw error;
    }
    return callback(tx);
  } };
  prisma.employeeLicenseDocument = tx.employeeLicenseDocument;
  const storage = createFakeLicenseDocumentStorage();
  const audit = { log: async (entry) => { state.audits.push(entry); return entry; } };
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
});

test('storage failure creates no record and database failure removes the orphan object', async () => {
  const first = harness(); first.storage.failNextPut();
  await assert.rejects(() => first.service.upload({ licenseId: ids.license, requestUser: { sub: ids.admin, role: 'ADMIN' }, file: pdf, input: { licenseNumber: 'LN-2027', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } }));
  assert.equal(first.state.documents.length, 0);
  const second = harness({ createFailure: true });
  await assert.rejects(() => second.service.upload({ licenseId: ids.license, requestUser: { sub: ids.admin, role: 'ADMIN' }, file: pdf, input: { licenseNumber: 'LN-2027', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } }));
  assert.equal(second.storage.calls.remove.length, 1); assert.equal(second.storage.objects.size, 0);
});

test('manager license access is not limited by department', async () => {
  const { state, service } = harness();
  await service.list({ licenseId: ids.license, requestUser: { sub: ids.manager, role: 'MANAGER' } });
  state.manager.department = 'HR';
  await service.list({ licenseId: ids.license, requestUser: { sub: ids.manager, role: 'MANAGER' } });
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
  assert.equal(state.audits.at(-1).metadata.selfApproved, true); assert.equal(state.documents.filter((item) => item.isCurrent).length, 1);
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

test('reject records reviewer and reason, preserves master/current, then deletes storage', async () => {
  const { state, storage, service } = harness();
  const masterExpiry = state.license.expiryDate;
  state.documents.push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', employeeId: ids.employee, licenseId: ids.license, status: 'APPROVED', isCurrent: true, version: 1 });
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: 'licenses/e/rejected', status: 'PENDING', isCurrent: false, version: 2 });
  await storage.put('licenses/e/rejected', pdf);
  const rejected = await service.reject({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' }, rejectionReason: 'Unreadable' });
  assert.equal(rejected.status, 'REJECTED'); assert.equal(rejected.reviewedById, ids.admin); assert.equal(rejected.rejectionReason, 'Unreadable');
  assert.equal(state.documents[0].isCurrent, true); assert.equal(state.license.expiryDate, masterExpiry);
  assert.equal(storage.calls.remove.length, 1); assert.equal(storage.objectExists('licenses/e/rejected'), false); assert.ok(state.documents[1].storageDeletedAt);
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

test('manager resubmits a returned document with the existing file', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: 'licenses/e/reuse', proposedLicenseNumber: 'OLD', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'RETURNED_FOR_CORRECTION', isCurrent: false, version: 1, correctionReason: 'แก้เลขใบอนุญาต' });
  await storage.put('licenses/e/reuse', pdf);
  const updated = await service.resubmit({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' }, input: { licenseNumber: 'NEW', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31'), note: 'แก้ไขแล้ว' } });
  assert.equal(updated.status, 'PENDING'); assert.equal(updated.proposedLicenseNumber, 'NEW'); assert.equal(updated.note, 'แก้ไขแล้ว');
  assert.equal(updated.storageObjectKey, 'licenses/e/reuse'); assert.equal(storage.calls.put.length, 1); assert.equal(storage.calls.remove.length, 0);
  assert.equal(state.license.expiryDate.toISOString().slice(0, 10), '2026-12-31');
  assert.equal(state.audits.at(-1).metadata.event, 'RESUBMIT');
});

test('manager replacement upload commits the new file before deleting the old file', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: 'licenses/e/old', proposedLicenseNumber: 'OLD', proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), status: 'RETURNED_FOR_CORRECTION', isCurrent: false, version: 1 });
  await storage.put('licenses/e/old', pdf);
  const replacement = { buffer: Buffer.from('%PDF-1.7\nreplacement'), mimetype: 'application/pdf', originalname: 'replacement.pdf', size: 23 };
  const updated = await service.resubmit({ id: ids.document, requestUser: { sub: ids.manager, role: 'MANAGER' }, input: { licenseNumber: 'NEW', proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31') }, file: replacement });
  assert.equal(updated.status, 'PENDING'); assert.notEqual(updated.storageObjectKey, 'licenses/e/old');
  assert.equal(storage.calls.put.length, 2); assert.equal(storage.calls.remove.length, 1);
  assert.equal(storage.objectExists('licenses/e/old'), false); assert.equal(storage.objectExists(updated.storageObjectKey), true);
  assert.equal(state.documents[0].storageDeleteObjectKey, null);
});

test('rejected document remains rejected when immediate storage deletion fails and signed view is denied', async () => {
  const { state, storage, service } = harness();
  state.documents.push({ id: ids.document, employeeId: ids.employee, licenseId: ids.license, storageObjectKey: 'licenses/e/failing-delete', status: 'PENDING', isCurrent: false, version: 1 });
  await storage.put('licenses/e/failing-delete', pdf); storage.failNextRemove();
  const rejected = await service.reject({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' }, rejectionReason: 'ไฟล์อ่านไม่ได้' });
  assert.equal(rejected.status, 'REJECTED'); assert.equal(state.documents[0].status, 'REJECTED');
  assert.equal(state.documents[0].storageDeleteAttempts, 1); assert.equal(state.documents[0].storageDeletedAt, null);
  await assert.rejects(() => service.view({ id: ids.document, requestUser: { sub: ids.admin, role: 'ADMIN' } }), { statusCode: 410 });
});
