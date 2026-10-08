process.env.NODE_ENV = 'test';
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('license schedule isolation requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  const request = require('supertest');
  const target = new URL(process.env.DATABASE_URL || '');
  const databaseName = target.pathname.split('/').filter(Boolean).join('/');
  const isConfiguredTestTarget = databaseName === 'sms_v3_test' && (
    (target.hostname === 'host.docker.internal' && target.port === '5433')
    || (target.hostname === '127.0.0.1' && target.port === '5433')
    || (target.hostname === '127.0.0.1' && target.port === '5432' && process.env.TEST_DATABASE_RUNNER === 'docker-container-network')
  );
  if (!isConfiguredTestTarget) throw new Error('License schedule isolation tests require the isolated sms_v3_test target.');
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Production storage credentials must not be present in license schedule isolation tests.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const audit = require('../../src/services/audit.service');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { createLicenseDocumentService } = require('../../src/services/license-document.service');
  const { cleanupDueLicenseDocuments, expireDueLicenseDocuments } = require('../../src/services/license-document-retention.service');
  const { createFakeLicenseDocumentStorage } = require('../support/fake-license-document-storage');

  const runToken = randomUUID();
  const runMarker = 'license-isolation-' + runToken;
  const created = {
    documentIds: new Set(),
    employeeIds: new Set(),
    licenseIds: new Set(),
    scheduleApprovalEventIds: new Set(),
    scheduleApprovalIds: new Set(),
    userIds: new Set()
  };
  let fixtureMonth;

  function monthFor(attempt) {
    const offset = Number.parseInt(runToken.slice(attempt * 6, attempt * 6 + 6), 16);
    const year = 2000 + (offset % 7000);
    const month = (offset % 12) + 1;
    return new Date(Date.UTC(year, month - 1, 1));
  }

  function dateFor(day) {
    return new Date(Date.UTC(fixtureMonth.getUTCFullYear(), fixtureMonth.getUTCMonth(), day));
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  async function cleanupFixtures() {
    const userIds = [...created.userIds];
    const employeeIds = [...created.employeeIds];
    const licenseIds = [...created.licenseIds];
    const documentIds = [...created.documentIds];
    const approvalIds = [...created.scheduleApprovalIds];
    const eventIds = [...created.scheduleApprovalEventIds];
    const auditEntityIds = [...licenseIds, ...documentIds];

    if (userIds.length || auditEntityIds.length) {
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            ...(userIds.length ? [{ actorUserId: { in: userIds } }] : []),
            ...(auditEntityIds.length ? [{ entityId: { in: auditEntityIds } }] : [])
          ]
        }
      });
    }
    if (documentIds.length) {
      await prisma.employeeLicenseDocumentRevision.deleteMany({ where: { documentId: { in: documentIds } } });
      await prisma.employeeLicenseDocument.deleteMany({ where: { id: { in: documentIds } } });
    }
    if (employeeIds.length) await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: employeeIds } } });
    if (eventIds.length) await prisma.scheduleApprovalEvent.deleteMany({ where: { id: { in: eventIds } } });
    if (approvalIds.length) await prisma.scheduleApproval.deleteMany({ where: { id: { in: approvalIds } } });
    if (licenseIds.length) await prisma.employeeLicense.deleteMany({ where: { id: { in: licenseIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (employeeIds.length) await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

    for (const [model, ids] of [
      [prisma.employeeLicenseDocument, documentIds],
      [prisma.scheduleApproval, approvalIds],
      [prisma.employeeLicense, licenseIds],
      [prisma.user, userIds],
      [prisma.employee, employeeIds]
    ]) {
      if (ids.length) assert.equal(await model.count({ where: { id: { in: ids } } }), 0, 'License isolation fixtures were not cleaned up.');
    }
    if (employeeIds.length) {
      assert.equal(
        await prisma.shiftAssignment.count({ where: { employeeId: { in: employeeIds } } }),
        0,
        'Shift assignments for license isolation fixtures were not cleaned up.'
      );
    }
  }

  async function createUser(role, label) {
    const user = await prisma.user.create({
      data: {
        email: runToken + '-' + label + '@example.test',
        passwordHash: 'integration-test-only',
        displayName: 'License Isolation ' + label,
        role,
        accountStatus: 'ACTIVE',
        isActive: true
      }
    });
    created.userIds.add(user.id);
    return user;
  }

  async function createEmployee(label) {
    const employee = await prisma.employee.create({
      data: {
        employeeCode: 'LISO-' + runToken.slice(0, 12) + '-' + label,
        firstName: 'License',
        lastName: 'Fixture ' + label,
        department: 'Integration ' + runMarker,
        isActive: true
      }
    });
    created.employeeIds.add(employee.id);
    return employee;
  }

  async function createLicense(employee, label, status, issueDate, expiryDate) {
    const license = await prisma.employeeLicense.create({
      data: {
        legacyLicenseId: 'test:' + runToken + ':' + label,
        employeeId: employee.id,
        licenseType: 'Security Guard',
        licenseNumber: 'LN-' + runToken.slice(0, 16) + '-' + label,
        issueDate: new Date(issueDate),
        expiryDate: new Date(expiryDate),
        status
      }
    });
    created.licenseIds.add(license.id);
    return license;
  }

  function licenseScopedPrisma(licenseId) {
    return new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === 'employeeLicenseDocument') {
          return new Proxy(target.employeeLicenseDocument, {
            get(model, method, modelReceiver) {
              const value = Reflect.get(model, method, modelReceiver);
              if (method === 'findMany') {
                return (args = {}) => model.findMany({
                  ...args,
                  where: { ...(args?.where || {}), licenseId }
                });
              }
              return typeof value === 'function' ? value.bind(model) : value;
            }
          });
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  async function reserveScheduleApproval(userId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const month = monthFor(attempt);
      try {
        const approval = await prisma.scheduleApproval.create({
          data: {
            month,
            status: 'PENDING',
            revision: 0,
            changedByLegacyRef: userId,
            changeType: 'LICENSE_ISOLATION_TEST',
            approvalNote: runMarker
          }
        });
        created.scheduleApprovalIds.add(approval.id);
        return month;
      } catch (error) {
        if (error.code !== 'P2002' || attempt === 4) throw error;
      }
    }
    throw new Error('Unable to reserve an isolated schedule approval month.');
  }

  function assignmentInput(employee, shiftType, day, extra = {}) {
    return {
      employeeId: employee.id,
      shiftTypeId: shiftType.id,
      workDate: isoDate(dateFor(day)),
      remark: runMarker + ':' + shiftType.code + ':' + day,
      ...extra
    };
  }

  async function postBatch(token, employee, shiftType, day, extra = {}) {
    return request(app)
      .post('/api/v1/schedules/batch')
      .set('Authorization', 'Bearer ' + token)
      .send({ assignments: [assignmentInput(employee, shiftType, day, extra)], deletes: [] });
  }

  async function postSingle(token, employee, shiftType, day, extra = {}) {
    return request(app)
      .post('/api/v1/shifts')
      .set('Authorization', 'Bearer ' + token)
      .send(assignmentInput(employee, shiftType, day, extra));
  }

  async function assertBlocked(response, employee, day) {
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(JSON.stringify(response.body), /License Block:/);
    assert.equal(await prisma.shiftAssignment.count({
      where: { employeeId: employee.id, workDate: dateFor(day) }
    }), 0, 'A blocked license assignment must not be written.');
  }

  async function savedAssignment(employee, day) {
    return prisma.shiftAssignment.findUniqueOrThrow({
      where: { workDate_employeeId: { workDate: dateFor(day), employeeId: employee.id } }
    });
  }

  async function approveFixtureMonth(adminId) {
    const approvals = await prisma.scheduleApproval.findMany({
      where: { month: fixtureMonth },
      orderBy: { revision: 'asc' }
    });
    assert.ok(approvals.length > 0, 'Schedule saves should create or update a test approval revision.');
    for (const approval of approvals) created.scheduleApprovalIds.add(approval.id);
    const latest = approvals[approvals.length - 1];
    await prisma.scheduleApproval.update({
      where: { id: latest.id },
      data: {
        status: 'APPROVED',
        approvedByLegacyRef: adminId,
        approvedAt: new Date('2026-08-01T12:34:56.000Z'),
        approvalNote: runMarker + ': owner-approved-fixture',
        scheduleHash: runToken
      }
    });
    const events = await prisma.scheduleApprovalEvent.findMany({
      where: { month: fixtureMonth, performedByLegacyRef: adminId },
      select: { id: true }
    });
    for (const event of events) created.scheduleApprovalEventIds.add(event.id);
  }

  async function readScheduleSnapshot() {
    const employeeIds = [...created.employeeIds];
    const start = fixtureMonth;
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const assignments = await prisma.shiftAssignment.findMany({
      where: { employeeId: { in: employeeIds }, workDate: { gte: start, lt: end } },
      orderBy: [{ workDate: 'asc' }, { employeeId: 'asc' }]
    });
    const approvals = await prisma.scheduleApproval.findMany({
      where: { month: fixtureMonth },
      orderBy: { revision: 'asc' }
    });
    return { assignments, approvals };
  }

  async function assertScheduleUnchanged(baseline, operation) {
    assert.deepEqual(await readScheduleSnapshot(), baseline, 'License ' + operation + ' changed a ShiftAssignment or ScheduleApproval.');
  }

  test.beforeEach(cleanupFixtures);
  test.after(async () => {
    await cleanupFixtures();
    await prisma.$disconnect();
  });

  test('LICENSE BLOCK stays in force while license lifecycle cannot mutate existing shifts or approvals', async () => {
    const admin = await createUser('ADMIN', 'admin');
    const manager = await createUser('MANAGER', 'manager');
    const tokens = { admin: accessTokenFor(admin), manager: accessTokenFor(manager) };

    const expiredEmployee = await createEmployee('expired');
    const invalidEmployee = await createEmployee('invalid');
    const validEmployee = await createEmployee('valid');
    const expiredLicense = await createLicense(expiredEmployee, 'expired', 'Active', '1900-01-01', '1900-12-31');
    const invalidLicense = await createLicense(invalidEmployee, 'invalid', 'Revoked', '1900-01-01', '9998-12-31');
    await createLicense(validEmployee, 'valid', 'Active', '1900-01-01', '9998-12-31');

    fixtureMonth = await reserveScheduleApproval(admin.id);
    const [day, night, off, annualLeave] = await Promise.all([
      prisma.shiftType.findUniqueOrThrow({ where: { code: 'D' } }),
      prisma.shiftType.findUniqueOrThrow({ where: { code: 'N' } }),
      prisma.shiftType.findUniqueOrThrow({ where: { code: 'OFF' } }),
      prisma.shiftType.findUniqueOrThrow({ where: { code: 'AL' } })
    ]);

    await assertBlocked(await postBatch(tokens.admin, expiredEmployee, day, 1), expiredEmployee, 1);
    await assertBlocked(await postBatch(tokens.admin, expiredEmployee, night, 2), expiredEmployee, 2);
    await assertBlocked(await postBatch(tokens.admin, invalidEmployee, day, 1), invalidEmployee, 1);
    await assertBlocked(await postBatch(tokens.admin, invalidEmployee, night, 2), invalidEmployee, 2);

    await assertBlocked(await postSingle(tokens.admin, expiredEmployee, night, 12), expiredEmployee, 12);
    await assertBlocked(await postSingle(tokens.admin, invalidEmployee, day, 13), invalidEmployee, 13);

    const validDay = await postBatch(tokens.admin, validEmployee, day, 1);
    assert.equal(validDay.status, 200, JSON.stringify(validDay.body));
    assert.equal((await savedAssignment(validEmployee, 1)).licenseStatus, 'VALID');
    const validNight = await postBatch(tokens.admin, validEmployee, night, 2);
    assert.equal(validNight.status, 200, JSON.stringify(validNight.body));
    assert.equal((await savedAssignment(validEmployee, 2)).licenseStatus, 'VALID');
    const validSingle = await postSingle(tokens.admin, validEmployee, night, 14);
    assert.equal(validSingle.status, 201, JSON.stringify(validSingle.body));
    assert.equal((await savedAssignment(validEmployee, 14)).licenseStatus, 'VALID');

    const adminOverride = await postBatch(tokens.admin, expiredEmployee, day, 3, { licenseOverride: true, overrideReason: 'Approved coverage' });
    assert.equal(adminOverride.status, 200, JSON.stringify(adminOverride.body));
    assert.equal((await savedAssignment(expiredEmployee, 3)).licenseStatus, 'OVERRIDDEN');
    assert.equal((await savedAssignment(expiredEmployee, 3)).licenseOverride, true);
    const directAdminOverride = await postSingle(tokens.admin, invalidEmployee, night, 14, { licenseOverride: true, overrideReason: 'Approved coverage' });
    assert.equal(directAdminOverride.status, 201, JSON.stringify(directAdminOverride.body));
    assert.equal((await savedAssignment(invalidEmployee, 14)).licenseStatus, 'OVERRIDDEN');

    await assertBlocked(await postBatch(tokens.manager, expiredEmployee, night, 6, { licenseOverride: true, overrideReason: 'Manager coverage' }), expiredEmployee, 6);
    await assertBlocked(await postBatch(tokens.admin, invalidEmployee, day, 3, { licenseOverride: true, overrideReason: 'no' }), invalidEmployee, 3);
    await assertBlocked(await postSingle(tokens.manager, invalidEmployee, day, 4, { licenseOverride: true, overrideReason: 'Manager coverage' }), invalidEmployee, 4);

    const offAssignment = await postBatch(tokens.admin, expiredEmployee, off, 4);
    assert.equal(offAssignment.status, 200, JSON.stringify(offAssignment.body));
    assert.equal((await savedAssignment(expiredEmployee, 4)).licenseStatus, 'NOT_REQUIRED');
    const leaveAssignment = await postBatch(tokens.admin, invalidEmployee, annualLeave, 4);
    assert.equal(leaveAssignment.status, 200, JSON.stringify(leaveAssignment.body));
    assert.equal((await savedAssignment(invalidEmployee, 4)).licenseStatus, 'NOT_REQUIRED');
    const directOffAssignment = await postSingle(tokens.admin, expiredEmployee, off, 5);
    assert.equal(directOffAssignment.status, 201, JSON.stringify(directOffAssignment.body));
    assert.equal((await savedAssignment(expiredEmployee, 5)).licenseStatus, 'NOT_REQUIRED');
    const directLeaveAssignment = await postSingle(tokens.admin, invalidEmployee, annualLeave, 5);
    assert.equal(directLeaveAssignment.status, 201, JSON.stringify(directLeaveAssignment.body));
    assert.equal((await savedAssignment(invalidEmployee, 5)).licenseStatus, 'NOT_REQUIRED');

    await approveFixtureMonth(admin.id);
    const baseline = await readScheduleSnapshot();
    assert.ok(baseline.assignments.length >= 9);
    assert.equal(baseline.approvals[baseline.approvals.length - 1].status, 'APPROVED');

    const createdLicenseResponse = await request(app)
      .post('/api/v1/licenses')
      .set('Authorization', 'Bearer ' + tokens.admin)
      .send({
        employeeId: expiredEmployee.id,
        licenseType: 'Security Guard',
        licenseNumber: 'LN-' + runToken.slice(0, 16) + '-created',
        issueDate: '2020-01-01',
        expiryDate: '2030-12-31',
        status: 'Active'
      });
    assert.equal(createdLicenseResponse.status, 201, JSON.stringify(createdLicenseResponse.body));
    const addedLicenseId = createdLicenseResponse.body.data.id;
    created.licenseIds.add(addedLicenseId);
    await assertScheduleUnchanged(baseline, 'create');

    const updatedLicenseResponse = await request(app)
      .put('/api/v1/licenses/' + expiredLicense.id)
      .set('Authorization', 'Bearer ' + tokens.admin)
      .send({ remark: runMarker + ': update remark' });
    assert.equal(updatedLicenseResponse.status, 200, JSON.stringify(updatedLicenseResponse.body));
    await assertScheduleUnchanged(baseline, 'update');

    const deletedLicenseResponse = await request(app)
      .delete('/api/v1/licenses/' + addedLicenseId)
      .set('Authorization', 'Bearer ' + tokens.admin);
    assert.equal(deletedLicenseResponse.status, 204, JSON.stringify(deletedLicenseResponse.body));
    await assertScheduleUnchanged(baseline, 'delete');

    const storage = createFakeLicenseDocumentStorage();
    const documentService = createLicenseDocumentService({ prisma, storage, audit });
    const expiringDocument = await documentService.upload({
      licenseId: expiredLicense.id,
      requestUser: { sub: admin.id, role: 'ADMIN' },
      file: { buffer: Buffer.from('%PDF-1.7\n% license document fixture\n%%EOF\n'), mimetype: 'application/pdf', originalname: 'expired.pdf', size: Buffer.byteLength('%PDF-1.7\n% license document fixture\n%%EOF\n') },
      input: {
        licenseNumber: 'LN-' + runToken.slice(0, 16) + '-expired',
        proposedStartDate: new Date('2019-01-01'),
        proposedExpiryDate: new Date('2019-12-31')
      }
    });
    created.documentIds.add(expiringDocument.id);
    const approvedExpiredDocument = await documentService.approve({ id: expiringDocument.id, requestUser: { sub: admin.id, role: 'ADMIN' } });
    assert.equal(approvedExpiredDocument.status, 'APPROVED');
    await assertScheduleUnchanged(baseline, 'document approval');

    const lifecycleNow = new Date('2026-08-02T00:00:00Z');
    const scopedPrisma = licenseScopedPrisma(expiredLicense.id);
    const expiryResult = await expireDueLicenseDocuments({ prisma: scopedPrisma, storage, audit, now: lifecycleNow });
    assert.equal(expiryResult.expired, 1);
    await cleanupDueLicenseDocuments({ prisma: scopedPrisma, storage, now: lifecycleNow });
    assert.equal((await prisma.employeeLicenseDocument.findUniqueOrThrow({ where: { id: expiringDocument.id } })).status, 'EXPIRED');
    await assertScheduleUnchanged(baseline, 'expiry/retention cron housekeeping');

    const pendingRenewal = await documentService.upload({
      licenseId: expiredLicense.id,
      requestUser: { sub: admin.id, role: 'ADMIN' },
      file: { buffer: Buffer.from('%PDF-1.7\nlicense renewal'), mimetype: 'application/pdf', originalname: 'renewal.pdf', size: 26 },
      input: {
        licenseNumber: 'LN-' + runToken.slice(0, 16) + '-renewed',
        proposedStartDate: new Date('2020-01-01'),
        proposedExpiryDate: new Date('9998-12-31')
      }
    });
    created.documentIds.add(pendingRenewal.id);
    const approvedRenewal = await documentService.approve({ id: pendingRenewal.id, requestUser: { sub: admin.id, role: 'ADMIN' } });
    assert.equal(approvedRenewal.status, 'APPROVED');
    await assertScheduleUnchanged(baseline, 'document renewal');

    const licenseAudits = await prisma.auditLog.findMany({
      where: {
        actorUserId: admin.id,
        entityType: 'EmployeeLicense',
        entityId: { in: [...created.licenseIds] }
      },
      select: { action: true }
    });
    const licenseActions = new Set(licenseAudits.map((row) => row.action));
    assert.ok(licenseActions.has('CREATE'));
    assert.ok(licenseActions.has('UPDATE'));
    assert.ok(licenseActions.has('DELETE'));
    const documentAuditCount = await prisma.auditLog.count({
      where: {
        OR: [
          { actorUserId: admin.id, entityType: 'EmployeeLicenseDocument' },
          { entityId: { in: [...created.documentIds] }, entityType: 'EmployeeLicenseDocument' }
        ]
      }
    });
    assert.ok(documentAuditCount >= 3, 'Document upload, approval and expiry must retain audit events.');
  });
}
