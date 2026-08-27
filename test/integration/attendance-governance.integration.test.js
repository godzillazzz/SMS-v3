'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Prisma } = require('@prisma/client');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'docker-container-network'
  && target.hostname === '127.0.0.1'
  && target.port === '5432'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('Attendance governance integration requires isolated CI PostgreSQL', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createAttendanceCorrectionService } = require('../../src/services/attendance-correction.service');
  const { createAttendanceAdjustmentService } = require('../../src/services/attendance-adjustment.service');
  const { createAttendanceMonthGovernanceService } = require('../../src/services/attendance-month-governance.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    site: crypto.randomUUID(),
    shiftType: crypto.randomUUID(),
    assignment: crypto.randomUUID()
  };
  const department = `ATT-GOV-${marker.toUpperCase()}`;
  const workDate = new Date('2099-02-10T00:00:00.000Z');
  const monthStart = new Date('2099-02-01T00:00:00.000Z');
  const now = new Date('2099-03-05T03:00:00.000Z');
  const actor = { sub: ids.admin, role: 'ADMIN' };
  const corrections = createAttendanceCorrectionService({ prisma, clock: () => now });
  const adjustments = createAttendanceAdjustmentService({ prisma, clock: () => now });
  const governance = createAttendanceMonthGovernanceService({ prisma, clock: () => now });

  async function cleanup() {
    await prisma.$executeRaw(Prisma.sql`DELETE FROM attendance_month_certifications WHERE month = ${monthStart}::date`).catch(() => {});
    await prisma.$executeRaw(Prisma.sql`DELETE FROM attendance_corrections WHERE shift_assignment_id = ${ids.assignment}::uuid`).catch(() => {});
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM attendance_adjustment_events
      WHERE request_id IN (
        SELECT id FROM attendance_adjustment_requests WHERE shift_assignment_id = ${ids.assignment}::uuid
      )
    `).catch(() => {});
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM attendance_adjustment_revisions
      WHERE request_id IN (
        SELECT id FROM attendance_adjustment_requests WHERE shift_assignment_id = ${ids.assignment}::uuid
      )
    `).catch(() => {});
    await prisma.$executeRaw(Prisma.sql`DELETE FROM attendance_adjustment_requests WHERE shift_assignment_id = ${ids.assignment}::uuid`).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { actorUserId: ids.admin } }).catch(() => {});
    await prisma.scheduleApproval.deleteMany({ where: { month: monthStart } }).catch(() => {});
    await prisma.shiftAssignment.deleteMany({ where: { id: ids.assignment } }).catch(() => {});
    await prisma.shiftType.deleteMany({ where: { id: ids.shiftType } }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: ids.site } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  test.before(async () => {
    await cleanup();
    await prisma.employee.create({
      data: {
        id: ids.employee,
        employeeCode: `ATG-${marker.toUpperCase()}`,
        firstName: 'Attendance',
        lastName: 'Governance',
        displayName: 'Attendance Governance',
        department
      }
    });
    await prisma.user.create({
      data: {
        id: ids.admin,
        email: `attendance-governance-${marker}@example.test`,
        passwordHash: 'test-only',
        displayName: 'Attendance Governance Admin',
        role: 'ADMIN'
      }
    });
    await prisma.securitySite.create({
      data: {
        id: ids.site,
        code: `ATG-${marker.toUpperCase()}`,
        name: 'Attendance Governance Site',
        latitude: 13.7241,
        longitude: 100.5701,
        geofenceRadiusMeters: 120,
        isActive: true
      }
    });
    await prisma.shiftType.create({
      data: {
        id: ids.shiftType,
        code: `ATG-${marker.toUpperCase()}`,
        name: 'Governance Day',
        startTime: '07:00',
        endTime: '19:00',
        hours: 12
      }
    });
    await prisma.shiftAssignment.create({
      data: {
        id: ids.assignment,
        employeeId: ids.employee,
        shiftTypeId: ids.shiftType,
        securitySiteId: ids.site,
        workDate,
        employeeNameSnapshot: 'Attendance Governance',
        departmentSnapshot: department,
        startTime: '07:00',
        endTime: '19:00',
        hours: 12,
        locked: true
      }
    });
    await prisma.scheduleApproval.create({
      data: {
        month: monthStart,
        status: 'APPROVED',
        revision: 1,
        approvedAt: new Date('2099-02-01T00:00:00.000Z')
      }
    });
  });

  test.after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test('only explicit ADMIN-approved adjustment requests affect monthly governance and certification', async () => {
    await assert.rejects(
      () => adjustments.createDraft({
        actor: { sub: crypto.randomUUID(), role: 'MANAGER', department: 'OTHER-DEPARTMENT' },
        assignmentId: ids.assignment,
        requestType: 'CONFIRM_WORK_PERFORMED',
        proposal: {
          checkInAt: '2099-02-10T00:00:00.000Z',
          checkOutAt: '2099-02-10T12:00:00.000Z'
        },
        reason: 'Cross department must fail'
      }),
      (error) => error.details?.code === 'ATTENDANCE_ADJUSTMENT_SCOPE_FORBIDDEN'
    );

    const draft = await adjustments.createDraft({
      actor,
      assignmentId: ids.assignment,
      requestType: 'CONFIRM_WORK_PERFORMED',
      proposal: {
        checkInAt: '2099-02-10T00:00:00.000Z',
        checkOutAt: '2099-02-10T12:00:00.000Z'
      },
      reason: 'Verified work performed from governed source'
    });
    assert.equal(draft.status, 'DRAFT');

    const pending = await adjustments.submit({ actor, id: draft.id });
    assert.equal(pending.status, 'PENDING_APPROVAL');

    const blockedPreview = await governance.preview('2099-02');
    const blockedRow = blockedPreview.rows.find((item) => item.assignmentId === ids.assignment);
    assert.equal(blockedRow.originalCheckInAt, null);
    assert.equal(blockedRow.originalCheckOutAt, null);
    assert.equal(blockedRow.checkInAt, null);
    assert.equal(blockedRow.checkOutAt, null);
    assert.ok(blockedRow.flags.includes('ABSENT'));
    assert.ok(!blockedRow.flags.includes('CORRECTED'));
    assert.equal(blockedPreview.blockerCount, 0, 'pending request must not alter or block monthly authority');

    const absentCertification = await governance.certify({ actor, month: '2099-02' });
    assert.equal(absentCertification.status, 'CERTIFIED');
    assert.equal(absentCertification.revision, 1);

    await assert.rejects(
      () => adjustments.approve({ actor, id: draft.id }),
      (error) => error.details?.code === 'ATTENDANCE_MONTH_CERTIFIED'
    );

    const stillPendingBeforeUnlock = await adjustments.get({ actor, id: draft.id });
    assert.equal(stillPendingBeforeUnlock.status, 'PENDING_APPROVAL');
    assert.equal(stillPendingBeforeUnlock.approverUserId, null);

    const firstUnlock = await governance.unlock({ actor, month: '2099-02', reason: 'Reopen to review pending Attendance evidence' });
    assert.equal(firstUnlock.status, 'UNLOCKED');
    assert.equal(firstUnlock.revision, 1);

    const approved = await adjustments.approve({ actor, id: draft.id });
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.approverUserId, ids.admin);

    const session = await prisma.attendanceSession.findUnique({ where: { shiftAssignmentId: ids.assignment } });
    assert.equal(session, null, 'approved governance overlay must not fabricate immutable raw Attendance evidence');

    const readyPreview = await governance.preview('2099-02');
    const readyRow = readyPreview.rows.find((item) => item.assignmentId === ids.assignment);
    assert.equal(readyRow.status, 'COMPLETE');
    assert.equal(readyRow.workedMinutes, 720);
    assert.equal(new Date(readyRow.checkInAt).toISOString(), '2099-02-10T00:00:00.000Z');
    assert.equal(new Date(readyRow.checkOutAt).toISOString(), '2099-02-10T12:00:00.000Z');
    assert.ok(readyRow.flags.includes('CORRECTED'));
    assert.equal(readyPreview.blockerCount, 0);

    const correctedCertification = await governance.certify({ actor, month: '2099-02' });
    assert.equal(correctedCertification.status, 'CERTIFIED');
    assert.equal(correctedCertification.revision, 2);
    assert.match(correctedCertification.summaryDigest, /^[0-9a-f]{64}$/);

    const laterDraft = await adjustments.createDraft({
      actor,
      assignmentId: ids.assignment,
      requestType: 'ADJUST_WORK_TIME',
      proposal: { checkOutAt: '2099-02-10T11:59:00.000Z' },
      reason: 'Verified final checkout adjustment'
    });
    await adjustments.submit({ actor, id: laterDraft.id });

    await assert.rejects(
      () => adjustments.approve({ actor, id: laterDraft.id }),
      (error) => error.details?.code === 'ATTENDANCE_MONTH_CERTIFIED'
    );

    const stillPending = await adjustments.get({ actor, id: laterDraft.id });
    assert.equal(stillPending.status, 'PENDING_APPROVAL');
    assert.equal(stillPending.approverUserId, null);

    const unlocked = await governance.unlock({ actor, month: '2099-02', reason: 'Reopen for verified correction' });
    assert.equal(unlocked.status, 'UNLOCKED');
    assert.equal(unlocked.revision, 2);

    const laterApproved = await adjustments.approve({ actor, id: laterDraft.id });
    assert.equal(laterApproved.status, 'APPROVED');

    const finalCertification = await governance.certify({ actor, month: '2099-02' });
    assert.equal(finalCertification.revision, 3);
    assert.equal(finalCertification.status, 'CERTIFIED');

    const history = await governance.certificationHistory('2099-02');
    assert.deepEqual(history.map((item) => [item.revision, item.status]), [[3, 'CERTIFIED'], [2, 'UNLOCKED'], [1, 'UNLOCKED']]);

    const correctionHistory = await corrections.list({ actor, assignmentId: ids.assignment });
    assert.equal(correctionHistory.length, 3);
    assert.equal(correctionHistory.filter((item) => item.isCurrent).length, 2);
    assert.equal(correctionHistory.filter((item) => !item.isCurrent).length, 1);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        actorUserId: ids.admin,
        entityType: { in: ['AttendanceAdjustmentRequest', 'AttendanceCorrection', 'AttendanceMonthCertification'] }
      }
    });
    assert.ok(auditRows.length >= 8);
  });
}
