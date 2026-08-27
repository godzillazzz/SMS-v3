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

function dateIso(value, code) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw http(400, code, 'Attendance adjustment time is invalid.');
  return date.toISOString();
}

function normalizeProposal(requestType, proposal = {}) {
  const type = String(requestType || '').trim().toUpperCase();
  if (!REQUEST_TYPES.has(type)) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_TYPE_INVALID', 'Attendance adjustment type is invalid.');
  }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw http(400, 'ATTENDANCE_ADJUSTMENT_PROPOSAL_INVALID', 'Attendance adjustment proposal is required.');
  }

  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(proposal, 'checkInAt') && proposal.checkInAt) {
    normalized.checkInAt = dateIso(proposal.checkInAt, 'ATTENDANCE_ADJUSTMENT_CHECK_IN_INVALID');
  }
  if (Object.prototype.hasOwnProperty.call(proposal, 'checkOutAt') && proposal.checkOutAt) {
    normalized.checkOutAt = dateIso(proposal.checkOutAt, 'ATTENDANCE_ADJUSTMENT_CHECK_OUT_INVALID');
  }

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
      employee: { select: { id: true, employeeCode: true, displayName: true, firstName: true, lastName: true, department: true } },
      attendanceSession: { include: { events: { orderBy: { effectiveEventAt: 'asc' } } } }
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
  const corrections = typeof client.$queryRaw === 'function'
    ? await currentCorrectionsForAssignments(client, [assignment.id])
    : [];
  const effectiveEvents = applyCurrentCorrections(rawEvents, corrections);
  const originalCheckIn = eventByType(rawEvents, 'CHECK_IN');
  const originalCheckOut = eventByType(rawEvents, 'CHECK_OUT');
  const effectiveCheckIn = eventByType(effectiveEvents, 'CHECK_IN');
  const effectiveCheckOut = eventByType(effectiveEvents, 'CHECK_OUT');

  const snapshot = {
    assignmentId: assignment.id,
    attendanceSessionId: assignment.attendanceSession?.id || null,
    workDate: assignment.workDate instanceof Date ? assignment.workDate.toISOString().slice(0, 10) : String(assignment.workDate).slice(0, 10),
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
  return { snapshot, digest: stableDigest(snapshot), rawEvents, corrections };
}

