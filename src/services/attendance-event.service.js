'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { createAttendanceVerificationContextService } = require('./attendance-verification-context.service');
const { createSecuritySiteAuthorityService, SITE_AUTHORITY_SOURCES } = require('./security-site-authority.service');

const EVENT_INTENTS = new Set(['CHECK_IN', 'CHECK_OUT']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw http(500, 'ATTENDANCE_EXPECTATION_INVALID', 'Attendance expectation contains an invalid number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  throw http(500, 'ATTENDANCE_EXPECTATION_INVALID', 'Attendance expectation contains an unsupported value.');
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(Buffer.from(JSON.stringify(canonicalize(value)), 'utf8')).digest('hex');
}

function normalizedUuid(value, code) {
  const text = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(text)) throw http(400, code, 'A valid UUID is required.');
  return text;
}

function eventIntent(value) {
  const intent = String(value || '').trim().toUpperCase();
  if (!EVENT_INTENTS.has(intent)) throw http(400, 'ATTENDANCE_EVENT_INTENT_INVALID', 'Attendance event intent must be CHECK_IN or CHECK_OUT.');
  return intent;
}

function dateOnly(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw http(409, 'ATTENDANCE_SCHEDULE_STALE', 'Attendance schedule date is invalid.');
  return d.toISOString().slice(0, 10);
}

