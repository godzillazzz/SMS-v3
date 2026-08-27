
'use strict';

const crypto = require('node:crypto');
const { Prisma } = require('@prisma/client');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const {
  currentMonthCertification,
  currentCorrectionsForAssignments,
  applyCurrentCorrections
} = require('./attendance-correction.service');

const TRANSACTION_OPTIONS = { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 };
const REQUEST_TYPES = new Set(['CONFIRM_WORK_PERFORMED', 'ADJUST_WORK_TIME']);
const EDITABLE_STATUSES = new Set(['DRAFT', 'RETURNED_FOR_CORRECTION']);

function http(statusCode, code, message, extra = {}) {
  return new HttpError(statusCode, message, { code, ...extra });
}

function roleOf(actor) {
  return String(actor?.role || '').trim().toUpperCase();
}

function requiredReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 5 || reason.length > 1000) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_REASON_INVALID', 'Attendance adjustment reason must contain 5-1000 characters.');
  }
  return reason;
}

function reviewerComment(value) {
  const comment = String(value || '').trim();
  if (comment.length < 3 || comment.length > 1000) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_COMMENT_INVALID', 'Reviewer comment must contain 3-1000 characters.');
  }
  return comment;
}

function normalizeTime(value, code) {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw http(400, code, 'Attendance adjustment time is invalid.');
  return parsed.toISOString();
}

function normalizeProposal(requestType, proposal = {}) {
  const type = String(requestType || '').trim().toUpperCase();
  if (!REQUEST_TYPES.has(type)) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_TYPE_INVALID', 'Attendance adjustment type is invalid.');
  }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_PROPOSAL_INVALID', 'Attendance adjustment proposal is required.');
  }

  const normalized = {
    checkInAt: normalizeTime(proposal.checkInAt, 'ATTENDANCE_ADJUSTMENT_CHECK_IN_INVALID'),
    checkOutAt: normalizeTime(proposal.checkOutAt, 'ATTENDANCE_ADJUSTMENT_CHECK_OUT_INVALID')
  };

  if (type === 'CONFIRM_WORK_PERFORMED' && (!normalized.checkInAt || !normalized.checkOutAt)) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_CONFIRM_TIMES_REQUIRED', 'Confirm-work request requires both check-in and check-out times.');
  }
  if (type === 'ADJUST_WORK_TIME' && !normalized.checkInAt && !normalized.checkOutAt) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_TIME_REQUIRED', 'Adjust-work-time request requires at least one proposed time.');
  }
  if (normalized.checkInAt && normalized.checkOutAt && new Date(normalized.checkOutAt) <= new Date(normalized.checkInAt)) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_TIME_ORDER_INVALID', 'Check-out time must be after check-in time.');
  }
  return { type, proposal: normalized };
}

function stableDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function eventByType(events, type) {
  return (events || []).find((event) => String(event?.eventType || '').toUpperCase() === type) || null;
}

async function loadAssignment(client, assignmentId) {
  const assignment = await client.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      employee: {
        select: {
          id: true,
          employeeCode: true,
          displayName: true,
          firstName: true,
          lastName: true,
          department: true
        }
      },
      attendanceSession: {
        include: { events: { orderBy: { effectiveEventAt: 'asc' } } }
      }
    }
  });
  if (!assignment) throw http(404, 'ATTENDANCE_ASSIGNMENT_NOT_FOUND', 'Shift Assignment was not found.');
  return assignment;
}

function assertMakerScope(actor, assignment) {
  const role = roleOf(actor);
  if (!['ADMIN', 'MANAGER'].includes(role)) {
    throw http(403, 'ATTENDANCE_ADJUSTMENT_FORBIDDEN', 'Attendance adjustment request requires Manager or Admin authority.');
  }
  if (!actor?.sub) throw http(403, 'ATTENDANCE_ADJUSTMENT_ACTOR_REQUIRED', 'Authenticated actor identity is required.');

  if (role === 'MANAGER') {
    const actorDepartment = String(actor.department || '').trim();
    const assignmentDepartment = String(assignment.departmentSnapshot || assignment.employee?.department || '').trim();
    if (!actorDepartment || actorDepartment !== assignmentDepartment) {
      throw http(403, 'ATTENDANCE_ADJUSTMENT_SCOPE_FORBIDDEN', 'Manager may request Attendance changes only for their own Department.');
    }
  }
  return role;
}

