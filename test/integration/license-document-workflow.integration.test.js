process.env.NODE_ENV = 'test';
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('license document integration suite requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  const target = new URL(process.env.DATABASE_URL || '');
  if (target.hostname !== 'host.docker.internal' || target.port !== '5433' || target.pathname.replace(/^\//, '') !== 'sms_v3_test') throw new Error('License document integration tests require host.docker.internal:5433/sms_v3_test.');
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Production storage credentials must not be present in license document integration tests.');

  const prisma = require('../../src/config/prisma');
  const audit = require('../../src/services/audit.service');
  const { reconcileEmployeeLicenseSchedules } = require('../../src/services/license-schedule-reconciliation.service');
  const { createLicenseDocumentService } = require('../../src/services/license-document.service');
  const { createFakeLicenseDocumentStorage } = require('../support/fake-license-document-storage');

  const pdf = { buffer: Buffer.from('%PDF-1.7\nintegration fixture'), mimetype: 'application/pdf', originalname: 'integration-license.pdf', size: 32 };
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
    created.userIds.push(user.id);
    const license = await prisma.employeeLicense.create({ data: { legacyLicenseId: `v3:${marker}`, employeeId: employee.id, licenseType: 'Security Guard', licenseNumber: `LN-${marker}`, issueDate: new Date('2026-01-01'), expiryDate: new Date('2026-12-31'), status: 'Active' } });
    created.licenseIds.push(license.id);
    const storage = createFakeLicenseDocumentStorage();
    const service = createLicenseDocumentService({ prisma, storage, audit, reconcileSchedules: reconcileEmployeeLicenseSchedules });
    return { marker, employee, user, license, storage, service, requestUser: { sub: user.id, role: 'ADMIN' } };
  }

  async function trackAudits(userId) {
    const rows = await prisma.auditLog.findMany({ where: { actorUserId: userId }, select: { id: true } });
    created.auditIds.push(...rows.map((row) => row.id).filter((id) => !created.auditIds.includes(id)));
  }

  async function runWorkflow(round) {
    const context = await fixture(`round-${round}`);
    const first = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: pdf, input: { proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31'), note: `round ${round}` } });
    created.documentIds.push(first.id);
    assert.equal(first.status, 'PENDING'); assert.equal(first.isCurrent, false);
    const beforeApprove = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } });
    assert.equal(beforeApprove.expiryDate.toISOString().slice(0, 10), '2026-12-31');
    const history = await context.service.list({ licenseId: context.license.id, requestUser: context.requestUser });
    assert.equal(history[0].id, first.id); assert.equal('storageObjectKey' in history[0], false);
    const view = await context.service.view({ id: first.id, requestUser: context.requestUser });
    assert.match(view.url, /^https:\/\/fake-storage\.invalid\//); assert.equal(context.storage.calls.createSignedUrl[0].expiresIn, 600);
    const approved = await context.service.approve({ id: first.id, requestUser: context.requestUser });
    assert.equal(approved.uploadedById, context.user.id); assert.equal(approved.reviewedById, context.user.id); assert.equal(approved.isCurrent, true);
    const approvedMaster = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } });
    assert.equal(approvedMaster.expiryDate.toISOString().slice(0, 10), '2027-12-31');

    const renewal = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: { ...pdf, buffer: Buffer.from('%PDF-1.7\nrenewal'), size: 18 }, input: { proposedStartDate: new Date('2028-01-01'), proposedExpiryDate: new Date('2028-12-31') } });
    created.documentIds.push(renewal.id);
    assert.equal((await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: first.id } })).isCurrent, true);
    await context.service.approve({ id: renewal.id, requestUser: context.requestUser });
    const versions = await prisma.employeeLicenseDocument.findMany({ where: { licenseId: context.license.id }, orderBy: { version: 'asc' } });
    assert.equal(versions[0].status, 'SUPERSEDED'); assert.equal(versions[0].isCurrent, false);
    assert.equal(versions[1].status, 'APPROVED'); assert.equal(versions[1].isCurrent, true);
    assert.equal(versions.filter((document) => document.isCurrent).length, 1);

    const rejectedCandidate = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: { ...pdf, buffer: Buffer.from('%PDF-1.7\nreject'), size: 17 }, input: { proposedStartDate: new Date('2029-01-01'), proposedExpiryDate: new Date('2029-12-31') } });
    created.documentIds.push(rejectedCandidate.id);
    const currentBeforeReject = (await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } })).expiryDate;
    await context.service.reject({ id: rejectedCandidate.id, requestUser: context.requestUser, rejectionReason: 'Integration rejection' });
    const afterReject = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: context.license.id } });
    assert.equal(afterReject.expiryDate.getTime(), currentBeforeReject.getTime());
    assert.equal((await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: renewal.id } })).isCurrent, true);
    assert.equal(context.storage.objectExists(rejectedCandidate.storageObjectKey), true);
    await trackAudits(context.user.id);
  }

  test.beforeEach(cleanup);
  test.after(async () => { await cleanup(); await prisma.$disconnect(); });

  for (let round = 1; round <= 3; round += 1) test(`license document workflow is isolated and repeatable (round ${round})`, () => runWorkflow(round));

  test('approval rolls back when audit creation fails', async () => {
    const context = await fixture('rollback');
    const pending = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: pdf, input: { proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } });
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
    const pending = await context.service.upload({ licenseId: context.license.id, requestUser: context.requestUser, file: pdf, input: { proposedStartDate: new Date('2027-01-01'), proposedExpiryDate: new Date('2027-12-31') } });
    created.documentIds.push(pending.id);
    const results = await Promise.allSettled([context.service.approve({ id: pending.id, requestUser: context.requestUser }), context.service.approve({ id: pending.id, requestUser: context.requestUser })]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.statusCode, 409);
    assert.equal(await prisma.employeeLicenseDocument.count({ where: { licenseId: context.license.id, isCurrent: true } }), 1);
    const approvalAudits = await prisma.auditLog.count({ where: { entityId: pending.id, metadata: { path: ['event'], equals: 'APPROVE' } } });
    assert.equal(approvalAudits, 1);
    await trackAudits(context.user.id);
  });
}
