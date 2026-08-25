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

function assertCorrectionActor(actor, session) {
  const role = String(actor?.role || '').toUpperCase();
  if (!['ADMIN', 'MANAGER'].includes(role)) throw http(403, 'ATTENDANCE_CORRECTION_FORBIDDEN', 'Attendance correction requires Manager or Admin authority.');
  if (role === 'MANAGER') {
    const actorDepartment = String(actor?.department || '').trim();
    const sessionDepartment = String(session?.shiftAssignment?.departmentSnapshot || session?.employee?.department || '').trim();
    if (!actorDepartment || !sessionDepartment || actorDepartment !== sessionDepartment) {
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

async function currentCorrectionsForSessions(client, sessionIds) {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) return [];
  return client.$queryRaw(Prisma.sql`
    SELECT
      id,
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
  async function loadSession(client, sessionId) {
    const session = await client.attendanceSession.findUnique({
      where: { id: sessionId },
      include: {
        employee: { select: { id: true, department: true } },
        shiftAssignment: { select: { id: true, departmentSnapshot: true, workDate: true } },
        events: { orderBy: { effectiveEventAt: 'asc' } }
      }
    });
    if (!session) throw http(404, 'ATTENDANCE_SESSION_NOT_FOUND', 'Attendance session was not found.');
    return session;
  }

  async function list({ actor, sessionId } = {}, client = prisma) {
    const session = await loadSession(client, sessionId);
    assertCorrectionActor(actor, session);
    return client.$queryRaw(Prisma.sql`
      SELECT
        id,
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
      WHERE attendance_session_id = ${session.id}::uuid
      ORDER BY created_at ASC, id ASC
    `);
  }

  async function correct({ actor, sessionId, eventType, correctedEffectiveEventAt, reason } = {}) {
    const type = normalizedEventType(eventType);
    const correctedAt = correctedTime(correctedEffectiveEventAt);
    const normalizedReason = correctionReason(reason);
    const now = clock();

    return prisma.$transaction(async (tx) => {
      const session = await loadSession(tx, sessionId);
      const role = assertCorrectionActor(actor, session);
      const certification = await currentMonthCertification(tx, session.workDate);
      if (certification) throw http(409, 'ATTENDANCE_MONTH_CERTIFIED', 'Certified Attendance month must be unlocked before correction.');

      const original = session.events.find((row) => row.eventType === type) || null;
      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_corrections
        SET is_current = FALSE, superseded_at = ${now}
        WHERE attendance_session_id = ${session.id}::uuid
          AND event_type = ${type}::"AttendanceEventType"
          AND is_current = TRUE
      `);
      const rows = await tx.$queryRaw(Prisma.sql`
        INSERT INTO attendance_corrections (
          attendance_session_id, event_type, original_event_id, original_effective_event_at,
          corrected_effective_event_at, reason, actor_user_id, actor_role_snapshot
        ) VALUES (
          ${session.id}::uuid,
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
          attendanceSessionId: session.id,
          shiftAssignmentId: session.shiftAssignmentId,
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
  currentCorrectionsForSessions,
  applyCurrentCorrections,
  createAttendanceCorrectionService
};