function assertAdmin(actor) {
  if (roleOf(actor) !== 'ADMIN') {
    throw http(403, 'ATTENDANCE_ADJUSTMENT_ADMIN_REQUIRED', 'Only ADMIN may approve, return, or reject Attendance adjustment requests.');
  }
  if (!actor?.sub) throw http(403, 'ATTENDANCE_ADJUSTMENT_ACTOR_REQUIRED', 'Authenticated actor identity is required.');
}

async function authoritySnapshot(client, assignment) {
  const rawEvents = assignment.attendanceSession?.events || [];
  const corrections = await currentCorrectionsForAssignments(client, [assignment.id]);
  const effectiveEvents = applyCurrentCorrections(rawEvents, corrections);
  const originalCheckIn = eventByType(rawEvents, 'CHECK_IN');
  const originalCheckOut = eventByType(rawEvents, 'CHECK_OUT');
  const effectiveCheckIn = eventByType(effectiveEvents, 'CHECK_IN');
  const effectiveCheckOut = eventByType(effectiveEvents, 'CHECK_OUT');

  const snapshot = {
    assignmentId: assignment.id,
    attendanceSessionId: assignment.attendanceSession?.id || null,
    workDate: assignment.workDate instanceof Date
      ? assignment.workDate.toISOString().slice(0, 10)
      : String(assignment.workDate).slice(0, 10),
    original: {
      checkInEventId: originalCheckIn?.id || null,
      checkInAt: originalCheckIn?.effectiveEventAt ? new Date(originalCheckIn.effectiveEventAt).toISOString() : null,
      checkOutEventId: originalCheckOut?.id || null,
      checkOutAt: originalCheckOut?.effectiveEventAt ? new Date(originalCheckOut.effectiveEventAt).toISOString() : null
    },
    effective: {
      checkInAt: effectiveCheckIn?.effectiveEventAt ? new Date(effectiveCheckIn.effectiveEventAt).toISOString() : null,
      checkOutAt: effectiveCheckOut?.effectiveEventAt ? new Date(effectiveCheckOut.effectiveEventAt).toISOString() : null
    },
    correctionIds: corrections.map((row) => String(row.id)).sort()
  };

  return { snapshot, digest: stableDigest(snapshot), rawEvents };
}

function requestShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    shiftAssignmentId: row.shiftAssignmentId,
    attendanceSessionId: row.attendanceSessionId,
    requestType: row.requestType,
    status: row.status,
    makerUserId: row.makerUserId,
    makerRoleSnapshot: row.makerRoleSnapshot,
    currentRevision: Number(row.currentRevision),
    approvedRevision: row.approvedRevision == null ? null : Number(row.approvedRevision),
    beforeSnapshot: row.beforeSnapshot,
    beforeDigest: row.beforeDigest,
    currentProposal: row.currentProposal,
    currentProposalDigest: row.currentProposalDigest,
    reason: row.reason,
    lastReviewerComment: row.lastReviewerComment,
    approverUserId: row.approverUserId,
    approvedAt: row.approvedAt,
    rejectedByUserId: row.rejectedByUserId,
    rejectedAt: row.rejectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    employeeId: row.employeeId || null,
    employeeCode: row.employeeCode || null,
    employeeName: row.employeeName || null,
    department: row.department || null,
    workDate: row.workDate || null
  };
}

const requestSelect = Prisma.sql`
  SELECT
    r.id,
    r.shift_assignment_id AS "shiftAssignmentId",
    r.attendance_session_id AS "attendanceSessionId",
    r.request_type AS "requestType",
    r.status,
    r.maker_user_id AS "makerUserId",
    r.maker_role_snapshot AS "makerRoleSnapshot",
    r.current_revision AS "currentRevision",
    r.approved_revision AS "approvedRevision",
    r.before_snapshot AS "beforeSnapshot",
    r.before_digest AS "beforeDigest",
    r.current_proposal AS "currentProposal",
    r.current_proposal_digest AS "currentProposalDigest",
    r.reason,
    r.last_reviewer_comment AS "lastReviewerComment",
    r.approver_user_id AS "approverUserId",
    r.approved_at AS "approvedAt",
    r.rejected_by_user_id AS "rejectedByUserId",
    r.rejected_at AS "rejectedAt",
    r.created_at AS "createdAt",
    r.updated_at AS "updatedAt",
    sa.employee_id AS "employeeId",
    e.employee_code AS "employeeCode",
    COALESCE(sa.employee_name_snapshot, e.display_name, btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, ''))) AS "employeeName",
    COALESCE(sa.department_snapshot, e.department) AS department,
    sa.work_date AS "workDate"
  FROM attendance_adjustment_requests r
  JOIN shift_assignments sa ON sa.id = r.shift_assignment_id
  LEFT JOIN employees e ON e.id = sa.employee_id
`;