function rowShape(row) {
  if (!row) return null;
  return {
    id: row.id,
    shiftAssignmentId: row.shiftAssignmentId,
    attendanceSessionId: row.attendanceSessionId,
    requestType: row.requestType,
    status: row.status,
    makerUserId: row.makerUserId,
    makerRoleSnapshot: row.makerRoleSnapshot,
    makerDisplayName: row.makerDisplayName || null,
    currentRevision: Number(row.currentRevision),
    approvedRevision: row.approvedRevision == null ? null : Number(row.approvedRevision),
    beforeSnapshot: row.beforeSnapshot,
    beforeDigest: row.beforeDigest,
    currentProposal: row.currentProposal,
    currentProposalDigest: row.currentProposalDigest,
    reason: row.reason,
    lastReviewerComment: row.lastReviewerComment,
    approverUserId: row.approverUserId,
    approverDisplayName: row.approverDisplayName || null,
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

const requestSelectSql = Prisma.sql`
  SELECT
    r.id,
    r.shift_assignment_id AS "shiftAssignmentId",
    r.attendance_session_id AS "attendanceSessionId",
    r.request_type AS "requestType",
    r.status,
    r.maker_user_id AS "makerUserId",
    r.maker_role_snapshot AS "makerRoleSnapshot",
    maker.display_name AS "makerDisplayName",
    r.current_revision AS "currentRevision",
    r.approved_revision AS "approvedRevision",
    r.before_snapshot AS "beforeSnapshot",
    r.before_digest AS "beforeDigest",
    r.current_proposal AS "currentProposal",
    r.current_proposal_digest AS "currentProposalDigest",
    r.reason,
    r.last_reviewer_comment AS "lastReviewerComment",
    r.approver_user_id AS "approverUserId",
    approver.display_name AS "approverDisplayName",
    r.approved_at AS "approvedAt",
    r.rejected_by_user_id AS "rejectedByUserId",
    r.rejected_at AS "rejectedAt",
    r.created_at AS "createdAt",
    r.updated_at AS "updatedAt",
    sa.employee_id AS "employeeId",
    COALESCE(e.employee_code, '') AS "employeeCode",
    COALESCE(sa.employee_name_snapshot, e.display_name, btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, ''))) AS "employeeName",
    COALESCE(sa.department_snapshot, e.department) AS department,
    sa.work_date AS "workDate"
  FROM attendance_adjustment_requests r
  JOIN shift_assignments sa ON sa.id = r.shift_assignment_id
  LEFT JOIN employees e ON e.id = sa.employee_id
  LEFT JOIN users maker ON maker.id = r.maker_user_id
  LEFT JOIN users approver ON approver.id = r.approver_user_id
;

function createAttendanceAdjustmentService({ prisma = prismaDefault, audit = auditDefault, clock = () => new Date() } = {}) {
  async function getRequestRow(client, id, { lock = false } = {}) {
    const rows = lock
      ? await client.$queryRaw(Prisma.sql`
          ${requestSelectSql}
          WHERE r.id = ${id}::uuid
          FOR UPDATE OF r
        `)
      : await client.$queryRaw(Prisma.sql`
          ${requestSelectSql}
          WHERE r.id = ${id}::uuid
        `);
    return rowShape(rows[0]);
  }

  async function assertCanRead(client, request, actor) {
    if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
    const role = roleOf(actor);
    if (role === 'ADMIN') return;
    if (role !== 'MANAGER' || request.makerUserId !== actor.sub) {
      throw http(403, 'ATTENDANCE_ADJUSTMENT_READ_FORBIDDEN', 'You cannot view this Attendance adjustment request.');
    }
    const assignment = await loadAssignment(client, request.shiftAssignmentId);
    assertMakerScope(actor, assignment);
  }

  async function list({ actor, status = null, assignmentId = null, page = 1, pageSize = 25 } = {}) {
    const role = roleOf(actor);
    if (!['ADMIN', 'MANAGER'].includes(role)) throw http(403, 'ATTENDANCE_ADJUSTMENT_READ_FORBIDDEN', 'Attendance adjustment list requires Manager or Admin authority.');
    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize || 25)));
    const normalizedStatus = status ? String(status).toUpperCase() : null;
    const rows = await prisma.$queryRaw(Prisma.sql`
      ${requestSelectSql}
      WHERE 1=1
        ${normalizedStatus ? Prisma.sql`AND rJ.status = ${normalizedStatus}` : Prisma.empty}
        ${assignmentId ? Prisma.sql`AND r.shift_assignment_id = ${assignmentId}::uuid` : Prisma.empty}
        ${role === 'MANAGER' ? Prisma.sql`AND ".maker_user_id = ${actor.sub}::uuid` : Prisma.empty}
      ORDER BY r.created_at DESC, r.id ASC
      LIMIT ${safePageSize}
      OFFSET ${(safePage - 1) * safePageSize}
    `);
    const counts = await prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM attendance_adjustment_requests r
      WHERE 1=1
        ${normalizedStatus ? Prisma.sql`AND r.status = ${normalizedStatus}` : Prisma.empty}
        ${assignmentId ? Prisma.sql`AND r.shift_assignment_id = ${assignmentId}::uuid` : Prisma.empty}
        ${role === 'MANAGER' ? Prisma.sql`AND ".maker_user_id = ${actor.sub}::uuid` : Prisma.empty}
    `);
    const total = Number(counts[0]?.total || 0);
    return { data: rows.map(rowShape), meta: { page: safePage, pageSize: safePageSize, total, totalPages: Math.max(1, Math.ceil(total / safePageSize)) } };
  }

  async function get({ actor, id } = {}) {
    const request = await getRequestRow(prisma, id);
    await assertCanRead(prisma, request, actor);
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

  async function persistRevision(tx, { requestId, revision, before, proposal, reason, actor, eventType }) {
    const proposalDigest = stableDigest(proposal);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO attendance_adjustment_revisions (
        request_id, revision, before_snapshot, before_digest, proposal, proposal_digest,
        reason, submitted_by_user_id, submitted_by_role_snapshot
      ) VALUES (
        ${requestId}::uuid, ${revision}, ${JSON.stringify(before.snapshot)}::jsonb, ${before.digest},
        ${JSON.stringify(proposal)}::jsonb, ${proposalDigest}, ${reason},
        ${actor.sub}::uuid, ${roleOf(actor)}
      )
    `);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO attendance_adjustment_events (
        request_id, event_type, revision, actor_user_id, actor_role_snapshot, before_snapshot, after_snapshot
      ) VALUES (
        ${requestId}::uuid, ${eventType}, ${revision}, ${actor.sub}::uuid, ${roleOf(actor)},
        ${JSON.stringify(before.snapshot)}::jsonb, ${JSON.stringify(proposal)}::jsonb
      )
    `);
    return proposalDigest;
  }

  async function createDraft({ actor, assignmentId, requestType, proposal, reason } = {}) {
    const normalizedReason = requiredReason(reason);
    const normalized = normalizeProposal(requestType, proposal);
    return prisma.$transaction(async (tx) => {
      const assignment = await loadAssignment(tx, assignmentId);
      const role = assertMakerScope(actor, assignment);
      const before = await authoritySnapshot(tx, assignment);
      const revision = 1;
      const proposalDigest = stableDigest(normalized.proposal);
      const rows = await tx.$queryRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_requests (
          shift_assignment_id, attendance_session_id, request_type, status, maker_user_id, maker_role_snapshot,
          current_revision, before_snapshot, before_digest, current_proposal, current_proposal_digest, reason
        ) VALUES (
          ${assignment.id}::uuid, ${assignment.attendanceSession?.id || null}::uuid, ${normalized.type}, 'DRAFT',
          ${actor.sub}::uuid, ${role}, ${revision}, ${JSON.stringify(before.snapshot)}::jsonb, ${before.digest},
          ${JSON.stringify(normalized.proposal)}::jsonb, ${proposalDigest}, ${normalizedReason}
        )
        RETURNING id
      `);
      const requestId = rows[0].id;
      await persistRevision(tx, { requestId, revision, before, proposal: normalized.proposal, reason: normalizedReason, actor, eventType: 'CREATED' });
      await audit.log({
        actorUserId: actor.sub,
        action: 'CREATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: requestId,
        metadata: {
          shiftAssignmentId: assignment.id,
          requestType: normalized.type,
          status: 'DRAFT',
          revision,
          beforeDigest: before.digest,
          proposalDigest
        }
      }, tx);
      return getRequestRow(tx, requestId);
    }, TRANSACTION_OPTIONS);
  }

  async function revise({ actor, id, requestType, proposal, reason } = {}) {
    const normalizedReason = requiredReason(reason);
    const normalized = normalizeProposal(requestType, proposal);
    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, { lock: true });
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      const assignment = await loadAssignment(tx, request.shiftAssignmentId);
      assertMakerScope(actor, assignment);
      if (request.makerUserId !== actor.sub) throw http(403, 'ATTENDANCE_ADJUSTMENT_NOT_MAKER', 'Only the request maker may revise this Attendance adjustment request.');
      if (!EDITABLE_STATUSES.has(request.status)) throw http(409, 'ATTENDANCE_ADJUSTMENT_NOT_EDITABLE', 'Only Draft or Returned requests may be revised.');
      const before = await authoritySnapshot(tx, assignment);
      const revision = request.currentRevision + 1;
      const proposalDigest = await persistRevision(tx, { requestId: id, revision, before, proposal: normalized.proposal, reason: normalizedReason, actor, eventType: 'REVISED' });
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
        entityId: ndull,
        metadata: { event: 'REVISED', revision, status: request.status, beforeDigest: before.digest, proposalDigest }
      }, tx);
      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function submit({ actor, id } = {}) {
    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, { lock: true });
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      const assignment = await loadAssignment(tx, request.shiftAssignmentId);
      assertMakerScope(actor, assignment);
      if (request.makerUserId !== actor.sub) throw http(403, 'ATTENDANCE_ADJUSTMENT_NOT_MAKER', 'Only the request maker may submit this Attendance adjustment request.');
      if (!EDITABLE_STATUSES.has(request.status)) throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only Draft or Returned requests may be submitted.');
      const fromStatus = request.status;
      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = 'PENDING_APPROVAL', last_reviewer_comment = NULL, updated_at = ${clock()}
        WHERE id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_events (
          request_id, event_type, revision, actor_user_id, actor_role_snapshot, before_snapshot, after_snapshot
        ) VALUES (
          ${id}::uuid, 'SUBMITTED', ${request.currentRevision}, ${actor.sub}::uuid, ${roleOf(actor)},
          ${JSON.stringify(request.beforeSnapshot)}::jsonb, ${JSON.stringify(request.currentProposal)}::jsonb
        )
      `);
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: id,
        metadata: { event: 'SUBMITTED', fromStatus, toStatus: 'PENDING_APPROVAL', revision: request.currentRevision }
      }, tx);
      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function returnForCorrection({ actor, id, comment } = {}) {
    assertAdmin(actor);
    const normalizedComment = reviewerComment(comment);
    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, { lock: true });
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      if (request.status !== 'PENDINH_APPROVAL') throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only pending requests may be returned.');
      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = 'RETURNED_FOR_CORRECTION', last_reviewer_comment = ${normalizedComment}, updated_at = ${clock()}
        WHERE id = ${id}::uud
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_events (
          request_id, event_type, revision, actor_user_id, actor_role_snapshot, comment
        ) VALUES (
          ${id}::uuid, 'RETURNED', ${request.currentRevision}, ${actor.sub}::uuid, 'ADMIN', ${normalizedComment}
        )
      `);
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: id,
        metadata: { event: 'RETURNED', fromStatus: 'PENDING_APPROVAL', toStatus: 'RETURNED_FOR_CORRECTION', revision: request.currentRevision }
      }, tx);
      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function reject({ actor, id, comment } = {}) {
    assertAdmin(actor);
    const normalizedComment = reviewerComment(comment);
    const now = clock();
    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, { lock: true });
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      if (request.status !== 'PENDING_APPROVAL') throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only pending requests may be rejected.');
      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = 'REJECTED', last_reviewer_comment = ${normalizedComment},
            rejected_by_user_id = ${actor.sub}::uud, rejected_at = ${now}, updated_at = ${now}
        WHERE id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_events (
          request_id, event_type, revision, actor_user_id, actor_role_snapshot, comment
        ) VALUES (
          ${id}::uuid, 'REJECTED', ${request.currentRevision}, ${actor.sub}::uuid, 'ADMIN', ${normalizedComment}
        )
      `);
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: ndull,
        metadata: { event: 'REJECTED', fromStatus: 'PENDING_APPROVAL', toStatus: 'REJECTED', revision: request.currentRevision }
      }, tx);
      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function approve({ actor, id } = {}) {
    assertAdmin(actor);
    const now = clock();

    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, { lock: true });
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      if (request.status !== 'PENDING_APPROVAL') throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only pending requests may be approved.');

      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM shift_assignments WHERE id = ${request.shiftAssignmentId}::uuid FOR UPDATE`¤ì(ô(½¹ÍÐÍÍ¥¹µ¹ÐôÝ¥Ð±½ÍÍ¥¹µ¹Ð¡Ñà°ÉÅÕÍÐ¹Í¡¥ÑÍÍ¥¹µ¹Ñ%¤ì(½¹ÍÐÉÑ¥¥Ñ¥½¸ôÝ¥ÐÕÉÉ¹Ñ5½¹Ñ¡ÉÑ¥¥Ñ¥½¸¡Ñà°ÍÍ¥¹µ¹Ð¹Ý½É­Ñ¤ì(¥¡ÉÑ¥¥Ñ¥½¸¤Ñ¡É½Ü¡ÑÑÀ ÐÀä°QQ99}5=9Q!}IQ%%°ÉÑ¥¥ÑÑ¹¹µ½¹Ñ µÕÍÐÕ¹±½­½ÉÁÁÉ½Ù¥¹¸©ÕÍÑµ¹Ð¸¤ì((½¹ÍÐÕÉÉ¹ÐôÝ¥ÐÕÑ¡½É¥ÑåM¹ÁÍ¡½Ð¡Ñà°ÍÍ¥¹µ¹Ð¤ì(¥¡ÕÉÉ¹Ð¹¥ÍÐôôÉÅÕÍÐ¹½É¥ÍÐ¤ì(Ñ¡É½Ü¡ÑÑÀ ÐÀä°MQ1}QQ99}	M°ÕÑ¡½É¥ÑÑ¥ÙÑÑ¹¹¡¹ÑÈÑ¡¥ÌÉÅÕÍÐÉÙ¥Í¥½¸ÝÌÁÉÁÉ¸IÉÍ ¹ÉÍÕµ¥Ð¸°ì(áÁÑ¥ÍÐèÉÅÕÍÐ¹½É¥ÍÐ°(ÕÉÉ¹Ñ¥ÍÐèÕÉÉ¹Ð¹¥ÍÐ(ô¤ì(ô((½¹ÍÐÁÉ½Á½Í°ôÉÅÕÍÐ¹ÕÉÉ¹ÑAÉ½Á½Í°ñðíôì(½¹ÍÐÉÝÙ¹ÑÌôÍÍ¥¹µ¹Ð¹ÑÑ¹¹MÍÍ¥½¸ü¹Ù¹ÑÌñðmtì(½¹ÍÐ¹ÑÉ¥Ìôl(l!-}%8°ÁÉ½Á½Í°¹¡­%¹Ñt°(l!-}=UP°ÁÉ½Á½Í°¹¡­=ÕÑÑt(t¹¥±ÑÈ ¡l°Ù±Õt¤ôø	½½±¸¡Ù±Õ¤¤ì((¥ ¹ÑÉ¥Ì¹±¹Ñ ¤Ñ¡É½Ü¡ÑÑÀ ÐÀä°QQ99})UMQ59Q}AI=A=M1}5AQd°MÕµ¥ÑÑ©ÕÍÑµ¹ÐÁÉ½Á½Í°¡Ì¹¼Ñ¥ÙÑ¥µ¡¹Ì¸¤ì((½È¡½¹ÍÐmÙ¹ÑQåÁ°Ù±Õt½¹ÑÉ¥Ì¤ì(½¹ÍÐ½ÉÉÑÐô¹ÜÑ¡Ù±Õ¤ì(½¹ÍÐ½É¥¥¹°ôÙ¹Ñ	åQåÁ¡ÉÝÙ¹ÑÌ°Ù¹ÑQåÁ¤ì(Ý¥ÐÑà¸áÕÑIÜ¡AÉ¥Íµ¹ÍÅ±(UAQÑÑ¹¹}½ÉÉÑ¥½¹Ì(MP¥Í}ÕÉÉ¹Ðô1M°ÍÕÁÉÍ}Ðôí¹½Ýô(]!IÍ¡¥Ñ}ÍÍ¥¹µ¹Ñ}¥ôíÍÍ¥¹µ¹Ð¹¥ôèéÕÕ¥(9Ù¹Ñ}ÑåÁôíÙ¹ÑQåÁôèèÑÑ¹¹Ù¹ÑQåÁ(9¥Í}ÕÉÉ¹ÐôQIU(¤ì(½¹ÍÐÉ½ÝÌôÝ¥ÐÑà¸ÅÕÉåIÜ¡AÉ¥Íµ¹ÍÅ±(%9MIP%9Q<ÑÑ¹¹}½ÉÉÑ¥½¹Ì (Í¡¥Ñ}ÍÍ¥¹µ¹Ñ}¥°ÑÑ¹¹}ÍÍÍ¥½¹}¥°Ù¹Ñ}ÑåÁ°½É¥¥¹±}Ù¹Ñ}¥°½É¥¥¹±}Ñ¥Ù}Ù¹Ñ}Ð°(½ÉÉÑ}Ñ¥Ù}Ù¹Ñ}Ð°ÉÍ½¸°Ñ½É}ÕÍÉ}¥°Ñ½É}É½±}Í¹ÁÍ¡½Ð°(Í½ÕÉ}©ÕÍÑµ¹Ñ}ÉÅÕÍÑ}¥°Í½ÕÉ}©ÕÍÑµ¹Ñ}ÉÙ¥Í¥½¸°ÁÁÉ½Ù}å}ÕÍÉ}¥°ÁÁÉ½Ù}Ð(¤Y1UL (íÍÍ¥¹µ¹Ð¹¥ôèéÕÕ¥°(íÍÍ¥¹µ¹Ð¹ÑÑ¹¹MÍÍ¥½¸ü¹¥ñð¹Õ±±ôèéÕÕ¥°(íÙ¹ÑQåÁôèèÑÑ¹¹Ù¹ÑQåÁ°(í½É¥¥¹°ü¹¥ñð¹Õ±±ôèéÕÕ¥°(í½É¥¥¹°ü¹Ñ¥ÙÙ¹ÑÐñð¹Õ±±ô°(í½ÉÉÑÑô°(íÉÅÕÍÐ¹ÉÍ½¹ô°(íÉÅÕÍÐ¹µ­ÉUÍÉ%ôèéÕÕ¥°(íÉÅÕÍÐ¹µ­ÉI½±M¹ÁÍ¡½Ñô°(í¥ôèéÕÕ°(íÉÅÕÍÐ¹ÕÉÉ¹ÑIÙ¥Í¥½¹ô°(íÑ½È¹ÍÕôèéÕÕ¥°(í¹½Ýô(¤(IQUI9%9¥(¤ì(Ý¥ÐÕ¥Ð¹±½¡ì(Ñ½ÉUÍÉ%èÑ½È¹ÍÕ°(Ñ¥½¸èIQ°(¹Ñ¥ÑåQåÁèÑÑ¹¹½ÉÉÑ¥½¸°(¹Ñ¥Ñå%èÉ½ÝÍlÁt¹¥°(µÑÑèì(Í½ÕÉ©ÕÍÑµ¹ÑIÅÕÍÑ%è¥°(Í½ÕÉ©ÕÍÑµ¹ÑIÙ¥Í¥½¸èÉÅÕÍÐ¹ÕÉÉ¹ÑIÙ¥Í¥½¸°(µ­ÉUÍÉ%èÉÅÕÍÐ¹µ­ÉUÍÉ%°(µ­ÉI½±M¹ÁÍ¡½ÐèÉÅÕÍÐ¹µ­ÉI½±M¹ÁÍ¡½Ð°(ÁÁÉ½ÙÉUÍÉ%èÑ½È¹ÍÕ°(Ù¹ÑQåÁ°(½ÉèÙ¹ÑQåÁôôô!-}%8üÕÉÉ¹Ð¹Í¹ÁÍ¡½Ð¹Ñ¥Ù¹¡­%¹ÐèÕÉÉ¹Ð¹Í¹ÁÍ¡½Ð¹Ñ¥Ù¹¡­=ÕÑÐ°(ÑÈè½ÉÉÑÐ¹Ñ½%M=MÑÉ¥¹ ¤°(ÉÍ½¸èÉÅÕÍÐ¹ÉÍ½¸(ô(ô°Ñà¤ì(ô((½¹ÍÐÑÉM¹ÁÍ¡½Ðôì(¸¸¹ÕÉÉ¹Ð¹Í¹ÁÍ¡½Ð°(Ñ¥Ùèì(¡­%¹ÐèÁÉ½Á½Í°¹¡­%¹ÐñðÕÉÉ¹Ð¹Í¹ÁÍ¡½Ð¹Ñ¥Ù¹¡­%¹Ð°(¡­=ÕÑÐèÁÉ½Á½Í°¹¡­=ÕÑÐñðÕÉÉ¹Ð¹Í¹ÁÍ¡½Ð¹Ñ¥Ù¹¡­=ÕÑÐ(ô(ôì((Ý¥ÐÑà¸áÕÑIÜ¡AÉ¥Íµ¹ÍÅ±(UAQÑÑ¹¹}©ÕÍÑµ¹Ñ}ÉÅÕÍÑÌ(MPÍÑÑÕÌôAAI=Y°ÁÁÉ½Ù}ÉÙ¥Í¥½¸ôíÉÅÕÍÐ¹ÕÉÉ¹ÑIÙ¥Í¥½¹ô°(ÁÁÉ½ÙÉ}ÕÍÉ}¥ôíÑ½È¹ÍÕôèéÕÕ¥°ÁÁÉ½Ù}Ðôí¹½Ýô°(±ÍÑ}ÉÙ¥ÝÉ}½µµ¹Ðô9U10°ÕÁÑ}Ðôí¹½Ýô(]!I¥ôí¥ôèéÕÕ(¤ì(Ý¥ÐÑà¸áÕÑIÜ¡AÉ¥Íµ¹ÍÅ±(%9MIP%9Q<ÑÑ¹¹}©ÕÍÑµ¹Ñ}Ù¹ÑÌ (ÉÅÕÍÑ}¥°Ù¹Ñ}ÑåÁ°ÉÙ¥Í¥½¸°Ñ½É}ÕÍÉ}¥°Ñ½É}É½±}Í¹ÁÍ¡½Ð°½É}Í¹ÁÍ¡½Ð°ÑÉ}Í¹ÁÍ¡½Ð(¤Y1UL (í¥ôèéÕÕ¥°AAI=Y°íÉÅÕÍÐ¹ÕÉÉ¹ÑIÙ¥Í¥½¹ô°íÑ½È¹ÍÕôèéÕÕ°5%8°(í)M=8¹ÍÑÉ¥¹¥ä¡ÕÉÉ¹Ð¹Í¹ÁÍ¡½Ð¥ôèé©Í½¹°í)M=8¹ÍÑÉ¥¹¥ä¡ÑÉM¹ÁÍ¡½Ð¥ôèé©Í½¹(¤(¤ì(Ý¥ÐÕ¥Ð¹±½¡ì(Ñ½ÉUÍÉ%èÑ½È¹ÍÕ°(Ñ¥½¸èUAQ°(¹Ñ¥ÑåQåÁèÑÑ¹¹©ÕÍÑµ¹ÑIÅÕÍÐ°(¹Ñ¥Ñå%è¥°(µÑÑèì(Ù¹ÐèAAI=Y°(É½µMÑÑÕÌèA9%9}AAI=Y0°(Ñ½MÑÑÕÌèAAI=Y°(ÉÙ¥Í¥½¸èÉÅÕÍÐ¹ÕÉÉ¹ÑIÙ¥Í¥½¸°(µ­ÉUÍÉ%èÉÅÕÍÐ¹µ­ÉUÍÉ%°(ÁÁÉ½ÙÉUÍÉ%èÑ½È¹ÍÕ°(½É¥ÍÐèÕÉÉ¹Ð¹¥ÍÐ°(½ÉèÕÉÉ¹Ð¹Í¹ÁÍ¡½Ð°(ÑÈèÑÉM¹ÁÍ¡½Ð°(ÉÍ½¸èÉÅÕÍÐ¹ÉÍ½¸(ô(ô°Ñà¤ì((ÉÑÕÉ¸ÑIÅÕÍÑI½Ü¡Ñà°¥¤ì(ô°QI9MQ%=9}=AQ%=9L¤ì(ô((ÉÑÕÉ¸ì(±¥ÍÐ°(Ð°(ÉÑÉÐ°(ÉÙ¥Í°(ÍÕµ¥Ð°(ÉÑÕÉ¹½É½ÉÉÑ¥½¸°(É©Ð°(ÁÁÉ½Ù(ôì)ô()µ½Õ±¹áÁ½ÉÑÌôì(QI9MQ%=9}=AQ%=9L°(IEUMQ}QeAL°(%Q	1}MQQUML°(ÉÅÕ¥ÉIÍ½¸°(ÉÙ¥ÝÉ½µµ¹Ð°(¹½Éµ±¥éAÉ½Á½Í°°(ÍÑ±¥ÍÐ°(ÕÑ¡½É¥ÑåM¹ÁÍ¡½Ð°(ÍÍÉÑ5­ÉM½Á°(ÍÍÉÑµ¥¸°(ÉÑÑÑ¹¹©ÕÍÑµ¹ÑMÉÙ¥)ôìÿÿÿ