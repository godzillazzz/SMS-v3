'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createSecuritySiteAuthorityService } = require('./security-site-authority.service');
const { classifyAttendanceDay, ATTENDANCE_RESULT_FLAGS } = require('./attendance-result.service');
const { currentCorrectionsForSessions, applyCurrentCorrections } = require('./attendance-correction.service');

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const EMPTY_ID = '00000000-0000-0000-0000-000000000000';

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function bangkokDateText(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseDateText(value, fallback = new Date()) {
  const text = value == null || value === '' ? bangkokDateText(fallback) : String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw http(400, 'ATTENDANCE_DASHBOARD_DATE_INVALID', 'Attendance dashboard date is invalid.');
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw http(400, 'ATTENDANCE_DASHBOARD_DATE_INVALID', 'Attendance dashboard date is invalid.');
  }
  return { text, date };
}

function scopeForActor(actor, filters = {}) {
  const role = String(actor?.role || '').toUpperCase();
  if (!['ADMIN', 'MANAGER'].includes(role)) throw http(403, 'ATTENDANCE_SUPERVISOR_FORBIDDEN', 'Attendance supervisor access requires Manager or Admin authority.');
  if (role === 'MANAGER') {
    const department = String(actor?.department || '').trim();
    if (!department) throw http(403, 'ATTENDANCE_SUPERVISOR_SCOPE_REQUIRED', 'Manager Attendance scope requires a Department.');
    if (filters.department && filters.department !== department) throw http(403, 'ATTENDANCE_SUPERVISOR_SCOPE_FORBIDDEN', 'Manager cannot access another Department Attendance scope.');
    return { role, department, employeeId: null };
  }
  return { role, department: filters.department || null, employeeId: filters.employeeId || null };
}

function eventByType(events, type) {
  return (events || []).find((row) => String(row?.eventType || '').toUpperCase() === type) || null;
}

function evidenceActualSiteId(events) {
  for (const event of events || []) {
    const evidence = event?.locationEvidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) continue;
    const value = evidence.actualSiteId || evidence.siteId || null;
    if (value) return String(value);
  }
  return null;
}

function extraFlags(events, expectedSiteId, corrections = []) {
  const flags = new Set();
  for (const event of events || []) {
    const evidence = event?.locationEvidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) continue;
    const actualSiteId = evidence.actualSiteId || evidence.siteId || null;
    if (actualSiteId && expectedSiteId && String(actualSiteId) !== String(expectedSiteId)) flags.add('ASSIST_OTHER_SITE');
    const riskFlags = Array.isArray(evidence.riskFlags) ? evidence.riskFlags : [];
    riskFlags.forEach((flag) => { if (typeof flag === 'string' && flag) flags.add(flag); });
  }
  if (corrections.length > 0) flags.add('CORRECTED');
  return [...flags];
}

function operationalStatus(result, allFlags) {
  if (result.status === 'LEAVE') return 'LEAVE';
  if (result.status === 'ABSENT') return 'ABSENT';
  if (allFlags.includes(ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL)) return 'TIME_ABNORMAL';
  if (allFlags.includes('OUTSIDE_ALL_SITES')) return 'OUTSIDE_ALL_SITES';
  if (allFlags.includes('WRONG_SHIFT')) return 'WRONG_SHIFT';
  if (allFlags.includes('ASSIST_OTHER_SITE')) return 'ASSIST_OTHER_SITE';
  if (result.status === 'COMPLETE' && allFlags.includes(ATTENDANCE_RESULT_FLAGS.EARLY_OUT)) return 'EARLY_OUT';
  if (result.status === 'COMPLETE') return 'COMPLETE';
  if (result.status === 'IN_PROGRESS' && allFlags.includes(ATTENDANCE_RESULT_FLAGS.LATE)) return 'LATE';
  if (result.status === 'IN_PROGRESS') return 'CURRENTLY_WORKING';
  if (result.status === 'SCHEDULED') return 'SCHEDULED';
  if (result.status === 'AWAITING_CHECK_IN') return 'NOT_CHECKED_IN_YET';
  return result.status;
}

function summaryFor(rows) {
  const count = (predicate) => rows.reduce((sum, row) => sum + (predicate(row) ? 1 : 0), 0);
  return {
    scheduledToday: rows.filter((row) => row.attendanceStatus !== 'NOT_ACTIONABLE').length,
    checkedIn: count((row) => Boolean(row.checkInAt)),
    currentlyWorking: count((row) => row.attendanceStatus === 'CURRENTLY_WORKING' || row.attendanceStatus === 'LATE' || (Boolean(row.checkInAt) && !row.checkOutAt)),
    notCheckedInYet: count((row) => row.attendanceStatus === 'NOT_CHECKED_IN_YET'),
    late: count((row) => row.flags.includes('LATE')),
    earlyOut: count((row) => row.flags.includes('EARLY_OUT')),
    wrongShift: count((row) => row.flags.includes('WRONG_SHIFT')),
    assistingOtherSite: count((row) => row.flags.includes('ASSIST_OTHER_SITE')),
    outsideAllSites: count((row) => row.flags.includes('OUTSIDE_ALL_SITES')),
    leave: count((row) => row.flags.includes('LEAVE')),
    absent: count((row) => row.flags.includes('ABSENT')),
    corrected: count((row) => row.flags.includes('CORRECTED')),
    timeAbnormal: count((row) => row.flags.includes('TIME_ABNORMAL') || row.flags.includes('MISSING_CHECK_OUT') || row.flags.includes('MISSING_CHECK_IN'))
  };
}

