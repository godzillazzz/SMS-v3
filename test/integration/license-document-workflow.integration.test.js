process.env.NODE_ENV = 'test';
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('license document integration suite requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  const target = new URL(process.env.DATABASE_URL || '');
  const isConfiguredTestTarget = target.pathname.replace(/^\//, '') === 'sms_v3_test' && ((target.hostname === 'host.docker.internal' && target.port === '5433') || (target.hostname === '127.0.0.1' && target.port === '5433') || (target.hostname === '127.0.0.1' && target.port === '5432' && process.env.TEST_DATABASE_RUNNER === 'docker-container-network') || (target.hostname === '127.0.0.1' && target.port === '55433' && process.env.TEST_DATABASE_RUNNER === 'phase3-disposable-local') || (target.hostname === '127.0.0.1' && target.port === '55435' && process.env.TEST_DATABASE_RUNNER === 'g06-disposable-local') || (target.hostname === '127.0.0.1' && target.port === '55436' && process.env.TEST_DATABASE_RUNNER === 'g06-reference-photo-disposable-local') || (target.hostname === '127.0.0.1' && target.port === '55437' && process.env.TEST_DATABASE_RUNNER === 'g06-face-verification-disposable-local'));
  if (!isConfiguredTestTarget) throw new Error('License document integration tests require the isolated sms_v3_test target.');
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Production storage credentials must not be present in license document integration tests.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const audit = require('../../src/services/audit.service');
  const { reconcileEmployeeLicenseSchedules } = require('../../src/services/license-schedule-reconciliation.service');
  const { createLicenseDocumentService } = require('../../src/services/license-document.service');
  const { expireDueLicenseDocuments } = require('../../src/services/license-document-retention.service');
  const { createFakeLicenseDocumentStorage } = require('../support/fake-license-document-storage');

  const pdf = { buffer: Buffer.from('%PDF-1.7\nintegration fixture\n%%EOF'), mimetype: 'application/pdf', originalname: 'integration-license.pdf', size: 32 };
  const created = { documentIds: [], auditIds: [], licenseIds: [], employeeIds: [], userIds: [] };

  async function cleanup() {
    const ids = Object.fromEntries(Object.entries(created).map(([key, values]) => [key, values.splice(0)]));
    if (ids.auditIds.length) await prisma.auditLog.deleteMany({ where: { id: { in: ids.auditIds } } });
    if (ids.documentIds.length) await prisma.employeeLicenseDocument.deleteMany({ where: { id: { in: ids.documentIds } } });
    if (ids.licenseIds.length) await prisma.employeeLicense.deleteMany({ where: { id: { in: ids.licenseIds } } });
    if (ids.userIds.length) await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
    if (ids.employeeIds.length) await prisma.employee.deleteMany({ where: { id: { in: ids.employeeIds } } });
    const remaining = await Promise.all([
      ids.auditIds.length ? prisma.auditLog.count({ where: { id: { in: ids.auditIds } } }) : 0,
      ids.documentIds.length ? prisma.employeeLicenseDocument.count({ where: { id: { in: ids.documentIds } } }) : 0,
      ids.licenseIds.length ? prisma.employeeLicense.count({ where: { id: { in: ids.licenseIds } } }) : 0,
      ids.userIds.length ? prisma.user.count({ where: { id: { in: ids.userIds } } }) : 0,
      ids.employeeIds.length ? prisma.employee.count({ where: { id: { in: ids.employeeIds } } }) : 0
    ]);
    assert.deepEqual(remaining, [0, 0, 0, 0, 0]);
  }

  async function fixture(label) {
    const marker = `${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const employee = await prisma.employee.create({ data: { employeeCode: `LIC-${marker}`.slice(0, 50), firstName: 'License', lastName: 'Fixture', department: 'Operations', isActive: true } });
    created.employeeIds.push(employee.id);
    const user = await prisma.user.create({ data: { email: `${marker}@example.test`, passwordHash: 'integration-test-only', displayName: `Admin ${marker}`, role: 'ADMIN', accountStatus: 'ACTIVE', isActive: true } });
    const managerUser = await prisma.user.create({ data: { email: `manager-${marker}@example.test`, passwordHash: 'integration-test-only', displayName: `Manager ${marker}`, role: 'MANAGER', accountStatus: 'ACTIVE', isActive: true } });
    created.userIds.push(user.id, managerUser.id);
    const license = await prisma.employeeLicense.create({ data: { legacyLicenseId: `v3:${marker}`, employeeId: employee.id, licenseType: 'Security Guard', licenseNumber: `LN-${marker}`, issueDate: new Date('2026-01-01'), expiryDate: new Date('2026-12-31'), status: 'Active' } });
    created.licenseIds.push(license.id);
    const storage = createFakeLicenseDocumentStorage();
    const service = createLicenseDocumentService({ prisma, storage, audit, reconcileSchedules: reconcileEmployeeLicenseSchedules });
    return { marker, employee, user, managerUser, license, storage, service, requestUser: { sub: user.id, role: 'ADMIN' }, managerRequestUser: { sub: managerUser.id, role: 'MANAGER' } };
  }

  async function trackAudits(userId) {
    const entityIds = [...created.documentIds, ...created.licenseIds];
    const rows = await prisma.auditLog.findMany({ where: { OR: [{ actorUserId: userId }, ...(entityIds.length ? [{ entityId: { in: entityIds } }] : [])] }, select: { id: true } });
    created.auditIds.push(...rows.map((row) => row.id).filter((id) => !created.auditIds.includes(id)));
  }

  async function runWorkflow(round) {
    const context = await fixture(`round-${round}`);
    const first = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: pdf, input: { licenseNumber: `LN-${context.marker}-1`, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), note: `round ${round}` } });
    created.documentIds.push(first.id);
    assert.equal(first.status, 'PENDING'); assert.equal(first.isCurrent, false);
    const beforeApprove = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } });
    assert.equal(beforeApprove.expiryDate.toISOString().slice(0, 10), '2026-12-31');
    assert.equal(beforeApprove.licenseNumber, `LN-${context.marker}`);
    assert.equal(first.proposedLicenseNumber, `LN-${context.marker}-1`);
    const history = await context.service.list({ licenseId: context.license.id, requestUser: context.requestUser });
    assert.equal(history[0].id, first.id); assert.equal('storageObjectKey' in history[0], false);
    const view = await context.service.view({ id: first.id, requestUser: context.requestUser });
    assert.match(view.url, /^https:\/\/fake-storage\.invalid\//); assert.equal(context.storage.calls.createSignedUrl[0].expiresIn, 600);
    const approved = await context.service.approve({ id: first.id, requestUser: context.requestUser });
    assert.equal(approved.uploadedById, context.user.id); assert.equal(approved.reviewedById, context.user.id); assert.equal(approved.isCurrent, true);
    const approvedMaster = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } });
    assert.equal(approvedMaster.expiryDate.toISOString().slice(0, 10), '2027-12-31');
    assert.equal(approvedMaster.licenseNumber, `LN-${context.marker}-1`);

    const renewal = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: { ...pdf, buffer: Buffer.from('%PDF-1.7\nrenewal\n%%EOF'), size: 18 }, input: { licenseNumber: `LN-${context.marker}-2`, proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31') } });
    created.documentIds.push(renewal.id);
    assert.equal((await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: first.id } })).isCurrent, true);
    await context.service.approve({ id: renewal.id, requestUser: context.requestUser });
    const versions = await prisma.employeeLicenseDocument.findMany({ where: { licenseId: context.license.id }, orderBy: { version: 'asc' } });
    assert.equal(versions[0].status, 'SUPERSEDED'); assert.equal(versions[0].isCurrent, false);
    assert.equal(versions[1].status, 'APPROVED'); assert.equal(versions[1].isCurrent, true);
    assert.equal(versions[0].storageDeleteAfter, null);
    assert.equal(context.storage.objectExists(versions[0].storageObjectKey), true);
    assert.equal((await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } })).licenseNumber, `LN-${context.marker}-2`);
    assert.equal(versions.filter((document) => document.isCurrent).length, 1);

    const rejectedCandidate = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: { ...pdf, buffer: Buffer.from('%PDF-1.7\nreject\n%%EOF'), size: 17 }, input: { licenseNumber: `LN-${context.marker}-3`, proposedStartDate: new Date('2029-01-01'), proposedExpiryDate: new Date('2029-12-31') } });
    created.documentIds.push(rejectedCandidate.id);
    const currentBeforeReject = (await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } })).expiryDate;
    await context.service.reject({ id: rejectedCandidate.id, requestUser: context.requestUser, rejectionReason: 'Integration rejection' });
    const afterReject = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } });
    assert.equal(afterReject.expiryDate.getTime(), currentBeforeReject.getTime());
    assert.equal(afterReject.licenseNumber, `LN-${context.marker}-2`);
    assert.equal((await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: renewal.id } })).isCurrent, true);
    const rejected = await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: rejectedCandidate.id } });
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.storageDeletedAt, null);
    assert.equal(context.storage.objectExists(rejectedCandidate.storageObjectKey), true);
    await assert.doesNotReject(() => context.service.view({ id: rejectedCandidate.id, requestUser: context.requestUser }));
    await trackAudits(context.user.id);
  }

  test.beforeEach(cleanup);
  test.after(async () => { await cleanup(); await prisma.$disconnect(); });

  for (let round = 1; round <= 3; round += 1) test(`license document workflow is isolated and repeatable (round ${round})`, () => runWorkflow(round));

  test('approval rolls back when audit creation fails', async () => {
    const context = await fixture('rollback');
    const pending = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: pdf, input: { licenseNumber: `LN-${context.marker}-1`, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } });
    created.documentIds.push(pending.id);
    const failingService = createLicenseDocumentService({ prisma, storage: context.storage, audit: { log: async () => { throw new Error('injected audit failure'); } }, reconcileSchedules: reconcileEmployeeLicenseSchedules });
    await assert.rejects(() => failingService.approve({ id: pending.id, requestUser: context.requestUser }), /injected audit failure/);
    const stored = await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: pending.id } });
    const master = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } });
    assert.equal(stored.status, 'PENDING'); assert.equal(stored.isCurrent, false); assert.equal(master.expiryDate.toISOString().slice(0, 10), '2026-12-31');
    await trackAudits(context.user.id);
  });

  test('concurrent self-approval produces one success, one conflict, and one current document', async () => {
    const context = await fixture('concurrency');
    const pending = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: pdf, input: { licenseNumber: `LN-${context.marker}-1`, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } });
    created.documentIds.push(pending.id);
    const results = await Promise.allSettled([context.service.approve({ id: pending.id, requestUser: context.requestUser }), context.service.approve({ id: pending.id, requestUser: context.requestUser })]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.statusCode, 409);
    assert.equal(await prisma.employeeLicenseDocument.count({ where: { licenseId: context.license.id, isCurrent: true } }), 1);
    const approvalAudits = await prisma.auditLog.count({ where: { entityId: pending.id, metadata: { path: ['event'], equals: 'FINAL_APPROVE' } } });
    assert.equal(approvalAudits, 1);
    await trackAudits(context.user.id);
  });

  test('permanent delete preserves historical audits and exposes one minimal tombstone through the Audit API', async () => {
    const context = await fixture('g05-tombstone');
    try {
      const first = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: pdf, input: { licenseNumber: `LN-${context.marker}-1`, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } });
      created.documentIds.push(first.id);
      await context.service.approve({ id: first.id, requestUser: context.requestUser });
      const replacement = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: { ...pdf, buffer: Buffer.from('%PDF-1.7\nreplacement-g05\n%%EOF'), size: 28 }, input: { licenseNumber: `LN-${context.marker}-2`, proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31') } });
      created.documentIds.push(replacement.id);
      await context.service.approve({ id: replacement.id, requestUser: context.requestUser });

      const superseded = await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(superseded.status, 'SUPERSEDED');
      assert.equal(context.storage.objectExists(superseded.storageObjectKey), true);
      const priorRows = await prisma.auditLog.findMany({ where: { entityType: 'EmployeeLicenseDocument', entityId: first.id }, orderBy: { createdAt: 'asc' } });
      assert.ok(priorRows.length >= 2);
      const priorIds = priorRows.map((row) => row.id);
      created.auditIds.push(...priorIds.filter((id) => !created.auditIds.includes(id)));

      const deletionStartedAt = new Date();
      await assert.deepEqual(await context.service.permanentlyDelete({ id: first.id, requestUser: context.requestUser }), { id: first.id, deleted: true });
      assert.equal(context.storage.objectExists(superseded.storageObjectKey), false);
      assert.equal(await prisma.employeeLicenseDocument.count({ where: { id: first.id } }), 0);

      const afterRows = await prisma.auditLog.findMany({ where: { entityType: 'EmployeeLicenseDocument', entityId: first.id }, orderBy: { createdAt: 'asc' } });
      assert.equal(afterRows.length, priorRows.length + 1);
      for (const priorId of priorIds) assert.equal(afterRows.some((row) => row.id === priorId), true);
      const tombstones = afterRows.filter((row) => row.action === 'DELETE');
      assert.equal(tombstones.length, 1);
      assert.equal(tombstones[0].actorUserId, context.user.id);
      assert.equal(tombstones[0].entityId, first.id);
      assert.ok(tombstones[0].createdAt >= deletionStartedAt);
      assert.deepEqual(tombstones[0].metadata, { event: 'PERMANENT_DELETE', licenseId: context.license.id });
      assert.deepEqual(Object.keys(tombstones[0].metadata).sort(), ['event', 'licenseId']);
      created.auditIds.push(tombstones[0].id);

      const token = accessTokenFor(context.user);
      const response = await request(app)
        .get(`/api/v1/audit-events?entityType=EmployeeLicenseDocument&action=DELETE&search=${first.id}`)
        .set('Authorization', `Bearer ${token}`);
      assert.equal(response.status, 200);
      const apiTombstone = response.body.data.find((row) => row.entityId === first.id && row.action === 'DELETE');
      assert.ok(apiTombstone);
      assert.equal(apiTombstone.module, 'LICENSE');
      assert.deepEqual(apiTombstone.metadata, { event: 'PERMANENT_DELETE', licenseId: context.license.id });
    } finally {
      await trackAudits(context.user.id);
    }
  });

  test('return, owner resubmit, reject preservation, and expiration preserve history safely', async () => {
    const context = await fixture('correction-disposal');
    try {
      const pending = await context.service.upload({ licenseId: context.license.id, requestUser: context.managerRequestUser, file: pdf, input: { licenseNumber: `LN-${context.marker}-return`, proposedStartDate: new Date('2025-01-01'), proposedExpiryDate: new Date('2025-12-31'), note: 'initial' } });
      created.documentIds.push(pending.id);
      const returned = await context.service.returnForCorrection({ id: pending.id, requestUser: context.requestUser, correctionReason: 'กรุณาตรวจสอบวันที่และเลขใบอนุญาต' });
      assert.equal(returned.status, 'RETURNED_FOR_CORRECTION'); assert.equal(context.storage.objectExists(pending.storageObjectKey), true); assert.equal(context.storage.calls.remove.length, 0);
      await assert.rejects(() => context.service.resubmit({ id: pending.id, requestUser: context.requestUser, input: { licenseNumber: 'ADMIN-NOT-OWNER', proposedStartDate: new Date('2025-01-01'), proposedExpiryDate: new Date('2025-12-31') } }), (error) => error.statusCode === 403 && error.details?.code === 'LICENSE_DOCUMENT_REQUEST_OWNER_REQUIRED');
      const resubmitted = await context.service.resubmit({ id: pending.id, requestUser: context.managerRequestUser, input: { licenseNumber: `LN-${context.marker}-fixed`, proposedStartDate: new Date('2025-01-01'), proposedExpiryDate: new Date('2025-12-31'), note: 'corrected' } });
      assert.equal(resubmitted.status, 'PENDING'); assert.equal(resubmitted.storageObjectKey, pending.storageObjectKey); assert.equal(context.storage.calls.remove.length, 0);
      const approved = await context.service.approve({ id: pending.id, requestUser: context.requestUser });
      assert.equal(approved.status, 'APPROVED'); assert.equal(approved.isCurrent, true);
      const rejectedCandidate = await context.service.upload({ licenseId: context.license.id, requestUser: context.managerRequestUser, file: { ...pdf, buffer: Buffer.from('%PDF-1.7\nreject-correction\n%%EOF'), size: 26 }, input: { licenseNumber: `LN-${context.marker}-reject`, proposedStartDate: new Date('2026-01-01'), proposedExpiryDate: new Date('2026-12-31') } });
      created.documentIds.push(rejectedCandidate.id);
      await context.service.reject({ id: rejectedCandidate.id, requestUser: context.requestUser, rejectionReason: 'เอกสารไม่ชัดเจน' });
      assert.equal((await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: rejectedCandidate.id } })).status, 'REJECTED');
      assert.equal(context.storage.objectExists(rejectedCandidate.storageObjectKey), true);
      await assert.doesNotReject(() => context.service.view({ id: rejectedCandidate.id, requestUser: context.requestUser }));
      const expiration = await expireDueLicenseDocuments({ prisma, storage: context.storage, audit, now: new Date('2026-08-02T00:00:00Z') });
      assert.equal(expiration.expired, 1); assert.equal(expiration.deleted, 1);
      const expired = await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: pending.id } });
      assert.equal(expired.status, 'EXPIRED'); assert.equal(expired.isCurrent, false); assert.ok(expired.expirationProcessedAt); assert.ok(expired.storageDeletedAt);
      await assert.rejects(() => context.service.view({ id: pending.id, requestUser: context.requestUser }), { statusCode: 410 });
      await trackAudits(context.user.id);
    } finally {
      await trackAudits(context.user.id);
    }
  });

  test('owner correction revisions remain immutable through revision 3, final approve, and returned cancel', async () => {
    const context = await fixture('phase3-owner-revisions');
    try {
      const pending = await context.service.upload({ licenseId: context.license.id, requestUser: context.managerRequestUser, file: pdf, input: { licenseNumber: `LN-${context.marker}-R1`, proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), note: 'revision one' } });
      created.documentIds.push(pending.id);
      await context.service.returnForCorrection({ id: pending.id, requestUser: context.requestUser, correctionReason: 'แก้รอบหนึ่ง' });
      await context.service.resubmit({ id: pending.id, requestUser: context.managerRequestUser, input: { licenseNumber: `LN-${context.marker}-R2`, proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31'), note: 'revision two' } });
      await context.service.returnForCorrection({ id: pending.id, requestUser: context.requestUser, correctionReason: 'แก้รอบสอง' });
      await context.service.resubmit({ id: pending.id, requestUser: context.managerRequestUser, input: { licenseNumber: `LN-${context.marker}-R3`, proposedStartDate: new Date('2029-01-01'), proposedExpiryDate: new Date('2029-12-31'), note: null } });
      const revisions = await prisma.employeeLicenseDocumentRevision.findMany({ where: { documentId: pending.id }, orderBy: { revision: 'asc' } });
      assert.equal(revisions.length, 3); assert.deepEqual(revisions.map((row) => row.revision), [1, 2, 3]);
      assert.equal(revisions[0].proposedLicenseNumber, `LN-${context.marker}-R1`); assert.equal(revisions[1].proposedLicenseNumber, `LN-${context.marker}-R2`); assert.equal(revisions[2].proposedLicenseNumber, `LN-${context.marker}-R3`);
      assert.equal(revisions[0].note, 'revision one'); assert.equal(revisions[1].note, 'revision two'); assert.equal(revisions[2].note, null);
      const approved = await context.service.approve({ id: pending.id, requestUser: context.requestUser });
      assert.equal(approved.status, 'APPROVED');
      const master = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } });
      assert.equal(master.licenseNumber, `LN-${context.marker}-R3`); assert.equal(master.expiryDate.toISOString().slice(0, 10), '2029-12-31');
      const finalAudit = await prisma.auditLog.findFirst({ where: { entityId: pending.id, metadata: { path: ['event'], equals: 'FINAL_APPROVE' } }, orderBy: { createdAt: 'desc' } });
      assert.ok(finalAudit); assert.equal(finalAudit.metadata.revision, 3); assert.equal(finalAudit.metadata.selfApproved, false);

      const cancellable = await context.service.upload({ licenseId: context.license.id, requestUser: context.managerRequestUser, file: { ...pdf, buffer: Buffer.from('%PDF-1.7\ncancel\n%%EOF'), size: 20 }, input: { licenseNumber: `LN-${context.marker}-CANCEL`, proposedStartDate: new Date('2030-01-01'), proposedExpiryDate: new Date('2030-12-31') } });
      created.documentIds.push(cancellable.id);
      await context.service.returnForCorrection({ id: cancellable.id, requestUser: context.requestUser, correctionReason: 'เจ้าของเลือกถอนคำขอ' });
      await assert.rejects(() => context.service.cancel({ id: cancellable.id, requestUser: context.requestUser }), (error) => error.statusCode === 403 && error.details?.code === 'LICENSE_DOCUMENT_REQUEST_OWNER_REQUIRED');
      const cancelled = await context.service.cancel({ id: cancellable.id, requestUser: context.managerRequestUser });
      assert.equal(cancelled.status, 'CANCELLED'); assert.equal(context.storage.objectExists(cancellable.storageObjectKey), true);
      await assert.rejects(() => context.service.resubmit({ id: cancellable.id, requestUser: context.managerRequestUser, input: { licenseNumber: 'AFTER-CANCEL', proposedStartDate: new Date('2031-01-01'), proposedExpiryDate: new Date('2031-12-31') } }), { statusCode: 409 });
      const cancelAudit = await prisma.auditLog.findFirst({ where: { entityId: cancellable.id, metadata: { path: ['event'], equals: 'CANCEL' } } });
      assert.ok(cancelAudit); assert.equal(cancelAudit.metadata.actorUserId, context.managerUser.id);
    } finally {
      await trackAudits(context.user.id);
      await trackAudits(context.managerUser.id);
    }
  });
}
