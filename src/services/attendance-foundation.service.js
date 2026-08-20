const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const audit = require('./audit.service');

function dateAtTime(workDate, time) {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const date = new Date(workDate);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes));
}

function isOvernightShift(shiftType, startTime, endTime) {
  if (shiftType?.isOvernight) return true;
  return Boolean(startTime && endTime && endTime <= startTime);
}

function buildExpectationSnapshot({ shiftAssignment, shiftType, securitySite = null, duty = null }) {
  const startTime = shiftAssignment.startTime || shiftType?.startTime || null;
  const endTime = shiftAssignment.endTime || shiftType?.endTime || null;
  const expectedStartAt = dateAtTime(shiftAssignment.workDate, startTime);
  let expectedEndAt = dateAtTime(shiftAssignment.workDate, endTime);
  const overnight = isOvernightShift(shiftType, startTime, endTime);
  if (expectedEndAt && overnight) expectedEndAt.setUTCDate(expectedEndAt.getUTCDate() + 1);
  return {
    workDate: new Date(shiftAssignment.workDate).toISOString().slice(0, 10),
    sourceShiftAssignmentId: shiftAssignment.id,
    expectedShiftId: shiftType?.id || shiftAssignment.shiftTypeId,
    expectedShiftCode: shiftType?.code || null,
    expectedShiftName: shiftType?.name || null,
    expectedStartAt: expectedStartAt?.toISOString() || null,
    expectedEndAt: expectedEndAt?.toISOString() || null,
    expectedSiteId: securitySite?.id || shiftAssignment.securitySiteId || null,
    expectedSiteCode: securitySite?.code || null,
    expectedSiteName: securitySite?.name || null,
    expectedSiteLatitude: securitySite?.latitude?.toString?.() || null,
    expectedSiteLongitude: securitySite?.longitude?.toString?.() || null,
    expectedGeofenceRadiusMeters: securitySite?.geofenceRadiusMeters || null,
    expectedDutyId: duty?.id || shiftAssignment.dutyId || null,
    expectedDutyCode: duty?.code || null,
    expectedDutyName: duty?.name || null,
    overnight
  };
}

