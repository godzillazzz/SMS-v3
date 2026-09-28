'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && target.hostname === '127.0.0.1'
  && target.port === '5432'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('G06 Preview Attendance authority integration requires the isolated CI PostgreSQL target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const audit = require('../../src/services/audit.service');
  const {
    G06_UAT_EMPLOYEE_CODE,
    G06_UAT_EMAIL,
    G06_UAT_ASSIGNMENT_SOURCE,
    createG06UatProvisioningService
  } = require('../../src/services/g06-uat-provisioning.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    account: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    site: crypto.randomUUID()
  };
  const adminEmail = `g06-authority-admin-${marker}@example.test`;
  const siteCode = `G06-UAT-${marker.toUpperCase()}`;
  const location = { latitude: 13.7563, longitude: 100.5018, accuracyMeters: 5 };
  let clock;
  let approval;
  let shiftType;

  function monthCandidate(attempt) {
    const seed = Number.parseInt(marker.slice(0, 6), 16) + attempt;
    const year = 2070 + (seed % 20);
    const month = (seed % 12) + 1;
    return new Date(Date.UTC(year, month - 1, 1));
  }

  async function reserveApprovedMonth() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const month = monthCandidate(attempt);
      try {
        const row = await prisma.scheduleApproval.create({
          data: {
            month,
            status: 'APPROVED',
            revision: 9000 + attempt,
            changedByLegacyRef: `g06-uat-${marker}`,
            changeType: 'G06_UAT_INTEGRATION',
            approvedByLegacyRef: `g06-uat-${marker}`,
            approvedAt: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1, 1, 0, 0)),
            approvalNote: `isolated G06 Attendance authority integration ${marker}`
          }
        });
        return row;
      } catch (error) {
        if (error.code !== 'P2002' || attempt === 11) throw error;
      }
    }
    throw new Error('Unable to reserve an isolated approved schedule month.');
  }

  async function cleanup() {
    const existingEmployee = await prisma.employee.findUnique({ where: { employeeCode: G06_UAT_EMPLOYEE_CODE }, select: { id: true } }).catch(() => null);
    if (existingEmployee) {
      await prisma.attendanceEvent.deleteMany({ where: { session: { employeeId: existingEmployee.id } } }).catch(() => {});
      await prisma.attendanceSession.deleteMany({ where: { employeeId: existingEmployee.id } }).catch(() => {});
      await prisma.shiftAssignment.deleteMany({ where: { employeeId: existingEmployee.id } }).catch(() => {});
      await prisma.user.deleteMany({ where: { employeeId: existingEmployee.id } }).catch(() => {});
      await prisma.employee.deleteMany({ where: { id: existingEmployee.id } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { OR: [{ id: ids.admin }, { email: adminEmail }, { email: G06_UAT_EMAIL }] } }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: ids.site } }).catch(() => {});
    if (approval?.id) await prisma.scheduleApproval.deleteMany({ where: { id: approval.id } }).catch(() => {});
  }

  function service({ auditService = audit } = {}) {
    return createG06UatProvisioningService({
      prismaClient: prisma,
      auditService,
      environment: { VERCEL_ENV: 'preview', VERCEL_URL: 'integration-preview.vercel.app' },
      verifyDatabaseTarget: () => ({ required: true, matched: true }),
      clock: () => clock
    });
  }

  function sample(overrides = {}) {
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.accuracyMeters,
      capturedAt: clock.toISOString(),
      ...overrides
    };
  }

  test.before(async () => {
    await cleanup();
    shiftType = await prisma.shiftType.findUniqueOrThrow({ where: { code: 'D' } });
    approval = await reserveApprovedMonth();
    clock = new Date(Date.UTC(approval.month.getUTCFullYear(), approval.month.getUTCMonth(), 15, 3, 0, 0));

    await prisma.employee.create({
      data: {
        id: ids.employee,
        employeeCode: G06_UAT_EMPLOYEE_CODE,
        firstName: 'G06',
        lastName: 'Preview UAT',
        displayName: 'G06 Preview UAT',
        email: G06_UAT_EMAIL,
        department: 'UAT-PREVIEW',
        jobTitle: 'Officer',
        hiredAt: clock,
        skill: 'G06 Face Diagnostic',
        isActive: true
      }
    });
    await prisma.user.create({
      data: {
        id: ids.account,
        email: G06_UAT_EMAIL,
        passwordHash: 'integration-test-only',
        displayName: 'G06 Preview UAT',
        role: 'VIEWER',
        isActive: true,
        employeeId: ids.employee,
        department: 'UAT-PREVIEW',
        accountStatus: 'ACTIVE',
        passwordResetRequired: false,
        requestedAt: clock,
        approvedAt: clock
      }
    });
    await prisma.user.create({
      data: {
        id: ids.admin,
        email: adminEmail,
        passwordHash: 'integration-test-only',
        displayName: 'G06 Attendance Authority Admin',
        role: 'ADMIN',
        isActive: true,
        accountStatus: 'ACTIVE'
      }
    });
    await prisma.securitySite.create({
      data: {
        id: ids.site,
        code: siteCode,
        name: `G06 UAT Site ${marker}`,
        latitude: location.latitude,
        longitude: location.longitude,
        geofenceRadiusMeters: 100,
        isActive: true
      }
    });
  });

  test.beforeEach(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: ids.admin } });
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: ids.employee } });
  });

  test('real PostgreSQL creates one locked Site-bound G06 ShiftAssignment and leaves ScheduleApproval unchanged', async () => {
    const approvalBefore = await prisma.scheduleApproval.findUniqueOrThrow({ where: { id: approval.id } });
    const result = await service().prepareAttendanceAuthority({ actorUserId: ids.admin, location: sample() });

    assert.equal(result.idempotent, false);
    assert.equal(result.shift.code, 'D');
    assert.equal(result.site.id, ids.site);
    assert.equal(result.approval.status, 'APPROVED');
    assert.equal(result.approval.revision, approval.revision);

    const rows = await prisma.shiftAssignment.findMany({ where: { employeeId: ids.employee }, include: { shiftType: true, securitySite: true } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, G06_UAT_ASSIGNMENT_SOURCE);
    assert.equal(rows[0].locked, true);
    assert.equal(rows[0].shiftType.code, 'D');
    assert.equal(rows[0].securitySiteId, ids.site);
    assert.equal(rows[0].securitySite.code, siteCode);
    assert.equal(rows[0].employeeNameSnapshot, 'G06 Preview UAT');
    assert.equal(rows[0].departmentSnapshot, 'UAT-PREVIEW');
    assert.equal(rows[0].startTime, shiftType.startTime);
    assert.equal(rows[0].endTime, shiftType.endTime);

    const approvalAfter = await prisma.scheduleApproval.findUniqueOrThrow({ where: { id: approval.id } });
    assert.equal(approvalAfter.status, approvalBefore.status);
    assert.equal(approvalAfter.revision, approvalBefore.revision);
    assert.equal(approvalAfter.updatedAt.toISOString(), approvalBefore.updatedAt.toISOString());

    const audits = await prisma.auditLog.findMany({ where: { actorUserId: ids.admin, entityType: 'ShiftAssignment' } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entityId, rows[0].id);
    const metadata = audits[0].metadata || {};
    assert.equal(metadata.source, G06_UAT_ASSIGNMENT_SOURCE);
    assert.equal(metadata.securitySiteCode, siteCode);
    assert.equal(metadata.productionChanged, false);
  });

  test('real PostgreSQL retry is idempotent and keeps exactly one assignment/audit creation', async () => {
    const first = await service().prepareAttendanceAuthority({ actorUserId: ids.admin, location: sample() });
    const second = await service().prepareAttendanceAuthority({ actorUserId: ids.admin, location: sample() });
    assert.equal(first.idempotent, false);
    assert.equal(second.idempotent, true);
    assert.equal(second.assignment.id, first.assignment.id);
    assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: ids.employee } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: ids.admin, entityType: 'ShiftAssignment' } }), 1);
  });

  test('real PostgreSQL fails closed outside every Active Site without creating an assignment', async () => {
    await assert.rejects(
      () => service().prepareAttendanceAuthority({
        actorUserId: ids.admin,
        location: sample({ latitude: 14.7563, longitude: 101.5018 })
      }),
      (error) => error.statusCode === 409 && error.details?.code === 'G06_UAT_SITE_NOT_CONFIDENT_INSIDE'
    );
    assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: ids.employee } }), 0);
  });

  test('real PostgreSQL never overwrites a non-G06 assignment for the same Employee/date', async () => {
    const workDate = new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), 15));
    const existing = await prisma.shiftAssignment.create({
      data: {
        employeeId: ids.employee,
        shiftTypeId: shiftType.id,
        securitySiteId: ids.site,
        workDate,
        employeeNameSnapshot: 'G06 Preview UAT',
        departmentSnapshot: 'UAT-PREVIEW',
        startTime: shiftType.startTime,
        endTime: shiftType.endTime,
        hours: shiftType.hours,
        source: 'INTEGRATION_NON_G06',
        locked: true
      }
    });

    await assert.rejects(
      () => service().prepareAttendanceAuthority({ actorUserId: ids.admin, location: sample() }),
      (error) => error.statusCode === 409 && error.details?.code === 'G06_UAT_ASSIGNMENT_CONFLICT'
    );
    const after = await prisma.shiftAssignment.findUniqueOrThrow({ where: { id: existing.id } });
    assert.equal(after.source, 'INTEGRATION_NON_G06');
    assert.equal(after.securitySiteId, ids.site);
    assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: ids.employee } }), 1);
  });

  test('real PostgreSQL transaction rolls assignment back if audit persistence fails', async () => {
    const failingAudit = {
      log: async () => { throw new Error('SIMULATED_G06_UAT_AUDIT_FAILURE'); }
    };
    await assert.rejects(
      () => service({ auditService: failingAudit }).prepareAttendanceAuthority({ actorUserId: ids.admin, location: sample() }),
      /SIMULATED_G06_UAT_AUDIT_FAILURE/
    );
    assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: ids.employee } }), 0);
  });

  test.after(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
}