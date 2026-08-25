'use strict';

const { Prisma } = require('@prisma/client');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

const EVENT_TYPES = new Set(['CHECK_IN', 'CHECK_OUT']);

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function monthStart(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw http(400, 'ATTENDANCE_CORRECTION_TIME_INVALID', 'Attendance correction time is invalid.');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function normalizedEventType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (!EVENT_TYPES.has(type)) throw http(400, 'ATTENDANCE_CORRECTION_EVENT_TYPE_INVALID', 'Correction event type must be CHECK_IN or CHECK_OUT.');
  return type;
}

function correctedTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw http(400, 'ATTENDANCE_CORRECTION_TIME_INVALID', 'A valid corrected Attendance time is required.');
  return date;
}

function correctionReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 5 || reason.length > 1000) throw http(400, 'ATTENDANCE_CORRECTION_REASON_INVALID', 'Correction reason must contain 5-1000 characters.');
  return reason;
}

function assertCorrectionActor(actor, assignment) {
  const role = String(actor?.role || '').toUpperCase();
  if (!['ADMIN', 'MANAGER'].includes(role)) throw http(403, 'ATTENDANCE_CORRECTION_FORBIDDEN', 'Attendance correction requires Manager or Admin authority.');
  if (role === 'MANAGER') {
    const actorDepartment = String(actor?.department || '').trim();
    const assignmentDepartment = String(assignment?.departmentSnapshot || assignment?.employee?.department || '').trim();
    if (!actorDepartment || !assignmentDepartment || actorDepartment !== assignmentDepartment) {
      throw http(403, 'ATTENDANCE_CORRECTION_SCOPE_FORBIDDEN', 'Manager may correct Attendance only for their own Department.');
    }
  }
  return role;
}

