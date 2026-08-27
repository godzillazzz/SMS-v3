
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
  test('Attendance adjustment V4 integration requires isolated CI PostgreSQL', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createAttendanceAdjustmentService } = require('../../src/services/attendance-adjustment.service');
  const { createAttendanceSelfService } = require('../../src/services/attendance-self.service');
  const {
    currentCorrectionsForAssignments,
    createAttendanceCorrectionService
  } = require('../../src/services/attendance-correction.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    manager: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    viewer: crypto.randomUUID(),
    site: crypto.randomUUID(),
    shiftType: crypto.randomUUID(),
    assignment: crypto.randomUUID()
  };
  const department = `ATT-ADJ-${marker.toUpperCase()}`;
  const workDate = new Date('2099-04-10T00:00:00.000Z');
  const clock = () => new Date('2099-04-10T02:00:00.000Z');
  const service = createAttendanceAdjustmentService({ prisma, clock });
  const selfService = createAttendanceSelfService({ prisma, clock });
  const legacyCorrection = createAttendanceCorrectionService({ prisma, clock });
  const manager = { sub: ids.manager, role: 'MANAGER', department };
  const admin = { sub: ids.admin, role: 'ADMIN' };
  const viewer = { sub: ids.viewer, role: 'VIEWER' };

  async function cleanup() {
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
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM attendance_corrections WHERE shift_assignment_id = ${ids.assignment}::uuid
    `).catch(() => {});
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM attendance_adjustment_requests WHERE shift_assignment_id = ${ids.assignment}::uuid
    `).catch(() => {});
    await prisma.auditLog.deleteMany({
      where: {
        actorUserId: { in: [ids.manager, ids.admin] },
        entityType: { in: ['AttendanceAdjustmentRequest', 'AttendanceCorrection'] }
      }
    }).catch(() => {});
    await prisma.shiftAssignment.deleteMany({ where: { id: ids.assignment } }).catch(() => {});
    await prisma.shiftType.deleteMany({ where: { id: ids.shiftType } }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: ids.site } }).catch(() => {});
    await prisma.scheduleApproval.deleteMany({ where: { month: new Date('2099-04-01T00:00:00.000Z') } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ids.manager, ids.admin, ids.viewer] } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  test.before(async () => {
    await cleanup();
    await prisma.employee.create({
      data: {
        id: ids.employee,
        employeeCode: `AAD-${marker.toUpperCase()}`,
        firstName: 'Attendance',
        lastName: 'Adjustment',
        displayName: 'Attendance Adjustment',
        department
      }
    });
    await prisma.user.createMany({
      data: [
        {
          id: ids.manager,
          email: `attendance-adjustment-manager-${marker}@example.test`,
          passwordHash: 'test-only',
          displayName: 'Attendance Adjustment Manager',
          role: 'MANAGER',
          department
        },
        {
          id: ids.admin,
          email: `attendance-adjustment-admin-${marker}@example.test`,
          passwordHash: 'test-only',
          displayName: 'Attendance Adjustment Admin',
          role: 'ADMIN'
        },
        {
          id: ids.viewer,
          email: `attendance-adjustment-viewer-${marker}@example.test`,
          passwordHash: 'test-only',
          displayName: 'Attendance Adjustment Employee',
          role: 'VIEWER',
          employeeId: ids.employee,
          department
        }
      ]
    });
    await prisma.securitySite.create({
      data: {
        id: ids.site,
        code: `AAD-${marker.toUpperCase()}`,
        name: 'Attendance Adjustment Site',
        latitude: 13.7241,
        longitude: 100.5701,
        geofenceRadiusMeters: 120,
        isActive: true
      }
    });
    await prisma.shiftType.create({
      data: {
        id: ids.shiftType,
        code: `AAD-${marker.toUpperCase()}`,
        name: 'Adjustment Day',
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
        employeeNameSnapshot: 'Attendance Adjustment',
        departmentSnapshot: department,
        startTime: '07:00',
        endTime: '19:00',
        hours: 12,
        locked: true
      }
    });
    await prisma.scheduleApproval.create({
      data: {
        month: new Date('2099-04-01T00:00:00.000Z'),
        status: 'APPROVED',
        revision: 1,
        approvedAt: new Date('2099-04-01T00:00:00.000Z')
      }
    });
  });

  test.after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test('pending Manager request has zero authority effect; Manager approval is forbidden; ADMIN approval creates effective provenance', async () => {
    const draft = await service.createDraft({
      actor: manager,
      assignmentId: ids.assignment,
      requestType: 'CONFIRM_WORK_PERFORMED',
      proposal: {
        checkInAt: '2099-04-10T00:00:00.000Z',
        checkOutAt: '2099-04-10T12:00:00.000Z'
      },
      reason: 'Verified work performed from supervisor evidence'
    });
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.makerUserId, ids.manager);
    assert.equal(draft.currentRevision, 1);

    let corrections = await currentCorrectionsForAssignments(prisma, [ids.assignment]);
    assert.equal(corrections.length, 0);

    const pending = await service.submit({ actor: manager, id: draft.id });
    assert.equal(pending.status, 'PENDING_APPROVAL');

    corrections = await currentCorrectionsForAssignments(prisma, [ids.assignment]);
    assert.equal(corrections.length, 0, 'pending request must not change authoritative Attendance');

    const pendingHistory = await selfService.history({
      actor: viewer,
      from: '2099-04-10',
      to: '2099-04-10'
    });
    assert.equal(pendingHistory.rows.length, 1);
    assert.equal(pendingHistory.rows[0].checkInAt, null);
    assert.equal(pendingHistory.rows[0].checkOutAt, null);
    assert.equal(pendingHistory.rows[0].corrected, false);
    assert.equal(pendingHistory.rows[0].authority, 'RAW_ATTENDANCE_EVENT');

    await assert.rejects(
      () => service.approve({ actor: manager, id: draft.id }),
      (error) => error.statusCode === 403 && error.details?.code === 'ATTENDANCE_ADJUSTMENT_ADMIN_REQUIRED'
    );

    corrections = await currentCorrectionsForAssignments(prisma, [ids.assignment]);
    assert.equal(corrections.length, 0, 'forbidden Manager approval must not change authoritative Attendance');

    const approved = await service.approve({ actor: admin, id: draft.id });
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.approvedRevision, 1);
    assert.equal(approved.approverUserId, ids.admin);

    corrections = await prisma.$queryRaw(Prisma.sql`
      SELECT
        event_type::text AS "eventType",
        actor_user_id AS "actorUserId",
        source_adjustment_request_id AS "sourceAdjustmentRequestId",
        source_adjustment_revision AS "sourceAdjustmentRevision",
        approved_by_user_id AS "approvedByUserId",
        approved_at AS "approvedAt",
        is_current AS "isCurrent"
      FROM attendance_corrections
      WHERE shift_assignment_id = ${ids.assignment}::uuid
      ORDER BY event_type
    `);

    assert.equal(corrections.length, 2);
    assert.deepEqual(corrections.map((row) => row.eventType).sort(), ['CHECK_IN', 'CHECK_OUT']);
    for (const row of corrections) {
      assert.equal(row.actorUserId, ids.manager);
      assert.equal(row.sourceAdjustmentRequestId, draft.id);
      assert.equal(Number(row.sourceAdjustmentRevision), 1);
      assert.equal(row.approvedByUserId, ids.admin);
      assert.equal(row.isCurrent, true);
      assert.ok(row.approvedAt);
    }

    const approvedHistory = await selfService.history({
      actor: viewer,
      from: '2099-04-10',
      to: '2099-04-10'
    });
    assert.equal(new Date(approvedHistory.rows[0].checkInAt).toISOString(), '2099-04-10T00:00:00.000Z');
    assert.equal(new Date(approvedHistory.rows[0].checkOutAt).toISOString(), '2099-04-10T12:00:00.000Z');
    assert.equal(approvedHistory.rows[0].workedMinutes, 720);
    assert.equal(approvedHistory.rows[0].corrected, true);
    assert.equal(approvedHistory.rows[0].authority, 'EFFECTIVE_ATTENDANCE_CORRECTION');

    const session = await prisma.attendanceSession.findUnique({ where: { shiftAssignmentId: ids.assignment } });
    assert.equal(session, null, 'governed adjustment must not fabricate raw AttendanceSession evidence');

    const requestAudit = await prisma.auditLog.findMany({
      where: {
        entityType: 'AttendanceAdjustmentRequest',
        entityId: draft.id
      }
    });
    assert.ok(requestAudit.some((row) => row.action === 'CREATE'));
    assert.ok(requestAudit.some((row) => row.action === 'UPDATE'));
  });

  test('ADMIN-created request remains Draft until a separate explicit submit and approve action', async () => {
    const draft = await service.createDraft({
      actor: admin,
      assignmentId: ids.assignment,
      requestType: 'ADJUST_WORK_TIME',
      proposal: { checkInAt: '2099-04-10T00:05:00.000Z' },
      reason: 'Admin keyed request must not auto approve'
    });

    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.approverUserId, null);
    assert.equal(draft.approvedAt, null);

    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM attendance_corrections
      WHERE source_adjustment_request_id = ${draft.id}::uuid
    `);
    assert.equal(Number(rows[0].total), 0);
  });

  test('stale Attendance base returns 409 and creates no correction from the stale request', async () => {
    const draft = await service.createDraft({
      actor: manager,
      assignmentId: ids.assignment,
      requestType: 'ADJUST_WORK_TIME',
      proposal: { checkOutAt: '2099-04-10T11:55:00.000Z' },
      reason: 'Request prepared before later authority change'
    });
    await service.submit({ actor: manager, id: draft.id });

    await legacyCorrection.correct({
      actor: admin,
      assignmentId: ids.assignment,
      eventType: 'CHECK_IN',
      correctedEffectiveEventAt: '2099-04-10T00:10:00.000Z',
      reason: 'Simulated authority change after request submission'
    });

    await assert.rejects(
      () => service.approve({ actor: admin, id: draft.id }),
      (error) => error.statusCode === 409 && error.details?.code === 'STALE_ATTENDANCE_BASE'
    );

    const generated = await prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM attendance_corrections
      WHERE source_adjustment_request_id = ${draft.id}::uuid
    `);
    assert.equal(Number(generated[0].total), 0);

    const row = await prisma.$queryRaw(Prisma.sql`
      SELECT status, approver_user_id AS "approverUserId", approved_at AS "approvedAt"
      FROM attendance_adjustment_requests
      WHERE id = ${draft.id}::uuid
    `);
    assert.equal(row[0].status, 'PENDING_APPROVAL');
    assert.equal(row[0].approverUserId, null);
    assert.equal(row[0].approvedAt, null);
  });
}
