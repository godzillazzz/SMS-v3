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
    SELECT id, revision, status::text AS status
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
      source_adjustment_request_id AS "sourceAdjustmentRequestId",
      source_adjustment_revision AS "sourceAdjustmentRevision",
      approved_by_user_id AS "approvedByUserId",
      approved_at AS "approvedAt",
      created_at AS "createdAt"
    FROM attendance_corrections
    WHERE shift_assignment_id IN (${Prisma.join(assignmentIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND is_current = TRUE
      AND source_adjustment_request_id IS NOT NULL
      AND source_adjustment_revision IS NOT NULL
      AND approved_by_user_id IS NOT NULL
      AND approved_at IS NOT NULL
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
      source_adjustment_request_id AS "sourceAdjustmentRequestId",
      source_adjustment_revision AS "sourceAdjustmentRevision",
      approved_by_user_id AS "approvedByUserId",
      approved_at AS "approvedAt",
      created_at AS "createdAt"
    FROM attendance_corrections
    WHERE attendance_session_id IN (${Prisma.join(sessionIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND is_current = TRUE
      AND source_adjustment_request_id IS NOT NULL
      AND source_adjustment_revision IS NOT NULL
      AND approved_by_user_id IS NOT NULL
      AND approved_at IS NOT NULL
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
        sourceAdjustmentRequestId: correction.sourceAdjustmentRequestId || null,
        sourceAdjustmentRevision: correction.sourceAdjustmentRevision == null ? null : Number(correction.sourceAdjustmentRevision),
        approvedByUserId: correction.approvedByUserId || null,
        approvedAt: correction.approvedAt || null,
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

  async function correct() {
    throw http(
      409,
      'ATTENDANCE_CORRECTION_DIRECT_WRITE_DISABLED',
      'Direct Attendance correction writes are disabled. Use an Attendance adjustment request and explicit ADMIN approval.'
    );
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
