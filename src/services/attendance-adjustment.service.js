
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
const { bangkokToday } = require('../utils/bangkok-date');

const TRANSACTION_OPTIONS = { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 };
const REQUEST_TYPES = new Set(['CONFIRM_WORK_PERFORMED', 'ADJUST_WORK_TIME']);
const EDITABLE_STATUSES = new Set(['DRAFT', 'RETURNED_FOR_CORRECTION']);
// OWNER policy (18 Oct 2026): non-ADMIN makers may key at most 3 days back.
const BACKDATE_WINDOW_DAYS = 3;
// OWNER policy (18 Oct 2026): server-side guard on the confirmed working window.
const MAX_SHIFT_HOURS = 16;
const EARLY_TOLERANCE_HOURS = 4;
const LATE_TOLERANCE_HOURS = 8;
const CHECKOUT_TOLERANCE_HOURS = 8;

function bangkokDateTimeFrom(dateLike, hhmm) {
  if (!/^\d{2}:\d{2}$/.test(String(hhmm || ''))) return null;
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
  const parsed = new Date(`${ymd}T${hhmm}:00+07:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function assertProposalWindow(assignment, proposal) {
  const start = proposal?.checkInAt ? new Date(proposal.checkInAt) : null;
  const end = proposal?.checkOutAt ? new Date(proposal.checkOutAt) : null;
  if (!start || !end) return;
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours > MAX_SHIFT_HOURS) {
    throw http(409, 'ATTENDANCE_ADJUSTMENT_DURATION_INVALID', `A confirmed shift may not exceed ${MAX_SHIFT_HOURS} hours.`);
  }
  const shiftStart = assignment?.startTime;
  if (shiftStart) {
    const plannedStart = bangkokDateTimeFrom(assignment.workDate, shiftStart);
    if (plannedStart) {
      const delta = (start.getTime() - plannedStart.getTime()) / 3_600_000;
      if (delta < -EARLY_TOLERANCE_HOURS || delta > LATE_TOLERANCE_HOURS) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_WINDOW_INVALID', `Check-in must be within ${EARLY_TOLERANCE_HOURS}h before and ${LATE_TOLERANCE_HOURS}h after the shift start.`);
      }
    }
  }
  const shiftEnd = assignment?.endTime;
  if (shiftEnd) {
    const crossesMidnight = String(shiftEnd) <= String(shiftStart || '');
    const plannedEndDate = crossesMidnight ? new Date(assignment.workDate) : new Date(assignment.workDate);
    if (crossesMidnight) plannedEndDate.setUTCDate(plannedEndDate.getUTCDate() + 1);
    const plannedEnd = bangkokDateTimeFrom(plannedEndDate, shiftEnd);
    if (plannedEnd) {
      const deltaOut = Math.abs((end.getTime() - plannedEnd.getTime()) / 3_600_000);
      if (deltaOut > CHECKOUT_TOLERANCE_HOURS) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_WINDOW_INVALID', `Check-out must be within ${CHECKOUT_TOLERANCE_HOURS}h of the shift end.`);
      }
    }
  }
}
// OWNER policy (18 Oct 2026): staged approval chain.
// Employee -> any SUPERVISOR -> any MANAGER -> ADMIN final approval.
const PENDING_SUPERVISOR = 'PENDING_SUPERVISOR';
const PENDING_MANAGER = 'PENDING_MANAGER';
const PENDING_ADMIN = 'PENDING_ADMIN';
const LEGACY_PENDING = 'PENDING_APPROVAL';
const PENDING_STATUSES = new Set([PENDING_SUPERVISOR, PENDING_MANAGER, PENDING_ADMIN, LEGACY_PENDING]);
const REVIEW_STAGES = new Set([PENDING_SUPERVISOR, PENDING_MANAGER]);

function nextStageForMaker(makerRole) {
  // A reviewer never approves their own level: supervisor-made requests skip to the manager,
  // manager-made requests go straight to the admin.
  if (makerRole === 'SUPERVISOR') return PENDING_MANAGER;
  if (makerRole === 'MANAGER' || makerRole === 'ADMIN') return PENDING_ADMIN;
  return PENDING_SUPERVISOR;
}

function reviewerRoleFor(status) {
  if (status === PENDING_SUPERVISOR) return 'SUPERVISOR';
  if (status === PENDING_MANAGER) return 'MANAGER';
  return 'ADMIN';
}

function attendanceCertificationLockKey(workDate) {
  const value = workDate instanceof Date ? workDate : new Date(workDate);
  if (Number.isNaN(value.getTime())) throw http(500, 'ATTENDANCE_WORK_DATE_INVALID', 'Attendance work date is invalid.');
  return `attendance-cert:${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

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

function assertMakerScope(actor, assignment, clock = () => new Date()) {
  const role = roleOf(actor);
  if (!actor?.sub) throw http(403, 'ATTENDANCE_ADJUSTMENT_ACTOR_REQUIRED', 'Authenticated actor identity is required.');
  if (!['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'].includes(role)) {
    throw http(403, 'ATTENDANCE_ADJUSTMENT_FORBIDDEN', 'Attendance adjustment request authority is required.');
  }
  if (role === 'ADMIN') return role;
  // OWNER policy (18 Oct 2026): employees, MANAGER and SUPERVISOR may key at most 3 days back,
  // because the ADMIN must verify real work evidence before approving (client penalties apply).
  const cutoff = bangkokToday(clock());
  cutoff.setUTCDate(cutoff.getUTCDate() - BACKDATE_WINDOW_DAYS);
  const workDate = new Date(assignment.workDate);
  if (Number.isNaN(workDate.getTime()) || workDate < cutoff) {
    throw http(403, 'ATTENDANCE_ADJUSTMENT_BACKDATE_FORBIDDEN', `Attendance adjustment may not be made more than ${BACKDATE_WINDOW_DAYS} days in the past.`);
  }
  if (role === 'VIEWER' && (!actor.employeeAuthority?.id || String(assignment.employeeId) !== String(actor.employeeAuthority.id))) {
    throw http(403, 'ATTENDANCE_ADJUSTMENT_SCOPE_FORBIDDEN', 'A linked employee account may adjust only its own shift.');
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

const requestSelect = Prisma.sql`
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
    e.employee_code AS "employeeCode",
    COALESCE(sa.employee_name_snapshot, e.display_name, btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, ''))) AS "employeeName",
    COALESCE(sa.department_snapshot, e.department) AS department,
    sa.work_date AS "workDate"
  FROM attendance_adjustment_requests r
  JOIN shift_assignments sa ON sa.id = r.shift_assignment_id
  LEFT JOIN employees e ON e.id = sa.employee_id
  LEFT JOIN users maker ON maker.id = r.maker_user_id
  LEFT JOIN users approver ON approver.id = r.approver_user_id
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
    if (role === 'MANAGER' || role === 'SUPERVISOR') return;
    if (role !== 'VIEWER' || !actor?.employeeAuthority?.id || String(request.employeeId) !== String(actor.employeeAuthority.id)) {
      throw http(403, 'ATTENDANCE_ADJUSTMENT_READ_FORBIDDEN', 'Attendance adjustment access denied.');
    }
  }

  async function list({ actor, status = null, statuses = null, assignmentId = null, requestId = null, page = 1, pageSize = 25 } = {}) {
    const role = roleOf(actor);
    if (!['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'].includes(role) || (role === 'VIEWER' && !actor?.employeeAuthority?.id)) throw http(403, 'ATTENDANCE_ADJUSTMENT_READ_FORBIDDEN', 'Attendance adjustment list requires an authorized role.');

    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize || 25)));
    const normalizedStatus = status ? String(status).trim().toUpperCase() : null;
    const offset = (safePage - 1) * safePageSize;

    const scope = role === 'VIEWER'
      ? Prisma.sql`AND sa.employee_id = ${actor.employeeAuthority.id}::uuid`
      : Prisma.empty;
    // OWNER policy (18 Oct 2026): the queue spans several staged statuses in a single query.
    const normalizedStatuses = Array.isArray(statuses)
      ? statuses.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)
      : null;
    const statusClause = normalizedStatuses?.length
      ? Prisma.sql`AND r.status IN (${Prisma.join(normalizedStatuses)})`
      : normalizedStatus ? Prisma.sql`AND r.status = ${normalizedStatus}` : Prisma.empty;
    const assignmentClause = assignmentId ? Prisma.sql`AND r.shift_assignment_id = ${assignmentId}::uuid` : Prisma.empty;
    const requestClause = requestId ? Prisma.sql`AND r.id = ${requestId}::uuid` : Prisma.empty;

    const rows = await prisma.$queryRaw(Prisma.sql`
      ${requestSelect}
      WHERE 1=1
        ${scope}
        ${statusClause}
        ${assignmentClause}
        ${requestClause}
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
        ${requestClause}
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
      const makerRole = assertMakerScope(actor, assignment, clock);
      assertProposalWindow(assignment, normalized.proposal);
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
      assertMakerScope(actor, assignment, clock);
      assertProposalWindow(assignment, normalized.proposal);
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
      if (request.makerUserId !== actor.sub) {
        throw http(403, 'ATTENDANCE_ADJUSTMENT_NOT_MAKER', 'Only the request maker may submit this Attendance adjustment request.');
      }
      assertMakerScope(actor, assignment, clock);
      if (!EDITABLE_STATUSES.has(request.status)) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only Draft or Returned requests may be submitted.');
      }
      if (request.status === 'RETURNED_FOR_CORRECTION') {
        const returned = await tx.$queryRaw(Prisma.sql`
          SELECT revision
          FROM attendance_adjustment_events
          WHERE request_id = ${id}::uuid
            AND event_type = 'RETURNED'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `);
        const returnedRevision = returned[0]?.revision == null ? request.currentRevision : Number(returned[0].revision);
        if (request.currentRevision <= returnedRevision) {
          throw http(
            409,
            'ATTENDANCE_ADJUSTMENT_REVISION_REQUIRED_AFTER_RETURN',
            'Returned Attendance adjustment request must be revised before it can be submitted again.'
          );
        }
      }

      const fromStatus = request.status;
      // OWNER policy (18 Oct 2026): route to the first reviewer above the maker's level.
      const nextStatus = nextStageForMaker(request.makerRoleSnapshot);
      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = ${nextStatus},
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

  async function review({ actor, id, comment } = {}) {
    // OWNER policy (18 Oct 2026): forward one stage up the chain.
    const actorRole = roleOf(actor);
    if (!['SUPERVISOR', 'MANAGER', 'ADMIN'].includes(actorRole)) {
      throw http(403, 'ATTENDANCE_ADJUSTMENT_REVIEWER_REQUIRED', 'Only executive roles may review Attendance adjustment requests.');
    }
    // A forwarding comment is optional; a return comment is mandatory (see returnForCorrection).
    const normalizedComment = comment == null || String(comment).trim() === '' ? null : reviewerComment(comment);

    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, true);
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      if (!REVIEW_STAGES.has(request.status)) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only requests awaiting a reviewer may be forwarded.');
      }
      const requiredRole = reviewerRoleFor(request.status);
      if (actorRole !== requiredRole && actorRole !== 'ADMIN') {
        throw http(403, 'ATTENDANCE_ADJUSTMENT_STAGE_FORBIDDEN', 'Only the reviewer of the current stage may forward this request.');
      }

      const nextStatus = request.status === PENDING_SUPERVISOR ? PENDING_MANAGER : PENDING_ADMIN;
      await tx.$executeRaw(Prisma.sql`
        UPDATE attendance_adjustment_requests
        SET status = ${nextStatus},
            last_reviewer_comment = ${normalizedComment},
            updated_at = ${clock()}
        WHERE id = ${id}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO attendance_adjustment_events (
          request_id, event_type, revision, actor_user_id, actor_role_snapshot, comment
        ) VALUES (
          ${id}::uuid,
          'REVIEWED',
          ${request.currentRevision},
          ${actor.sub}::uuid,
          ${actorRole},
          ${normalizedComment}
        )
      `);
      await audit.log({
        actorUserId: actor.sub,
        action: 'UPDATE',
        entityType: 'AttendanceAdjustmentRequest',
        entityId: id,
        metadata: {
          event: 'REVIEWED',
          fromStatus: request.status,
          toStatus: nextStatus,
          revision: request.currentRevision,
          comment: normalizedComment
        }
      }, tx);
      return getRequestRow(tx, id);
    }, TRANSACTION_OPTIONS);
  }

  async function returnForCorrection({ actor, id, comment } = {}) {
    // OWNER policy (18 Oct 2026): every stage may return for correction; the reviewer must be
    // the role that owns the current stage (ADMIN may always return).
    const actorRole = roleOf(actor);
    if (!['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(actorRole)) {
      throw http(403, 'ATTENDANCE_ADJUSTMENT_REVIEWER_REQUIRED', 'Only executive roles may review Attendance adjustment requests.');
    }
    const normalizedComment = reviewerComment(comment);

    return prisma.$transaction(async (tx) => {
      const request = await getRequestRow(tx, id, true);
      if (!request) throw http(404, 'ATTENDANCE_ADJUSTMENT_NOT_FOUND', 'Attendance adjustment request was not found.');
      if (!PENDING_STATUSES.has(request.status)) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only pending requests may be returned.');
      }
      if (actorRole !== 'ADMIN' && actorRole !== reviewerRoleFor(request.status)) {
        throw http(403, 'ATTENDANCE_ADJUSTMENT_STAGE_FORBIDDEN', 'Only the reviewer of the current stage may return this request.');
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
      if (request.status !== PENDING_ADMIN && request.status !== LEGACY_PENDING) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only requests that reached the administrator stage may be rejected.');
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
      if (request.status !== PENDING_ADMIN && request.status !== LEGACY_PENDING) {
        throw http(409, 'ATTENDANCE_ADJUSTMENT_INVALID_TRANSITION', 'Only requests that reached the administrator stage may be approved.');
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM shift_assignments
        WHERE id = ${request.shiftAssignmentId}::uuid
        FOR UPDATE
      `);

      const assignment = await loadAssignment(tx, request.shiftAssignmentId);
      const certificationLockKey = attendanceCertificationLockKey(assignment.workDate);
      await tx.$queryRaw(Prisma.sql`
        SELECT 1::integer AS locked
        FROM pg_advisory_xact_lock(hashtext(${certificationLockKey}))
      `);
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
    review,
    returnForCorrection,
    reject,
    approve
  };
}

module.exports = {
  TRANSACTION_OPTIONS,
  REQUEST_TYPES,
  EDITABLE_STATUSES,
  attendanceCertificationLockKey,
  requiredReason,
  reviewerComment,
  normalizeProposal,
  stableDigest,
  authoritySnapshot,
  assertMakerScope,
  assertAdmin,
  assertProposalWindow,
  nextStageForMaker,
  reviewerRoleFor,
  PENDING_SUPERVISOR,
  PENDING_MANAGER,
  PENDING_ADMIN,
  LEGACY_PENDING,
  createAttendanceAdjustmentService
};