function createAttendanceAdjustmentService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date() } = {}) {
  async function getRequestRow(client, id, lock = false) {
    const rows = lock
      ? await client.$queryRaw(Prisma.sql`${requestSelect} WHERE r.id = ${id}::uuid FOR UPDATE OF r`)
      : await client.$queryRaw(Prisma.sql`${requestSelect} WHERE r.id = ${id}::uuid`);
    return requestShape(rows[0]);
  }

  async function assertReadable(client, request, actor) {
    if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
    const role = roleOf(actor);
    if (role === 'ADMIN') return;
    if (role !== 'MANAGER') throw http(403, 'ATTENDANCE_ADJUSTMENT_READ_FORBIDDEN', 'Attendance adjustment access denied.');
    const assignment = await loadAssignment(client, request.shiftAssignmentId);
    assertMakerScope(actor, assignment);
  }

  async function list({ actor, status = null, assignmentId = null, page = 1, pageSize = 25 } = {}) {
    const role = roleOf(actor);
    if (!['ADMIN', 'MANAGER'].includes(role)) {
      throw http(403, 'ATTENDANCE_ADJUSTMENT_READ_FORBIDDEN', 'Attendance adjustment list requires Manager or Admin authority.');
    }

    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize || 25)));
    const normalizedStatus = status ? String(status).trim().toUpperCase() : null;
    const offset = (safePage - 1) * safePageSize;

    const scope = role === 'MANAGER'
      ? Prisma.sql`AND COALESCE(sa.department_snapshot, e.department) = ${String(actor.department || '').trim()}`
      : Prisma.empty;
    const statusClause = normalizedStatus ? Prisma.sql`AND r.status = ${normalizedStatus}` : Prisma.empty;
    const assignmentClause = assignmentId ? Prisma.sql`AND r.shift_assignment_id = ${assignmentId}::uuid` : Prisma.empty;

    const rows = await prisma.$queryRaw(Prisma.sql`
      ${requestSelect}
      WHERE 1=1
        ${scope}
        ${statusClause}
        ${assignmentClause}
      ORDER BY r.created_at DESC, r.id ASC
      LIMIT ${safePageSize}
      OFFSET ${offset}
    `);

    const counts = await prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM attendance_adjustment_requests r
      JOIN shift_assignments sa ON sa.id = r.shift_assignment_id
      LEFT JOIN employees e ON e.id = sa.employee_id
      WHERE 1=1
        ${scope}
        ${statusClause}
        ${assignmentClause}
    `);
    const total = Number(counts[0]?.total || 0);

    return {
      data: rows.map(requestShape),
      meta: {
        page: safePage,
        pageSize: safePageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / safePageSize))
      }
    };
  }

  async function get({ actor, id } = {}) {
    const request = await getRequestRow(prisma, id);
    await assertReadable(prisma, request, actor);
    const [revisions, events] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`
        SELECT
          revision,
          before_snapshot AS "beforeSnapshot",
          before_digest AS "beforeDigest",
          proposal,
          proposal_digest AS "proposalDigest",
          reason,
          submitted_by_user_id AS "submittedByUserId",
          submitted_by_role_snapshot AS "submittedByRoleSnapshot",
          created_at AS "createdAt"
        FROM attendance_adjustment_revisions
        WHERE request_id = ${id}::uuid
        ORDER BY revision ASC
      `),
      prisma.$queryRaw(Prisma.sql`
        SELECT
          event_type AS "eventType",
          revision,
          actor_user_id AS "actorUserId",
          actor_role_snapshot AS "actorRoleSnapshot",
          comment,
          before_snapshot AS "beforeSnapshot",
          after_snapshot AS "afterSnapshot",
          created_at AS "createdAt"
        FROM attendance_adjustment_events
        WHERE request_id = ${id}::uuid
        ORDER BY created_at ASC, id ASC
      `)
    ]);
    return { ...request, revisions, events };
  }

  async function addRevision(tx, { requestId, revision, before, proposal, reason, actor, eventType }) {
    const proposalDigest = stableDigest(proposal);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO attendance_adjustment_revisions (
        request_id, revision, before_snapshot, before_digest, proposal, proposal_digest,
        reason, submitted_by_user_id, submitted_by_role_snapshot
      ) VALUES (
        ${requestId}::uuid,
        ${revision},
        ${JSON.stringify(before.snapshot)}::jsonb,
        ${before.digest},
        ${JSON.stringify(proposal)}::jsonb,
        ${proposalDigest},
        ${reason},
        ${actor.sub}::uuid,
        ${roleOf(actor)}
      )
    `);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO attendance_adjustment_events (
        request_id, event_type, revision, actor_user_id, actor_role_snapshot,
        before_snapshot, after_snapshot
      ) VALUES (
        ${requestId}::uuid,
        ${eventType},
        ${revision},
        ${actor.sub}::uuid,
        ${roleOf(actor)},
        ${JSON.stringify(before.snapshot)}::jsonb,
        ${JSON.stringify(proposal)}::jsonb
      )
    `);
    return proposalDigest;
  }

  async function createDraft({ actor, assignmentId, requestType, proposal, reason } = {}) {
    const normalizedReason = requiredReason(reason);
    const normalized = normalizeProposal(requestType, proposal);

    return prisma.$transaction(async (tx) => {
      const assignment = await loadAssignment(tx, assignmentId);
      const makerRole = assertMakerScope(actor, assignment);
      const before = await authoritySnapshot(tx, assignment);
      const rows = await tx.$queryRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_requests (
          shift_assignment_id, attendance_session_id, request_type, status,
          maker_user_id, maker_role_snapshot, current_revision,
          before_snapshot, before_digest, current_proposal, current_proposal_digest, reason
        ) VALUES (
          ${assignment.id}::uuid,
          ${assignment.attendanceSession?.id || null}::uuid,
          ${normalized.type},
          'DRAFT',
          ${actor.sub}::uuid,
          ${makerRole},
          1,
          ${JSON.stringify(before.snapshot)}::jsonb,
          ${before.digest},
          ${JSON.stringify(normalized.proposal)}::jsonb,
          ${stableDigest(normalized.proposal)},
          ${normalizedReason}
        )
        RETURNING id
      `);
      const requestId = rows[0].id;
      await addRevision(tx, {
        requestId,
        revision: 1,
        before,
        proposal: normalized.proposal,
        reason: normalizedReason,
        actor,
        eventType: 'CREATED'
      });
      await audit.log({
        actorUserId: actor.sub,
        action: 'CREATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: requestId,
        metadata: {
          shiftAssignmentId: assignment.id,
          requestType: normalized.type,
          status: 'DRAFT',
          revision: 1,
          beforeDigest: before.digest
        }
      }, tx);
      return getRequestRow(tx, requestId);
    }, TRANSACTION_OPTIONS);
  }

  async function revise({ actor, id, requestType, proposal, reason } = {}) {
    const normalizedReason = requiredReason(reason);
    const normalized = normalizeProposal(requestType, proposal);

    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, true);
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      const assignment = await loadAssignment(tx, request.shiftAssignmentId);
      assertMakerScope(actor, assignment);
      if (request.makerUserId !== actor.sub) {
        throw http(403, 'ATTENDANCE_ADJUSTMENT_NOT_MAKER', 'Only the request maker may revise this Attendance adjustment request.');
      }
      if (!EDITABLE_STATUSES.has(request.status)) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_NOT_EDITABLE', 'Only Draft or Returned requests may be revised.');
      }

      const before = await authoritySnapshot(tx, assignment);
      const revision = request.currentRevision + 1;
      const proposalDigest = await addRevision(tx, {
        requestId: id,
        revision,
        before,
        proposal: normalized.proposal,
        reason: normalizedReason,
        actor,
        eventType: 'REVISED'
      });

      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET request_type = ${normalized.type},
            current_revision = ${revision},
            before_snapshot = ${JSON.stringify(before.snapshot)}::jsonb,
            before_digest = ${before.digest},
            current_proposal = ${JSON.stringify(normalized.proposal)}::jsonb,
            current_proposal_digest = ${proposalDigest},
            reason = ${normalizedReason},
            last_reviewer_comment = NULL,
            updated_at = ${clock()}
        WHERE id = ${id}::uuid
      `);

      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: id,
        metadata: {
          event: 'REVISED',
          revision,
          beforeDigest: before.digest,
          proposalDigest
        }
      }, tx);

      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function submit({ actor, id } = {}) {
    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, true);
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      const assignment = await loadAssignment(tx, request.shiftAssignmentId);
      assertMakerScope(actor, assignment);
      if (request.makerUserId !== actor.sub) {
        throw http(403, 'ATTENDANCE_ADJUSTMENT_NOT_MAKER', 'Only the request maker may submit this Attendance adjustment request.');
      }
      if (!EDITABLE_STATUSES.has(request.status)) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only Draft or Returned requests may be submitted.');
      }

      const fromStatus = request.status;
      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = 'PENDING_APPROVAL',
            last_reviewer_comment = NULL,
            updated_at = ${clock()}
        WHERE id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_events (
          request_id, event_type, revision, actor_user_id, actor_role_snapshot,
          before_snapshot, after_snapshot
        ) VALUES (
          ${id}::uuid,
          'SUBMITTED',
          ${request.currentRevision},
          ${actor.sub}::uuid,
          ${roleOf(actor)},
          ${JSON.stringify(request.beforeSnapshot)}::jsonb,
          ${JSON.stringify(request.currentProposal)}::jsonb
        )
      `);
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: id,
        metadata: {
          event: 'SUBMITTED',
          fromStatus,
          toStatus: 'PENDING_APPROVAL',
          revision: request.currentRevision
        }
      }, tx);
      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function returnForCorrection({ actor, id, comment } = {}) {
    assertAdmin(actor);
    const normalizedComment = reviewerComment(comment);

    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, true);
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      if (request.status !== 'PENDING_APPROVAL') {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only pending requests may be returned.');
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = 'RETURNED_FOR_CORRECTION',
            last_reviewer_comment = ${normalizedComment},
            updated_at = ${clock()}
        WHERE id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_events (
          request_id, event_type, revision, actor_user_id, actor_role_snapshot, comment
        ) VALUES (
          ${id}::uuid,
          'RETURNED',
          ${request.currentRevision},
          ${actor.sub}::uuid,
          'ADMIN',
          ${normalizedComment}
        )
      `);
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: id,
        metadata: {
          event: 'RETURNED',
          fromStatus: 'PENDING_APPROVAL',
          toStatus: 'RETURNED_FOR_CORRECTION',
          revision: request.currentRevision,
          comment: normalizedComment
        }
      }, tx);
      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function reject({ actor, id, comment } = {}) {
    assertAdmin(actor);
    const normalizedComment = reviewerComment(comment);
    const now = clock();

    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, true);
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      if (request.status !== 'PENDING_APPROVAL') {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only pending requests may be rejected.');
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = 'REJECTED',
            last_reviewer_comment = ${normalizedComment},
            rejected_by_user_id = ${actor.sub}::uuid,
            rejected_at = ${now},
            updated_at = ${now}
        WHERE id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_events (
          request_id, event_type, revision, actor_user_id, actor_role_snapshot, comment
        ) VALUES (
          ${id}::uuid,
          'REJECTED',
          ${request.currentRevision},
          ${actor.sub}::uuid,
          'ADMIN',
          ${normalizedComment}
        )
      `);
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: id,
        metadata: {
          event: 'REJECTED',
          fromStatus: 'PENDING_APPROVAL',
          toStatus: 'REJECTED',
          revision: request.currentRevision,
          comment: normalizedComment
        }
      }, tx);
      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function approve({ actor, id } = {}) {
    assertAdmin(actor);
    const now = clock();

    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, true);
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      if (request.status !== 'PENDING_APPROVAL') {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only pending requests may be approved.');
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM shift_assignments
        WHERE id = ${request.shiftAssignmentId}::uuid
        FOR UPDATE
      `);

      const assignment = await loadAssignment(tx, request.shiftAssignmentId);
      const certification = await currentMonthCertification(tx, assignment.workDate);
      if (certification) {
        throw http(409, 'ATTENDANCE_MONTH_CERTIFIED', 'Certified Attendance month must be unlocked before approving an adjustment.');
      }

      const current = await authoritySnapshot(tx, assignment);
      if (current.digest !== request.beforeDigest) {
        throw http(
          409,
          'STALE_ATTENDANCE_BASE',
          'Authoritative Attendance changed after this request revision was prepared. Refresh and resubmit.',
          { expectedDigest: request.beforeDigest, currentDigest: current.digest }
        );
      }

      const proposal = request.currentProposal || {};
      const finalCheckInAt = proposal.checkInAt || current.snapshot.effective.checkInAt;
      const finalCheckOutAt = proposal.checkOutAt || current.snapshot.effective.checkOutAt;
      if (finalCheckInAt && finalCheckOutAt && new Date(finalCheckOutAt) <= new Date(finalCheckInAt)) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_TIME_ORDER_INVALID', 'Effective check-out time must be after check-in time.');
      }

      const entries = [
        ['CHECK_IN', proposal.checkInAt],
        ['CHECK_OUT', proposal.checkOutAt]
      ].filter(([, value]) => Boolean(value));

      if (!entries.length) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_PROPOSAL_EMPTY', 'Submitted adjustment proposal has no effective time changes.');
      }

      for (const [eventType, value] of entries) {
        const correctedAt = new Date(value);
        const original = eventByType(current.rawEvents, eventType);

        await tx.$executeRaw(Prisma.sql`
          UPDATE attendance_corrections
          SET is_current = FALSE, superseded_at = ${now}
          WHERE shift_assignment_id = ${assignment.id}::uuid
            AND event_type = ${eventType}::"AttendanceEventType"
            AND is_current = TRUE
        `);

        const inserted = await tx.$queryRaw(Prisma.sql`
          INSERT INTO attendance_corrections (
            shift_assignment_id,
            attendance_session_id,
            event_type,
            original_event_id,
            original_effective_event_at,
            corrected_effective_event_at,
            reason,
            actor_user_id,
            actor_role_snapshot,
            source_adjustment_request_id,
            source_adjustment_revision,
            approved_by_user_id,
            approved_at
          ) VALUES (
            ${assignment.id}::uuid,
            ${assignment.attendanceSession?.id || null}::uuid,
            ${eventType}::"AttendanceEventType",
            ${original?.id || null}::uuid,
            ${original?.effectiveEventAt || null},
            ${correctedAt},
            ${request.reason},
            ${request.makerUserId}::uuid,
            ${request.makerRoleSnapshot},
            ${id}::uuid,
            ${request.currentRevision},
            ${actor.sub}::uuid,
            ${now}
          )
          RETURNING id
        `);

        await audit.log({
          actorUserId: actor.sub,
          action: 'CREATE',
          entityType: 'AttendanceCorrection',
          entityId: inserted[0].id,
          metadata: {
            sourceAdjustmentRequestId: id,
            sourceAdjustmentRevision: request.currentRevision,
            makerUserId: request.makerUserId,
            makerRoleSnapshot: request.makerRoleSnapshot,
            approverUserId: actor.sub,
            eventType,
            before: eventType === 'CHECK_IN'
              ? current.snapshot.effective.checkInAt
              : current.snapshot.effective.checkOutAt,
            after: correctedAt.toISOString(),
            reason: request.reason
          }
        }, tx);
      }

      const afterSnapshot = {
        ...current.snapshot,
        effective: {
          checkInAt: finalCheckInAt,
          checkOutAt: finalCheckOutAt
        }
      };

      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = 'APPROVED',
            approved_revision = ${request.currentRevision},
            approver_user_id = ${actor.sub}::uuid,
            approved_at = ${now},
            last_reviewer_comment = NULL,
            updated_at = ${now}
        WHERE id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_events (
          request_id, event_type, revision, actor_user_id, actor_role_snapshot,
          before_snapshot, after_snapshot
        ) VALUES (
          ${id}::uuid,
          'APPROVED',
          ${request.currentRevision},
          ${actor.sub}::uuid,
          'ADMIN',
          ${JSON.stringify(current.snapshot)}::jsonb,
          ${JSON.stringify(afterSnapshot)}::jsonb
        )
      `);
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: id,
        metadata: {
          event: 'APPROVED',
          fromStatus: 'PENDING_APPROVAL',
          toStatus: 'APPROVED',
          revision: request.currentRevision,
          makerUserId: request.makerUserId,
          approverUserId: actor.sub,
          before: current.snapshot,
          after: afterSnapshot,
          reason: request.reason
        }
      }, tx);

      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  return {
    list,
    get,
    createDraft,
    revise,
    submit,
    returnForCorrection,
    reject,
    approve
  };
}

module.exports = {
  TRANSACTION_OPTIONS,
  REQUEST_TYPES,
  EDITABLE_STATUSES,
  requiredReason,
  reviewerComment,
  normalizeProposal,
  stableDigest,
  authoritySnapshot,
  assertMakerScope,
  assertAdmin,
  createAttendanceAdjustmentService
};