async function currentMonthCertification(client, workDate) {
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT id, revision, status
    FROM attendance_month_certifications
    WHERE month = ${monthStart(workDate)}::date AND status = 'CERTIFIED'
    LIMIT 1
  `);
  return rows[0] || null;
}

async function currentCorrectionsForAssignments(client, assignmentIds) {
  if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) return [];
  return client.$queryRaw(Prisma.sql`
    SELECT
      id,
      shift_assignment_id AS "shiftAssignmentId",
      attendance_session_id AS "attendanceSessionId",
      event_type::text AS "eventType",
      original_event_id AS "originalEventId",
      original_effective_event_at AS "originalEffectiveEventAt",
      corrected_effective_event_at AS "correctedEffectiveEventAt",
      reason,
      actor_user_id AS "actorUserId",
      actor_role_snapshot AS "actorRoleSnapshot",
      created_at AS "createdAt"
    FROM attendance_corrections
    WHERE shift_assignment_id IN (${Prisma.join(assignmentIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND is_current = TRUE
    ORDER BY shift_assignment_id, event_type
  `);
}

async function currentCorrectionsForSessions(client, sessionIds) {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return [];
  return client.$queryRaw(Prisma.sql`
    SELECT
      id,
      shift_assignment_id AS "shiftAssignmentId",
      attendance_session_id AS "attendanceSessionId",
      event_type::text AS "eventType",
      original_event_id AS "originalEventId",
      original_effective_event_at AS "originalEffectiveEventAt",
      corrected_effective_event_at AS "correctedEffectiveEventAt",
      reason,
      actor_user_id AS "actorUserId",
      actor_role_snapshot AS "actorRoleSnapshot",
      created_at AS "createdAt"
    FROM attendance_corrections
    WHERE attendance_session_id IN (${Prisma.join(sessionIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND is_current = TRUE
    ORDER BY attendance_session_id, event_type
  `);
}

function applyCurrentCorrections(events = [], corrections = []) {
  const byType = new Map((corrections || []).map((row) => [String(row.eventType).toUpperCase(), row]));
  const originalByType = new Map((events || []).map((row) => [String(row.eventType).toUpperCase(), row]));
  const types = new Set([...originalByType.keys(), ...byType.keys()]);
  return [...types].map((type) => {
    const original = originalByType.get(type) || null;
    const correction = byType.get(type) || null;
    if (!correction) return original;
    return {
      ...(original || {}),
      id: original?.id || null,
      eventType: type,
      effectiveEventAt: new Date(correction.correctedEffectiveEventAt),
      correction: {
        id: correction.id,
        originalEventId: correction.originalEventId || original?.id || null,
        originalEffectiveEventAt: correction.originalEffectiveEventAt || original?.effectiveEventAt || null,
        correctedEffectiveEventAt: correction.correctedEffectiveEventAt,
        reason: correction.reason,
        actorUserId: correction.actorUserId,
        actorRoleSnapshot: correction.actorRoleSnapshot,
        createdAt: correction.createdAt
      }
    };
  }).filter(Boolean);
}

function createAttendanceCorrectionService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date() } = {}) {
  async function loadAssignment(client, assignmentId) {
    const assignment = await client.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        employee: { select: { id: true, department: true } },
        attendanceSession: { include: { events: { orderBy: { effectiveEventAt: 'asc' } } } }
      }
    });
    if (!assignment) throw http(404, 'ATTENDANCE_ASSIGNMENT_NOT_FOUND', 'Shift Assignment was not found.');
    return assignment;
  }

  async function list({ actor, assignmentId } = {}, client = prisma) {
    const assignment = await loadAssignment(client, assignmentId);
    assertCorrectionActor(actor, assignment);
    return client.$queryRaw(Prisma.sql`
      SELECT
        id,
        shift_assignment_id AS "shiftAssignmentId",
        attendance_session_id AS "attendanceSessionId",
        event_type::text AS "eventType",
        original_event_id AS "originalEventId",
        original_effective_event_at AS "originalEffectiveEventAt",
        corrected_effective_event_at AS "correctedEffectiveEventAt",
        reason,
        actor_user_id AS "actorUserId",
        actor_role_snapshot AS "actorRoleSnapshot",
        is_current AS "isCurrent",
        superseded_at AS "supersededAt",
        created_at AS "createdAt"
      FROM attendance_corrections
      WHERE shift_assignment_id = ${assignment.id}::uuid
      ORDER BY created_at ASC, id ASC
    `);
  }

  async function correct({ actor, assignmentId, eventType, correctedEffectiveEventAt, reason } = {}) {
    const type = normalizedEventType(eventType);
    const correctedAt = correctedTime(correctedEffectiveEventAt);
    const normalizedReason = correctionReason(reason);
    const now = clock();

    return prisma.$transaction(async (tx) => {
      const assignment = await loadAssignment(tx, assignmentId);
      const role = assertCorrectionActor(actor, assignment);
      const certification = await currentMonthCertification(tx, assignment.workDate);
      if (certification) throw http(409, 'ATTENDANCE_MONTH_CERTIFIED', 'Certified Attendance month must be unlocked before correction.');

      const session = assignment.attendanceSession || null;
      const original = session?.events?.find((row) => row.eventType === type) || null;
      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_corrections
        SET is_current = FALSE, superseded_at = ${now}
        WHERE shift_assignment_id = ${assignment.id}::uuid
          AND event_type = ${type}::"AttendanceEventType"
          AND is_current = TRUE
      `);
      const rows = await tx.$queryRaw(Prisma.sql`
        INSERT INTO attendance_corrections (
          shift_assignment_id, attendance_session_id, event_type, original_event_id, original_effective_event_at,
          corrected_effective_event_at, reason, actor_user_id, actor_role_snapshot
        ) VALUES (
          ${assignment.id}::uuid,
          ${session?.id || null}::uuid,
          ${type}::"AttendanceEventType",
          ${original?.id || null}::uuid,
          ${original?.effectiveEventAt || null},
          ${correctedAt},
          ${normalizedReason},
          ${actor.sub}::uuid,
          ${role}
        )
        RETURNING
          id,
          shift_assignment_id AS "shiftAssignmentId",
          attendance_session_id AS "attendanceSessionId",
          event_type::text AS "eventType",
          original_event_id AS "originalEventId",
          original_effective_event_at AS "originalEffectiveEventAt",
          corrected_effective_event_at AS "correctedEffectiveEventAt",
          reason,
          actor_user_id AS "actorUserId",
          actor_role_snapshot AS "actorRoleSnapshot",
          created_at AS "createdAt"
      `);
      const correction = rows[0];
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceCorrection',
        entityId: correction.id,
        metadata: {
          shiftAssignmentId: assignment.id,
          attendanceSessionId: session?.id || null,
          eventType: type,
          originalEventId: original?.id || null,
          originalEffectiveEventAt: original?.effectiveEventAt || null,
          correctedEffectiveEventAt: correctedAt,
          reason: normalizedReason,
          actorRoleSnapshot: role
        }
      }, tx);
      return correction;
    });
  }

  return { list, correct };
}

module.exports = {
  monthStart,
  normalizedEventType,
  correctedTime,
  correctionReason,
  assertCorrectionActor,
  currentMonthCertification,
  currentCorrectionsForAssignments,
  currentCorrectionsForSessions,
  applyCurrentCorrections,
  createAttendanceCorrectionService
};