function monthStart(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function decimalString(value) {
  return value == null ? null : String(value);
}

function buildExpectationSnapshot(assignment, approval, siteAuthority = null) {
  const site = siteAuthority?.site || assignment.securitySite;
  const siteSnapshot = {
    id: site.id,
    code: site.code,
    name: site.name,
    latitude: decimalString(site.latitude),
    longitude: decimalString(site.longitude),
    geofenceRadiusMeters: site.geofenceRadiusMeters,
    isActive: site.isActive === true
  };
  if (siteAuthority?.source === SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT) {
    siteSnapshot.authoritySource = SITE_AUTHORITY_SOURCES.DEPARTMENT_DEFAULT;
    siteSnapshot.departmentName = siteAuthority.departmentName || null;
  }
  return {
    version: 'ATTENDANCE_EXPECTATION_V1',
    shiftAssignmentId: assignment.id,
    employeeId: assignment.employeeId,
    workDate: dateOnly(assignment.workDate),
    locked: assignment.locked === true,
    shift: {
      id: assignment.shiftType.id,
      code: assignment.shiftType.code,
      name: assignment.shiftType.name,
      startTime: assignment.startTime || assignment.shiftType.startTime || null,
      endTime: assignment.endTime || assignment.shiftType.endTime || null,
      hours: decimalString(assignment.hours)
    },
    site: siteSnapshot,
    scheduleApproval: {
      id: approval.id,
      revision: approval.revision,
      status: approval.status,
      approvedAt: approval.approvedAt ? new Date(approval.approvedAt).toISOString() : null
    }
  };
}

function safeSession(row) {
  return row ? {
    id: row.id,
    employeeId: row.employeeId,
    shiftAssignmentId: row.shiftAssignmentId,
    expectedShiftTypeId: row.expectedShiftTypeId,
    expectedSiteId: row.expectedSiteId,
    workDate: row.workDate,
    state: row.state,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  } : null;
}

function safeEvent(row) {
  return row ? {
    id: row.id,
    sessionId: row.sessionId,
    faceVerificationSessionId: row.faceVerificationSessionId,
    captureId: row.captureId,
    eventType: row.eventType,
    provenance: row.provenance,
    receivedAt: row.receivedAt,
    effectiveEventAt: row.effectiveEventAt,
    timeBasis: row.timeBasis,
    contextDigest: row.contextDigest,
    createdAt: row.createdAt
  } : null;
}

function createAttendanceEventService({
  prisma = prismaDefault,
  audit = auditDefault,
  verificationContextService = null,
  siteAuthorityService = null,
  clock = () => new Date()
} = {}) {
  const verificationContext = verificationContextService || createAttendanceVerificationContextService({ prisma, clock });
  const siteAuthority = siteAuthorityService || createSecuritySiteAuthorityService({ prisma });

  async function actorIdentity(client, actor) {
    const user = await client.user.findUnique({
      where: { id: actor?.sub },
      select: {
        id: true,
        employeeId: true,
        isActive: true,
        accountStatus: true,
        employee: { select: { id: true, isActive: true, deletedAt: true } }
      }
    });
    if (!user?.employeeId || !user.employee) throw http(403, 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED', 'A linked employee account is required for Attendance.');
    if (!user.isActive || user.accountStatus !== 'ACTIVE' || !user.employee.isActive || user.employee.deletedAt) {
      throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot record Attendance.');
    }
    return { userId: user.id, employeeId: user.employeeId };
  }

  async function loadExpectation(client, resolved) {
    const assignment = await client.shiftAssignment.findUnique({
      where: { id: resolved.authority.shiftAssignmentId },
      include: { shiftType: true, securitySite: true }
    });
    if (!assignment || assignment.employeeId !== resolved.authority.employeeId || assignment.locked !== true) {
      throw http(409, 'ATTENDANCE_SCHEDULE_STALE', 'Attendance Shift Assignment changed before event acceptance.');
    }
    if (!assignment.shiftType) throw http(409, 'ATTENDANCE_SCHEDULE_STALE', 'Attendance Shift Type changed before event acceptance.');
    const existingSession = await client.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id } });
    const authority = await siteAuthority.resolve({ assignment, existingSession }, client);
    if (authority.site.id !== resolved.authority.securitySiteId) {
      throw http(409, 'ATTENDANCE_SITE_STALE', 'Attendance Security Site changed before event acceptance.');
    }
    const approval = await client.scheduleApproval.findFirst({
      where: { month: monthStart(assignment.workDate) },
      orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }]
    });
    if (!approval || approval.status !== 'APPROVED') throw http(409, 'ATTENDANCE_SCHEDULE_NOT_APPROVED', 'The monthly schedule is not currently approved.');
    const snapshot = buildExpectationSnapshot(assignment, approval, authority);
    return { assignment, approval, siteAuthority: authority, snapshot, digest: sha256Json(snapshot) };
  }

  function assertExistingSession(session, resolved, expectation) {
    if (session.employeeId !== resolved.authority.employeeId
      || session.shiftAssignmentId !== resolved.authority.shiftAssignmentId
      || session.expectedShiftTypeId !== expectation.assignment.shiftTypeId
      || session.expectedSiteId !== expectation.siteAuthority.site.id
      || session.expectationDigest !== expectation.digest) {
      throw http(409, 'ATTENDANCE_SESSION_STALE', 'Attendance session expectation changed.');
    }
    return session;
  }

  async function sessionForEvent(client, resolved, expectation, intent, now) {
    let session = await client.attendanceSession.findUnique({ where: { shiftAssignmentId: resolved.authority.shiftAssignmentId } });
    if (!session) {
      if (intent !== 'CHECK_IN') throw http(409, 'ATTENDANCE_CHECK_IN_REQUIRED', 'CHECK_IN is required before CHECK_OUT.');
      session = await client.attendanceSession.create({
        data: {
          employeeId: resolved.authority.employeeId,
          shiftAssignmentId: expectation.assignment.id,
          expectedShiftTypeId: expectation.assignment.shiftTypeId,
          expectedSiteId: expectation.siteAuthority.site.id,
          workDate: expectation.assignment.workDate,
          expectationSnapshot: expectation.snapshot,
          expectationDigest: expectation.digest,
          state: 'OPEN',
          openedAt: now
        }
      });
    } else {
      assertExistingSession(session, resolved, expectation);
    }
    if (session.state !== 'OPEN' || session.closedAt) throw http(409, 'ATTENDANCE_SESSION_CLOSED', 'Attendance session is already closed.');
    return session;
  }

  async function existingCapture(client, identity, captureId, intent, attendanceContext) {
    const row = await client.attendanceEvent.findUnique({ where: { captureId }, include: { session: true } });
    if (!row) return null;
    if (row.session.employeeId !== identity.employeeId
      || row.session.shiftAssignmentId !== attendanceContext?.shiftAssignmentId
      || row.eventType !== intent) {
      throw http(409, 'ATTENDANCE_CAPTURE_ID_CONFLICT', 'captureId already belongs to a different Attendance event.');
    }
    return { event: safeEvent(row), session: safeSession(row.session), idempotent: true };
  }

  async function acceptVerifiedEvent({ actor, receipt, attendanceContext }) {
    const captureId = normalizedUuid(attendanceContext?.captureId, 'ATTENDANCE_CAPTURE_ID_INVALID');
    const intent = eventIntent(attendanceContext?.eventIntent);
    try {
      return await prisma.$transaction(async (tx) => {
        const identity = await actorIdentity(tx, actor);
        const existing = await existingCapture(tx, identity, captureId, intent, attendanceContext);
        if (existing) return existing;

        const resolved = await verificationContext.resolveContextRef({ actor, ref: attendanceContext }, tx);
        if (resolved.authority.employeeId !== identity.employeeId) throw http(409, 'ATTENDANCE_CONTEXT_STALE', 'Attendance identity changed before event acceptance.');
        const expectation = await loadExpectation(tx, resolved);
        const now = clock();
        const session = await sessionForEvent(tx, resolved, expectation, intent, now);

        const sameType = await tx.attendanceEvent.findUnique({ where: { sessionId_eventType: { sessionId: session.id, eventType: intent } } });
        if (sameType) throw http(409, intent === 'CHECK_IN' ? 'ATTENDANCE_ALREADY_CHECKED_IN' : 'ATTENDANCE_ALREADY_CHECKED_OUT', `${intent} already exists for this Attendance session.`);
        if (intent === 'CHECK_OUT') {
          const checkedIn = await tx.attendanceEvent.findUnique({ where: { sessionId_eventType: { sessionId: session.id, eventType: 'CHECK_IN' } } });
          if (!checkedIn) throw http(409, 'ATTENDANCE_CHECK_IN_REQUIRED', 'CHECK_IN is required before CHECK_OUT.');
        }

        const consumed = await verificationContext.consumeVerificationInTransaction({ tx, actor, receipt, attendanceContext });
        if (consumed.employeeId !== identity.employeeId || consumed.contextDigest !== resolved.contextDigest) {
          throw http(409, 'ATTENDANCE_CONTEXT_STALE', 'Verification receipt changed before Attendance acceptance.');
        }

        const event = await tx.attendanceEvent.create({
          data: {
            sessionId: session.id,
            faceVerificationSessionId: consumed.sessionId,
            captureId,
            eventType: intent,
            provenance: 'ONLINE',
            receivedAt: now,
            effectiveEventAt: now,
            timeBasis: 'SERVER_RECEIVED',
            contextDigest: consumed.contextDigest,
            locationEvidence: resolved.contextRef.evidence,
            verificationSnapshot: {
              faceVerificationSessionId: consumed.sessionId,
              deviceEnrollmentId: consumed.deviceEnrollmentId,
              referencePhotoId: consumed.referencePhotoId,
              verifiedAt: consumed.verifiedAt ? new Date(consumed.verifiedAt).toISOString() : null,
              provider: consumed.provider || null,
              policyProfileId: consumed.policyProfileId || null,
              engineVersion: consumed.engineVersion || null
            }
          }
        });

        let finalSession = session;
        if (intent === 'CHECK_OUT') {
          finalSession = await tx.attendanceSession.update({ where: { id: session.id }, data: { state: 'CLOSED', closedAt: now } });
        }

        await audit.log({
          actorUserId: identity.userId,
          action: 'CREATE',
          entityType: 'AttendanceEvent',
          entityId: event.id,
          metadata: {
            sessionId: session.id,
            shiftAssignmentId: session.shiftAssignmentId,
            eventType: intent,
            timeBasis: 'SERVER_RECEIVED',
            securitySiteId: session.expectedSiteId,
            verificationSessionId: consumed.sessionId
          }
        }, tx);

        return { event: safeEvent(event), session: safeSession(finalSession), idempotent: false };
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        const identity = await actorIdentity(prisma, actor);
        const existing = await existingCapture(prisma, identity, captureId, intent, attendanceContext).catch(() => null);
        if (existing) return existing;
        throw http(409, 'ATTENDANCE_EVENT_CONFLICT', 'Attendance event state changed. Please refresh and retry.');
      }
      throw error;
    }
  }

  return { acceptVerifiedEvent };
}

module.exports = {
  buildExpectationSnapshot,
  sha256Json,
  createAttendanceEventService
};
