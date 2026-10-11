process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('license Cron regression requires an explicitly disposable database', { skip: true }, () => {});
} else {
  const target = new URL(process.env.DATABASE_URL || '');
  const local = target.hostname === '127.0.0.1';
  const allowed = target.pathname === '/sms_v3_test' && (
    (local && target.port === '5433')
    || (local && target.port === '5432' && process.env.TEST_DATABASE_RUNNER === 'docker-container-network')
    || (local && target.port === '55439' && process.env.TEST_DATABASE_RUNNER === 'license-cron-disposable-local')
  );
  if (!allowed) throw new Error('License Cron regression requires the allowlisted disposable sms_v3_test database.');
  if (process.env.SUPABASE_SERVICE_ROLE_KEY || ['production', 'preview'].includes(process.env.VERCEL_ENV)) {
    throw new Error('Hosted credentials and environments are forbidden in disposable Cron regression.');
  }
  const request = require('supertest');
  const prisma = require('../../src/config/prisma');
  const { createFakeLicenseDocumentStorage } = require('../support/fake-license-document-storage');
  const storage = createFakeLicenseDocumentStorage();
  const storageModule = require.resolve('../../src/services/license-document-storage.service');
  require.cache[storageModule] = { exports: {
    ...require(storageModule), createSupabaseLicenseDocumentStorage: () => storage
  } };
  const app = require('../../src/app');
  const audit = require('../../src/services/audit.service');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { bangkokToday, reconcileAllEmployeeLicenseSchedules } = require('../../src/services/license-schedule-reconciliation.service');
  const { expireDueLicenseDocuments, cleanupDueLicenseDocuments } = require('../../src/services/license-document-retention.service');
  const marker = randomUUID();
  const cronSecret = randomUUID();
  const employeeIds = [], userIds = [], licenseIds = [], documentIds = [], shiftIds = [], approvalIds = [];
  const employees = [], assignments = [];
  const future = new Date(Date.UTC(2100 + parseInt(marker.slice(0, 4), 16) % 7000, 4, 1));
  let day, off, leave, approvalBefore;
  const previousSecret = process.env.CRON_SECRET;

  test.before(async () => {
    process.env.CRON_SECRET = cronSecret;
    for (const [role, label] of [['ADMIN', 'admin'], ['MANAGER', 'manager'], ['SUPERVISOR', 'supervisor'], ['VIEWER', 'viewer']]) {
      const user = await prisma.user.create({ data: { email: marker + '-' + label + '@example.test', passwordHash: 'disposable-test-only', displayName: label, role, accountStatus: 'ACTIVE', isActive: true } });
      userIds.push(user.id);
    }
    off = await prisma.shiftType.findUnique({ where: { code: 'OFF' } });
    if (!off) {
      off = await prisma.shiftType.create({ data: { code: 'OFF', name: 'OFF disposable fixture', hours: 0, isActive: true } });
      shiftIds.push(off.id);
    }
    day = await prisma.shiftType.create({ data: { code: 'C' + marker.slice(0, 8).toUpperCase(), name: 'Cron fixture day', startTime: '08:00', endTime: '20:00', hours: 12, isActive: true } });
    shiftIds.push(day.id);
    leave = await prisma.shiftType.findUnique({ where: { code: 'AL' } });
    if (!leave) {
      leave = await prisma.shiftType.create({ data: { code: 'AL', name: 'Leave disposable fixture', hours: 0, isActive: true } });
      shiftIds.push(leave.id);
    }
    const specs = [
      { jobTitle: 'Security Guard' }, { jobTitle: 'รปภ.' }, { jobTitle: 'เจ้าหน้าที่รักษาความปลอดภัย' },
      { jobTitle: 'Human Resources' }, { jobTitle: null },
      { jobTitle: 'Security Guard', isActive: false }, { jobTitle: 'Security Guard', deletedAt: new Date() }
    ];
    for (const [index, spec] of specs.entries()) {
      const employee = await prisma.employee.create({ data: { employeeCode: 'CRON-' + marker.slice(0, 12) + '-' + index, firstName: 'Cron', lastName: 'Fixture', department: index % 2 ? 'Cron B' : 'Cron A', isActive: true, ...spec } });
      employees.push(employee); employeeIds.push(employee.id);
      const assignment = await prisma.shiftAssignment.create({ data: { employeeId: employee.id, shiftTypeId: day.id, workDate: future, employeeNameSnapshot: 'Cron Fixture', hours: 12, startTime: '08:00', endTime: '20:00', remark: marker } });
      assignments.push(assignment);
    }
    for (const [offset, shift, extra] of [[1, day, { licenseOverride: true, overrideReason: 'Approved fixture override' }], [2, leave, {}]]) {
      await prisma.shiftAssignment.create({ data: { employeeId: employees[0].id, shiftTypeId: shift.id, workDate: new Date(future.getTime() + offset * 86400000), employeeNameSnapshot: 'Cron Fixture', hours: shift.hours, remark: marker, ...extra } });
    }
    const approval = await prisma.scheduleApproval.create({ data: { month: future, status: 'PENDING', revision: 0, approvalNote: marker } });
    approvalIds.push(approval.id); approvalBefore = approval;
  });

  test.after(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...employeeIds, ...licenseIds, ...documentIds] } }, { actorUserId: { in: userIds } }] } });
      await prisma.employeeLicenseDocumentRevision.deleteMany({ where: { documentId: { in: documentIds } } });
      await prisma.employeeLicenseDocument.deleteMany({ where: { id: { in: documentIds } } });
      await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds } } });
      await prisma.scheduleApproval.deleteMany({ where: { id: { in: approvalIds } } });
      await prisma.employeeLicense.deleteMany({ where: { id: { in: licenseIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
      await prisma.shiftType.deleteMany({ where: { id: { in: shiftIds } } });
      for (const [model, ids] of [[prisma.employee, employeeIds], [prisma.user, userIds], [prisma.employeeLicenseDocument, documentIds], [prisma.employeeLicense, licenseIds], [prisma.scheduleApproval, approvalIds]]) {
        assert.equal(await model.count({ where: { id: { in: ids } } }), 0, 'Disposable Cron fixture cleanup failed.');
      }
      assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: { in: employeeIds } } }), 0);
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
      await prisma.$disconnect();
    }
  });

  test('no secret or user role token can invoke the Cron or change disposable business records', async () => {
    const before = await prisma.shiftAssignment.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } });
    assert.equal((await request(app).get('/api/v1/internal/license-reconciliation')).status, 401);
    for (const id of userIds) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id } });
      assert.equal((await request(app).get('/api/v1/internal/license-reconciliation').set('Authorization', 'Bearer ' + accessTokenFor(user))).status, 401);
    }
    assert.deepEqual(await prisma.shiftAssignment.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }), before);
    assert.equal(storage.calls.remove.length, 0);
  });

  test('bulk reconciliation affects active guards across departments and preserves other employees, overrides, leave and approval state', async () => {
    await reconcileAllEmployeeLicenseSchedules(prisma);
    for (const [index, assignment] of assignments.entries()) {
      const after = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
      if (index < 3) assert.equal(after.shiftTypeId, off.id);
      else assert.deepEqual(after, assignment, 'Non-guard or inactive employee was changed.');
    }
    const override = await prisma.shiftAssignment.findUniqueOrThrow({ where: { workDate_employeeId: { workDate: new Date(future.getTime() + 86400000), employeeId: employees[0].id } } });
    assert.equal(override.shiftTypeId, day.id); assert.equal(override.licenseOverride, true);
    const annualLeave = await prisma.shiftAssignment.findUniqueOrThrow({ where: { workDate_employeeId: { workDate: new Date(future.getTime() + 2 * 86400000), employeeId: employees[0].id } } });
    assert.equal(annualLeave.shiftTypeId, leave.id);
    assert.deepEqual(await prisma.scheduleApproval.findUniqueOrThrow({ where: { id: approvalIds[0] } }), approvalBefore);
    assert.equal(await prisma.scheduleApprovalEvent.count({ where: { month: future } }), 0);
  });

  test('scheduled GET reaches real Prisma with a distinct Cron secret, repeats idempotently and cannot grant user API access', async () => {
    const response = await request(app).get('/api/v1/internal/license-reconciliation').set('Authorization', 'Bearer ' + cronSecret);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.schedule.affectedAssignments, 0);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal((await request(app).head('/api/v1/internal/license-reconciliation').set('Authorization', 'Bearer ' + cronSecret)).status, 401);
    assert.equal((await request(app).get('/api/v1/licenses').set('Authorization', 'Bearer ' + cronSecret)).status, 401);
    assert.deepEqual(await prisma.scheduleApproval.findUniqueOrThrow({ where: { id: approvalIds[0] } }), approvalBefore);
  });

  async function documentFor(employee, label) {
    const license = await prisma.employeeLicense.create({ data: { employeeId: employee.id, legacyLicenseId: marker + '-' + label, licenseType: 'Security Guard', licenseNumber: label + '-' + marker, issueDate: new Date('2026-01-01'), expiryDate: new Date('2026-07-31'), status: 'Active' } });
    licenseIds.push(license.id);
    const document = await prisma.employeeLicenseDocument.create({ data: { employeeId: employee.id, licenseId: license.id, storageProvider: 'fake', storageBucket: 'disposable-only', storageObjectKey: marker + '/' + label, originalFileName: 'fixture.pdf', safeDisplayFileName: 'fixture.pdf', mimeType: 'application/pdf', fileSize: 8, proposedStartDate: license.issueDate, proposedExpiryDate: license.expiryDate, status: 'APPROVED', isCurrent: true, uploadedById: userIds[0], version: 1 } });
    documentIds.push(document.id);
    await storage.put(document.storageObjectKey, { buffer: Buffer.from('%PDF-1.7\n%%EOF'), mimetype: 'application/pdf', size: 8 });
    return document;
  }

  test('real database expiration uses Bangkok inclusive dates and deletes only guard files with idempotent retry', async () => {
    const guard = await documentFor(employees[0], 'guard');
    const staff = await documentFor(employees[3], 'staff');
    const before = await expireDueLicenseDocuments({ prisma, storage, audit, now: new Date('2026-07-31T16:59:59Z') });
    assert.equal(before.expired, 0);
    storage.failNextRemove();
    const first = await expireDueLicenseDocuments({ prisma, storage, audit, now: new Date('2026-07-31T17:05:00Z') });
    assert.equal(first.expired, 1); assert.equal(first.failed, 1);
    const expired = await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: guard.id } });
    assert.equal(expired.status, 'EXPIRED'); assert.equal(expired.isCurrent, false);
    assert.equal(expired.storageDeleteAttempts, 1); assert.equal(expired.storageDeleteLastErrorCode, 'Error');
    assert.deepEqual(await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: staff.id } }), staff);
    // Even an incorrectly classified legacy expired document must not authorize deleting non-guard files.
    await prisma.employeeLicenseDocument.update({ where: { id: staff.id }, data: { status: 'EXPIRED', isCurrent: false, storageDeleteAfter: new Date('2026-07-31T17:05:00Z') } });
    const cleanup = await cleanupDueLicenseDocuments({ prisma, storage, now: new Date('2026-07-31T17:06:00Z') });
    assert.equal(cleanup.deleted, 1); assert.equal(cleanup.failed, 0);
    assert.equal(storage.objectExists(guard.storageObjectKey), false);
    assert.equal(storage.objectExists(staff.storageObjectKey), true);
    assert.equal((await expireDueLicenseDocuments({ prisma, storage, audit, now: new Date('2026-07-31T17:07:00Z') })).expired, 0);
    assert.equal((await cleanupDueLicenseDocuments({ prisma, storage, now: new Date('2026-07-31T17:07:00Z') })).deleted, 0);
    assert.equal(await prisma.auditLog.count({ where: { entityId: guard.id, entityType: 'EmployeeLicenseDocument' } }), 1);
    assert.equal(await prisma.attendanceSession.count({ where: { employeeId: { in: employeeIds } } }), 0);
    assert.equal(bangkokToday('2026-07-31T17:05:00Z').toISOString().slice(0, 10), '2026-08-01');
  });
}