function createAttendanceFoundationService({ prismaClient = prisma, auditService = audit, clock = () => new Date() } = {}) {
  async function createSessionFromShiftAssignment({ shiftAssignmentId, actorUserId = null }) {
    return prismaClient.$transaction(async (tx) => {
      const source = await tx.shiftAssignment.findUnique({ where: { id: shiftAssignmentId }, include: { shiftType: true, securitySite: true, duty: true } });
      if (!source) throw new HttpError(404, 'Shift Assignment not found.');
      const existing = await tx.attendanceSession.findUnique({ where: { shiftAssignmentId } });
      if (existing) return { session: existing, idempotent: true };
      const expectationSnapshot = buildExpectationSnapshot({ shiftAssignment: source, shiftType: source.shiftType, securitySite: source.securitySite, duty: source.duty });
      const session = await tx.attendanceSession.create({ data: { employeeId: source.employeeId, shiftAssignmentId: source.id, expectedShiftTypeId: source.shiftTypeId, expectedSiteId: source.securitySiteId, expectedDutyId: source.dutyId, workDate: source.workDate, expectationSnapshot, sourceScheduleSnapshot: { shiftAssignmentId: source.id, source: source.source || null } } });
      await auditService.log({ actorUserId, action: 'CREATE', entityType: 'AttendanceSession', entityId: session.id, metadata: { workDate: expectationSnapshot.workDate, sourceShiftAssignmentId: source.id } }, tx);
      return { session, idempotent: false };
    });
  }

  async function recordEvent({ sessionId, captureId, eventType, provenance, capturedAt, actorUserId = null, locationEvidence = null, offlineContext = null, deviceContext = null }) {
    if (!captureId || !String(captureId).trim()) throw new HttpError(400, 'captureId is required.', { code: 'ATTENDANCE_CAPTURE_ID_REQUIRED' });
    return prismaClient.$transaction(async (tx) => {
      const existing = await tx.attendanceEvent.findUnique({ where: { captureId } });
      if (existing) {
        if (existing.sessionId === sessionId && existing.eventType === eventType && existing.provenance === provenance) return { event: existing, idempotent: true };
        throw new HttpError(409, 'captureId conflicts with a different attendance event.', { code: 'ATTENDANCE_CAPTURE_ID_CONFLICT' });
      }
      const receivedAt = clock();
      const event = await tx.attendanceEvent.create({ data: { sessionId, captureId, eventType, provenance, capturedAt: new Date(capturedAt), receivedAt, effectiveEventAt: provenance === 'ONLINE' ? receivedAt : new Date(capturedAt), timeBasis: provenance === 'ONLINE' ? 'SERVER_RECEIVED' : 'DEVICE_CAPTURED', locationEvidence, offlineContext, deviceContext } });
      await auditService.log({ actorUserId, action: 'CREATE', entityType: 'AttendanceEvent', entityId: event.id, metadata: { sessionId, eventType, provenance, timeBasis: event.timeBasis } }, tx);
      return { event, idempotent: false };
    });
  }

  async function appendCorrection({ sessionId, eventId = null, correctionType, previousValue = null, correctedValue, reason, actorUserId, actorRole }) {
    if (!['ADMIN', 'MANAGER'].includes(actorRole)) throw new HttpError(403, 'Only a Manager or Admin may correct attendance.', { code: 'ATTENDANCE_CORRECTION_FORBIDDEN' });
    if (!reason || !String(reason).trim()) throw new HttpError(400, 'Correction reason is required.', { code: 'ATTENDANCE_CORRECTION_REASON_REQUIRED' });
    if (!actorUserId) throw new HttpError(400, 'Correction actor is required.', { code: 'ATTENDANCE_CORRECTION_ACTOR_REQUIRED' });
    return prismaClient.$transaction(async (tx) => {
      const correction = await tx.attendanceCorrection.create({ data: { sessionId, eventId, correctionType, previousValue, correctedValue, reason: String(reason).trim(), actorUserId, actorRole } });
      await tx.attendanceBusinessFlagRecord.create({ data: { sessionId, flag: 'CORRECTED', source: 'ATTENDANCE_CORRECTION' } }).catch((error) => { if (error.code !== 'P2002') throw error; });
      await auditService.log({ actorUserId, action: 'UPDATE', entityType: 'AttendanceCorrection', entityId: correction.id, metadata: { sessionId, eventId, correctionType } }, tx);
      return correction;
    });
  }

  async function certifyMonth({ month, actorUserId, snapshotHash = null, snapshotReference = null }) {
    const period = new Date(month);
    const nextPeriod = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
    const monthStart = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1));
    return prismaClient.$transaction(async (tx) => {
      const unresolved = await tx.attendanceRiskReview.count({ where: { state: 'REVIEW_REQUIRED', session: { workDate: { gte: monthStart, lt: nextPeriod } } } });
      if (unresolved) throw new HttpError(409, 'Unresolved attendance reviews block certification.', { code: 'ATTENDANCE_CERTIFICATION_REVIEW_REQUIRED' });
      const latest = await tx.attendanceMonthCertification.findFirst({ where: { month: monthStart }, orderBy: { revision: 'desc' } });
      const certification = await tx.attendanceMonthCertification.create({ data: { month: monthStart, revision: (latest?.revision || 0) + 1, status: 'LOCKED', certifiedByUserId: actorUserId, certifiedAt: clock(), lockedAt: clock(), snapshotHash, snapshotReference } });
      await auditService.log({ actorUserId, action: 'CREATE', entityType: 'AttendanceMonthCertification', entityId: certification.id, metadata: { month: monthStart.toISOString().slice(0, 7), revision: certification.revision, status: certification.status } }, tx);
      return certification;
    });
  }

  return { appendCorrection, buildExpectationSnapshot, certifyMonth, createSessionFromShiftAssignment, recordEvent };
}

module.exports = { buildExpectationSnapshot, createAttendanceFoundationService, dateAtTime, isOvernightShift };