function createAttendanceSupervisorService({ prisma = prismaDefault, clock = () => new Date(), siteAuthorityService = null } = {}) {
  const siteAuthority = siteAuthorityService || createSecuritySiteAuthorityService({ prisma });

  async function daily({ actor, filters = {} } = {}, client = prisma) {
    const now = clock();
    const { text: dateText, date: workDate } = parseDateText(filters.date, now);
    const scope = scopeForActor(actor, filters);
    const employeeWhere = {
      isActive: true,
      deletedAt: null,
      ...(scope.department ? { department: scope.department } : {}),
      ...(scope.employeeId ? { id: scope.employeeId } : {})
    };
    if (filters.employeeId && scope.role === 'MANAGER') employeeWhere.id = filters.employeeId;

    const assignments = await client.shiftAssignment.findMany({
      where: {
        workDate,
        employee: { is: employeeWhere },
        ...(filters.shiftTypeId ? { shiftTypeId: filters.shiftTypeId } : {})
      },
      include: {
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true } },
        shiftType: true,
        securitySite: true,
        attendanceSession: {
          include: {
            expectedSite: { select: { id: true, code: true, name: true } },
            events: { orderBy: { effectiveEventAt: 'asc' } }
          }
        }
      },
      orderBy: [{ departmentSnapshot: 'asc' }, { employeeNameSnapshot: 'asc' }]
    });

    const employeeIds = [...new Set(assignments.map((row) => row.employeeId))];
    const sessionIds = assignments.map((row) => row.attendanceSession?.id).filter(Boolean);
    const [leaves, currentCorrections] = await Promise.all([
      employeeIds.length ? client.leaveRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'APPROVED',
          startDate: { lte: workDate },
          endDate: { gte: workDate }
        },
        select: { employeeId: true }
      }) : [],
      typeof client.$queryRaw === 'function' ? currentCorrectionsForSessions(client, sessionIds) : []
    ]);
    const leaveIds = new Set(leaves.map((row) => row.employeeId));
    const correctionsBySession = new Map();
    for (const correction of currentCorrections) {
      const list = correctionsBySession.get(correction.attendanceSessionId) || [];
      list.push(correction);
      correctionsBySession.set(correction.attendanceSessionId, list);
    }

    const rows = [];
    for (const assignment of assignments) {
      const session = assignment.attendanceSession || null;
      const rawEvents = session?.events || [];
      const corrections = session ? (correctionsBySession.get(session.id) || []) : [];
      const events = applyCurrentCorrections(rawEvents, corrections);
      let expectedSite = session?.expectedSite || assignment.securitySite || null;
      if (!expectedSite) {
        try { expectedSite = (await siteAuthority.resolve({ assignment, existingSession: session }, client)).site; }
        catch { expectedSite = null; }
      }
      const result = classifyAttendanceDay({ assignment, events, approvedLeave: leaveIds.has(assignment.employeeId), asOf: now });
      const derived = extraFlags(rawEvents, expectedSite?.id || null, corrections);
      const flags = [...new Set([...result.flags, ...derived])];
      const actualSiteId = evidenceActualSiteId(rawEvents);
      let actualSite = null;
      if (actualSiteId) {
        if (expectedSite?.id === actualSiteId) actualSite = expectedSite;
        else actualSite = await client.securitySite.findUnique({ where: { id: actualSiteId }, select: { id: true, code: true, name: true } }).catch(() => null);
      }
      const attendanceStatus = operationalStatus(result, flags);
      const originalCheckIn = eventByType(rawEvents, 'CHECK_IN');
      const originalCheckOut = eventByType(rawEvents, 'CHECK_OUT');
      rows.push({
        date: dateText,
        assignmentId: assignment.id,
        sessionId: session?.id || null,
        employeeId: assignment.employeeId,
        employeeCode: assignment.employee?.employeeCode || null,
        employeeName: assignment.employeeNameSnapshot || assignment.employee?.displayName || `${assignment.employee?.firstName || ''} ${assignment.employee?.lastName || ''}`.trim(),
        department: assignment.departmentSnapshot || assignment.employee?.department || null,
        expectedSite: expectedSite ? { id: expectedSite.id, code: expectedSite.code, name: expectedSite.name } : null,
        actualSite: actualSite ? { id: actualSite.id, code: actualSite.code, name: actualSite.name } : null,
        shift: { id: assignment.shiftTypeId, code: assignment.shiftType?.code || null, name: assignment.shiftType?.name || null },
        expectedStartAt: result.expectedStartAt,
        expectedEndAt: result.expectedEndAt,
        originalCheckInAt: originalCheckIn?.effectiveEventAt || null,
        originalCheckOutAt: originalCheckOut?.effectiveEventAt || null,
        checkInAt: result.checkInAt,
        checkOutAt: result.checkOutAt,
        workedMinutes: result.workedMinutes,
        corrections,
        attendanceStatus,
        flags
      });
    }

    const filtered = rows.filter((row) => {
      if (filters.siteId && row.expectedSite?.id !== filters.siteId && row.actualSite?.id !== filters.siteId) return false;
      if (filters.status && row.attendanceStatus !== filters.status && !row.flags.includes(filters.status)) return false;
      if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
      return true;
    });

    return {
      date: dateText,
      generatedAt: now,
      scope: { role: scope.role, department: scope.department },
      summary: summaryFor(filtered),
      rows: filtered
    };
  }

  return { daily };
}

module.exports = {
  BANGKOK_TIME_ZONE,
  bangkokDateText,
  parseDateText,
  scopeForActor,
  operationalStatus,
  summaryFor,
  createAttendanceSupervisorService,
  EMPTY_ID
};
