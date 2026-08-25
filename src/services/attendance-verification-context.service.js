'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createFaceVerificationSessionService } = require('./face-verification-session.service');
const { createAttendanceSiteEvidenceService } = require('./attendance-site-evidence.service');
const { createSecuritySiteAuthorityService } = require('./security-site-authority.service');

const CONTEXT_VERSION = 'ATTENDANCE_FACE_CONTEXT_V1';
const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const EVENT_INTENTS = new Set(['CHECK_IN', 'CHECK_OUT']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedUuid(value, code) {
  const text = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(text)) throw http(400, code, 'A valid UUID is required.');
  return text;
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw http(400, 'ATTENDANCE_CONTEXT_INVALID', 'Attendance context contains an invalid number.');
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
  throw http(400, 'ATTENDANCE_CONTEXT_INVALID', 'Attendance context contains an unsupported value.');
}

function buildAttendanceContextDigest(payload) {
  const canonical = JSON.stringify(canonicalize(payload));
  return sha256(Buffer.from(canonical, 'utf8'));
}

function bangkokParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute'))
  };
}

function shiftDate(dateText, offsetDays) {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function workDateText(value) {
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function timeMinutes(value) {
  const text = String(value || '');
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function assignmentTimes(assignment) {
  return {
    startTime: assignment.startTime || assignment.shiftType?.startTime || null,
    endTime: assignment.endTime || assignment.shiftType?.endTime || null
  };
}

function isOvernightAssignment(assignment) {
  const { startTime, endTime } = assignmentTimes(assignment);
  const start = timeMinutes(startTime);
  const end = timeMinutes(endTime);
  return start !== null && end !== null && end <= start;
}

function actionableAssignment(assignment) {
  const code = String(assignment?.shiftType?.code || '').trim().toUpperCase();
  const { startTime, endTime } = assignmentTimes(assignment || {});
  return Boolean(assignment && assignment.locked === true && !['OFF', 'AL'].includes(code) && timeMinutes(startTime) !== null && timeMinutes(endTime) !== null);
}

function scheduleMonth(workDate) {
  return new Date(`${workDate.slice(0, 7)}-01T00:00:00.000Z`);
}

function createAttendanceVerificationContextService({
  prisma = prismaDefault,
  faceSessionService = null,
  siteEvidenceService = null,
  siteAuthorityService = null,
  clock = () => new Date()
} = {}) {
  const face = faceSessionService || createFaceVerificationSessionService({ prisma, clock });
  const siteEvidence = siteEvidenceService || createAttendanceSiteEvidenceService({ prisma, clock });
  const siteAuthority = siteAuthorityService || createSecuritySiteAuthorityService({ prisma });

  async function resolveIdentity(client, actor) {
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
    if (!user?.employeeId || !user.employee) throw http(403, 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED', 'A linked employee account is required.');
    if (!user.isActive || user.accountStatus !== 'ACTIVE' || !user.employee.isActive || user.employee.deletedAt) {
      throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot prepare Attendance verification.');
    }
    return { userId: user.id, employeeId: user.employee.id };
  }

  async function resolveBiometricAuthority(client, employeeId) {
    const [devices, photos] = await Promise.all([
      client.attendanceDeviceEnrollment.findMany({ where: { employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' }, take: 2 }),
      client.employeeReferencePhoto.findMany({ where: { employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' }, take: 2 })
    ]);
    if (devices.length !== 1) throw http(409, devices.length ? 'ATTENDANCE_DEVICE_AUTHORITY_CONFLICT' : 'ATTENDANCE_DEVICE_REQUIRED', devices.length ? 'Attendance device authority is inconsistent.' : 'An active Attendance device is required.');
    if (photos.length !== 1) throw http(409, photos.length ? 'FACE_REFERENCE_AUTHORITY_CONFLICT' : 'FACE_REFERENCE_REQUIRED', photos.length ? 'Reference Photo authority is inconsistent.' : 'An active Employee Reference Photo is required.');
    if (photos[0].storageDeletedAt || photos[0].storageDeletionRequestedAt) throw http(409, 'FACE_REFERENCE_STALE', 'The active Reference Photo is not available for Attendance verification.');
    return { device: devices[0], referencePhoto: photos[0] };
  }

  async function requireApprovedSchedule(client, assignment) {
    if (!actionableAssignment(assignment)) throw http(409, 'ATTENDANCE_SHIFT_NOT_ACTIONABLE', 'The current shift is not eligible for Attendance verification.');
    const workDate = workDateText(assignment.workDate);
    const approval = await client.scheduleApproval.findFirst({
      where: { month: scheduleMonth(workDate) },
      orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }]
    });
    if (!approval || approval.status !== 'APPROVED') throw http(409, 'ATTENDANCE_SCHEDULE_NOT_APPROVED', 'The monthly schedule is not approved for Attendance verification.');
    return approval;
  }

  async function resolveCurrentAssignment(client, employeeId, now) {
    const local = bangkokParts(now);
    const yesterday = shiftDate(local.date, -1);
    const rows = await client.shiftAssignment.findMany({
      where: {
        employeeId,
        workDate: { in: [new Date(`${yesterday}T00:00:00.000Z`), new Date(`${local.date}T00:00:00.000Z`)] }
      },
      include: { shiftType: true, securitySite: true },
      orderBy: { workDate: 'asc' }
    });
    const byDate = new Map(rows.map((row) => [workDateText(row.workDate), row]));
    const previous = byDate.get(yesterday);
    const today = byDate.get(local.date);
    if (previous && isOvernightAssignment(previous)) {
      const end = timeMinutes(assignmentTimes(previous).endTime);
      if (end !== null && local.minutes < end) return previous;
    }
    if (today) return today;
    throw http(409, 'ATTENDANCE_ASSIGNMENT_REQUIRED', 'No authoritative Shift Assignment is available for Attendance verification.');
  }

  async function resolveEventIntent({ actor }, client = prisma) {
    const identity = await resolveIdentity(client, actor);
    const assignment = await resolveCurrentAssignment(client, identity.employeeId, clock());
    await requireApprovedSchedule(client, assignment);
    const session = await client.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id } });
    if (!session) {
      return { eventIntent: 'CHECK_IN', shiftAssignmentId: assignment.id, workDate: workDateText(assignment.workDate) };
    }
    if (session.employeeId !== identity.employeeId || session.shiftAssignmentId !== assignment.id) {
      throw http(409, 'ATTENDANCE_SESSION_STALE', 'Attendance session no longer matches the authoritative Shift Assignment.');
    }
    const events = await client.attendanceEvent.findMany({
      where: { sessionId: session.id, eventType: { in: ['CHECK_IN', 'CHECK_OUT'] } },
      select: { eventType: true }
    });
    const hasCheckIn = events.some((row) => row.eventType === 'CHECK_IN');
    const hasCheckOut = events.some((row) => row.eventType === 'CHECK_OUT');
    if (hasCheckOut) throw http(409, 'ATTENDANCE_ALREADY_CHECKED_OUT', 'Attendance is already complete for the current Shift Assignment.');
    if (session.state === 'CLOSED' || session.closedAt) throw http(409, 'ATTENDANCE_SESSION_INCONSISTENT', 'Attendance session state is inconsistent.');
    if (!hasCheckIn) throw http(409, 'ATTENDANCE_SESSION_INCONSISTENT', 'Attendance session is missing its committed CHECK_IN event.');
    return { eventIntent: 'CHECK_OUT', shiftAssignmentId: assignment.id, workDate: workDateText(assignment.workDate) };
  }

  async function loadExactAssignment(client, employeeId, shiftAssignmentId) {
    const id = normalizedUuid(shiftAssignmentId, 'ATTENDANCE_SHIFT_ASSIGNMENT_INVALID');
    const assignment = await client.shiftAssignment.findUnique({ where: { id }, include: { shiftType: true, securitySite: true } });
    if (!assignment || assignment.employeeId !== employeeId) throw http(409, 'ATTENDANCE_ASSIGNMENT_STALE', 'Attendance Shift Assignment changed or is no longer authoritative.');
    return assignment;
  }

  function contextPayload({ identity, binding, assignment, approval, captureId, eventIntent, evidence }) {
    const { startTime, endTime } = assignmentTimes(assignment);
    return {
      version: CONTEXT_VERSION,
      purpose: 'ATTENDANCE_EVENT',
      provenance: 'ONLINE',
      captureId,
      eventIntent,
      identity: { userId: identity.userId, employeeId: identity.employeeId },
      device: { enrollmentId: binding.device.id, credentialFingerprint: binding.device.credentialFingerprint },
      referencePhoto: { id: binding.referencePhoto.id, checksum: binding.referencePhoto.checksum },
      schedule: {
        shiftAssignmentId: assignment.id,
        workDate: workDateText(assignment.workDate),
        shiftTypeId: assignment.shiftTypeId,
        shiftCode: assignment.shiftType?.code || null,
        startTime,
        endTime,
        hours: assignment.hours == null ? null : String(assignment.hours),
        approvalId: approval.id,
        approvalRevision: approval.revision
      },
      evidence
    };
  }

  function contextRef({ captureId, eventIntent, assignment, evidenceRef }) {
    return { captureId, eventIntent, shiftAssignmentId: assignment.id, evidence: evidenceRef };
  }

  async function validatedSiteEvidence(client, assignment, attendanceEvidence, existingSession) {
    const authority = await siteAuthority.resolve({ assignment, existingSession }, client);
    const evidenceAssignment = { ...assignment, securitySiteId: authority.site.id, securitySite: authority.site };
    const validated = await siteEvidence.validateForAssignment({
      assignment: evidenceAssignment,
      qrToken: attendanceEvidence?.qrToken,
      location: attendanceEvidence?.location
    }, client);
    return { authority, validated };
  }

  async function revalidatedSiteEvidence(client, assignment, ref, existingSession) {
    const authority = await siteAuthority.resolve({ assignment, existingSession }, client);
    const validated = await siteEvidence.revalidateRef({ ref: ref?.evidence }, client);
    if (authority.site.id !== validated.evidenceRef.siteId) throw http(409, 'ATTENDANCE_SITE_STALE', 'Attendance Security Site authority changed.');
    return { authority, validated };
  }

  async function prepareContext({ actor, captureId, eventIntent, attendanceEvidence }, client = prisma) {
    const normalizedCaptureId = normalizedUuid(captureId, 'ATTENDANCE_CAPTURE_ID_INVALID');
    const action = String(eventIntent || '').trim().toUpperCase();
    if (!EVENT_INTENTS.has(action)) throw http(400, 'ATTENDANCE_EVENT_INTENT_INVALID', 'Attendance event intent must be CHECK_IN or CHECK_OUT.');
    const identity = await resolveIdentity(client, actor);
    const binding = await resolveBiometricAuthority(client, identity.employeeId);
    const assignment = await resolveCurrentAssignment(client, identity.employeeId, clock());
    const approval = await requireApprovedSchedule(client, assignment);
    const existingSession = await client.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id } });
    const { authority: site, validated } = await validatedSiteEvidence(client, assignment, attendanceEvidence, existingSession);
    const evidence = { siteBindingDigest: validated.siteBindingDigest, qrBindingDigest: validated.qrBindingDigest, locationBindingDigest: validated.locationBindingDigest };
    const payload = contextPayload({ identity, binding, assignment, approval, captureId: normalizedCaptureId, eventIntent: action, evidence });
    return {
      contextDigest: buildAttendanceContextDigest(payload),
      contextRef: contextRef({ captureId: normalizedCaptureId, eventIntent: action, assignment, evidenceRef: validated.evidenceRef }),
      authority: {
        userId: identity.userId,
        employeeId: identity.employeeId,
        deviceEnrollmentId: binding.device.id,
        referencePhotoId: binding.referencePhoto.id,
        shiftAssignmentId: assignment.id,
        securitySiteId: site.site.id,
        securitySiteAuthoritySource: site.source,
        workDate: workDateText(assignment.workDate)
      }
    };
  }

  async function resolveContextRef({ actor, ref }, client = prisma) {
    const captureId = normalizedUuid(ref?.captureId, 'ATTENDANCE_CAPTURE_ID_INVALID');
    const action = String(ref?.eventIntent || '').trim().toUpperCase();
    if (!EVENT_INTENTS.has(action)) throw http(400, 'ATTENDANCE_EVENT_INTENT_INVALID', 'Attendance event intent must be CHECK_IN or CHECK_OUT.');
    const identity = await resolveIdentity(client, actor);
    const binding = await resolveBiometricAuthority(client, identity.employeeId);
    const assignment = await loadExactAssignment(client, identity.employeeId, ref?.shiftAssignmentId);
    const approval = await requireApprovedSchedule(client, assignment);
    const existingSession = await client.attendanceSession.findUnique({ where: { shiftAssignmentId: assignment.id } });
    const { authority: site, validated } = await revalidatedSiteEvidence(client, assignment, ref, existingSession);
    const evidence = { siteBindingDigest: validated.siteBindingDigest, qrBindingDigest: validated.qrBindingDigest, locationBindingDigest: validated.locationBindingDigest };
    const payload = contextPayload({ identity, binding, assignment, approval, captureId, eventIntent: action, evidence });
    return {
      contextDigest: buildAttendanceContextDigest(payload),
      contextRef: contextRef({ captureId, eventIntent: action, assignment, evidenceRef: validated.evidenceRef }),
      authority: {
        userId: identity.userId,
        employeeId: identity.employeeId,
        deviceEnrollmentId: binding.device.id,
        referencePhotoId: binding.referencePhoto.id,
        shiftAssignmentId: assignment.id,
        securitySiteId: site.site.id,
        securitySiteAuthoritySource: site.source,
        workDate: workDateText(assignment.workDate)
      }
    };
  }

  async function prepareVerification(input) {
    const prepared = await prepareContext(input);
    const created = await face.createSession({ actor: input.actor, purpose: 'ATTENDANCE_EVENT', contextDigest: prepared.contextDigest });
    const session = created.session;
    const matches = session.userId === prepared.authority.userId
      && session.employeeId === prepared.authority.employeeId
      && session.deviceEnrollmentId === prepared.authority.deviceEnrollmentId
      && session.referencePhotoId === prepared.authority.referencePhotoId
      && session.contextDigest === prepared.contextDigest;
    if (!matches) {
      await face.failSession(session.id, 'ATTENDANCE_CONTEXT_STALE').catch(() => {});
      throw http(409, 'ATTENDANCE_CONTEXT_STALE', 'Attendance authority changed while preparing face verification.');
    }
    return { ...created, attendanceContext: prepared.contextRef };
  }

  function expectedReceipt(resolved) {
    return {
      employeeId: resolved.authority.employeeId,
      userId: resolved.authority.userId,
      deviceEnrollmentId: resolved.authority.deviceEnrollmentId,
      referencePhotoId: resolved.authority.referencePhotoId,
      purpose: 'ATTENDANCE_EVENT',
      contextDigest: resolved.contextDigest
    };
  }

  async function consumeVerification({ actor, receipt, attendanceContext }) {
    const resolved = await resolveContextRef({ actor, ref: attendanceContext });
    return face.consumeReceipt({ receipt, expected: expectedReceipt(resolved) });
  }

  async function consumeVerificationInTransaction({ tx, actor, receipt, attendanceContext }) {
    if (!tx) throw http(500, 'ATTENDANCE_TRANSACTION_REQUIRED', 'Attendance receipt consumption requires an existing transaction.');
    if (typeof face.consumeReceiptInTransaction !== 'function') throw http(500, 'ATTENDANCE_RECEIPT_CONSUMER_UNAVAILABLE', 'Transaction-aware receipt consumption is unavailable.');
    const resolved = await resolveContextRef({ actor, ref: attendanceContext }, tx);
    return face.consumeReceiptInTransaction({ tx, receipt, expected: expectedReceipt(resolved) });
  }

  return {
    prepareContext,
    resolveEventIntent,
    resolveContextRef,
    prepareVerification,
    consumeVerification,
    consumeVerificationInTransaction
  };
}

module.exports = {
  CONTEXT_VERSION,
  BANGKOK_TIME_ZONE,
  EVENT_INTENTS,
  buildAttendanceContextDigest,
  bangkokParts,
  isOvernightAssignment,
  actionableAssignment,
  createAttendanceVerificationContextService
};
