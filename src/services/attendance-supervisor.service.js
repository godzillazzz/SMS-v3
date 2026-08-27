'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createSecuritySiteAuthorityService } = require('./security-site-authority.service');
const { classifyAttendanceDay, ATTENDANCE_RESULT_FLAGS } = require('./attendance-result.service');
const { currentCorrectionsForAssignments, applyCurrentCorrections } = require('./attendance-correction.service');

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const EMPTY_ID = '00000000-0000-0000-0000-000000000000';
const MAX_HISTORY_DAYS = 62;

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

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseHistoryRange(filters = {}, fallback = new Date()) {
  const today = parseDateText(null, fallback);
  const defaultFrom = addUtcDays(today.date, -30).toISOString().slice(0, 10);
  const from = parseDateText(filters.from || defaultFrom, fallback);
  const to = parseDateText(filters.to || today.text, fallback);
  if (from.date > to.date) throw http(400, 'ATTENDANCE_HISTORY_RANGE_INVALID', 'Attendance history start date must not be after end date.');
  const days = Math.round((to.date.getTime() - from.date.getTime()) / 86400000) + 1;
  if (days > MAX_HISTORY_DAYS) throw http(400, 'ATTENDANCE_HISTORY_RANGE_TOO_LARGE', `Attendance history range must not exceed ${MAX_HISTORY_DAYS} days.`);
  return { from, to, days };
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

function assignmentInclude() {
  return {
    employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true } },
    shiftType: true,
    securitySite: true,
    attendanceSession: {
      include: {
        expectedSite: { select: { id: true, code: true, name: true } },
        events: { orderBy: { effectiveEventAt: 'asc' } }
      }
    }
  };
}

function employeeScopeWhere(scope, filters) {
  const where = {
    isActive: true,
    deletedAt: null,
    ...(scope.department ? { department: scope.department } : {}),
    ...(scope.employeeId ? { id: scope.employeeId } : {})
  };
  if (filters.employeeId && scope.role === 'MANAGER') where.id = filters.employeeId;
  return where;
}

function pagination(filters = {}) {
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize || 50)));
  return { page, pageSize };
}

function createAttendanceSupervisorService({ prisma = prismaDefault, clock = () => new Date(), siteAuthorityService = null } = {}) {
  const siteAuthority = siteAuthorityService || createSecuritySiteAuthorityService({ prisma });

  async function correctionsMap(client, assignmentIds) {
    const currentCorrections = typeof client.$queryRaw === 'function'
      ? await currentCorrectionsForAssignments(client, assignmentIds)
      : [];
    const map = new Map();
    for (const correction of currentCorrections) {
      const list = map.get(correction.shiftAssignmentId) || [];
      list.push(correction);
      map.set(correction.shiftAssignmentId, list);
    }
    return map;
  }

  async function leavesMap(client, assignments, rangeStart, rangeEnd) {
    const employeeIds = [...new Set(assignments.map((row) => row.employeeId))];
    if (!employeeIds.length) return [];
    return client.leaveRequest.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: 'APPROVED',
        startDate: { lte: rangeEnd },
        endDate: { gte: rangeStart }
      },
      select: { employeeId: true, startDate: true, endDate: true }
    });
  }

  function approvedLeaveFor(leaves, assignment) {
    const workTime = assignment.workDate.getTime();
    return leaves.some((leave) => leave.employeeId === assignment.employeeId
      && leave.startDate.getTime() <= workTime
      && leave.endDate.getTime() >= workTime);
  }

  async function buildRows({ assignments, leaves, correctionsByAssignment, asOf, filters, client }) {
    const rows = [];
    const actualSiteCache = new Map();

    for (const assignment of assignments) {
      const session = assignment.attendanceSession || null;
      const rawEvents = session?.events || [];
      const corrections = correctionsByAssignment.get(assignment.id) || [];
      const events = applyCurrentCorrections(rawEvents, corrections);
      let expectedSite = session?.expectedSite || assignment.securitySite || null;
      if (!expectedSite) {
        try { expectedSite = (await siteAuthority.resolve({ assignment, existingSession: session }, client)).site; }
        catch { expectedSite = null; }
      }

      const result = classifyAttendanceDay({
        assignment,
        events,
        approvedLeave: approvedLeaveFor(leaves, assignment),
        asOf
      });
      const derived = extraFlags(rawEvents, expectedSite?.id || null, corrections);
      const flags = [...new Set([...result.flags, ...derived])];
      const actualSiteId = evidenceActualSiteId(rawEvents);
      let actualSite = null;
      if (actualSiteId) {
        if (expectedSite?.id === actualSiteId) actualSite = expectedSite;
        else if (actualSiteCache.has(actualSiteId)) actualSite = actualSiteCache.get(actualSiteId);
        else {
          actualSite = await client.securitySite.findUnique({
            where: { id: actualSiteId },
            select: { id: true, code: true, name: true }
          }).catch(() => null);
          actualSiteCache.set(actualSiteId, actualSite);
        }
      }

      const originalCheckIn = eventByType(rawEvents, 'CHECK_IN');
      const originalCheckOut = eventByType(rawEvents, 'CHECK_OUT');
      rows.push({
        date: assignment.workDate.toISOString().slice(0, 10),
        assignmentId: assignment.id,
        sessionId: session?.id || null,
        employeeId: assignment.employeeId,
        employeeCode: assignment.employee?.employeeCode || null,
        employeeName: assignment.employeeNameSnapshot || assignment.employee?.displayName || `${assignment.employee?.firstName || ''} ${assignment.employee?.lastName || ''}`.trim(),
        department: assignment.departmentSnapshot || assignment.employee?.department || null,
        expectedSite: expectedSite ? { id: expectedSite.id, code: expectedSite.code, name: expectedSite.name } : null,
        actualSite: actualSite ? { id: actualSite.id, code: actualSite.code, name: actualSite.name } : null,
        shift: {
          id: assignment.shiftTypeId,
          code: assignment.shiftType?.code || null,
          name: assignment.shiftType?.name || null,
          startTime: assignment.startTime || assignment.shiftType?.startTime || null,
          endTime: assignment.endTime || assignment.shiftType?.endTime || null
        },
        expectedStartAt: result.expectedStartAt,
        expectedEndAt: result.expectedEndAt,
        originalCheckInAt: originalCheckIn?.effectiveEventAt || null,
        originalCheckOutAt: originalCheckOut?.effectiveEventAt || null,
        checkInAt: result.checkInAt,
        checkOutAt: result.checkOutAt,
        workedMinutes: result.workedMinutes,
        lateMinutes: result.lateMinutes,
        earlyOutMinutes: result.earlyOutMinutes,
        corrections,
        correctionAuthority: corrections.length ? 'LEGACY_CURRENT_CORRECTION_OVERLAY' : 'RAW_ATTENDANCE_EVENT',
        attendanceStatus: operationalStatus(result, flags),
        flags
      });
    }

    return rows.filter((row) => {
      if (filters.siteId && row.expectedSite?.id !== filters.siteId && row.actualSite?.id !== filters.siteId) return false;
      if (filters.status && row.attendanceStatus !== filters.status && !row.flags.includes(filters.status)) return false;
      if (filters.employeeId && row.employeeId !== filters.employeeId) return false;
      return true;
    });
  }

  async function daily({ actor, filters = {} } = {}, client = prisma) {
    const now = clock();
    const { text: dateText, date: workDate } = parseDateText(filters.date, now);
    const scope = scopeForActor(actor, filters);
    const assignments = await client.shiftAssignment.findMany({
      where: {
        workDate,
        employee: { is: employeeScopeWhere(scope, filters) },
        ...(filters.shiftTypeId ? { shiftTypeId: filters.shiftTypeId } : {})
      },
      include: assignmentInclude(),
      orderBy: [{ departmentSnapshot: 'asc' }, { employeeNameSnapshot: 'asc' }]
    });

    const [leaves, correctionsByAssignment] = await Promise.all([
      leavesMap(client, assignments, workDate, workDate),
      correctionsMap(client, assignments.map((row) => row.id))
    ]);
    const rows = await buildRows({ assignments, leaves, correctionsByAssignment, asOf: now, filters, client });

    return {
      date: dateText,
      generatedAt: now,
      scope: { role: scope.role, department: scope.department },
      summary: summaryFor(rows),
      rows
    };
  }

  async function history({ actor, filters = {} } = {}, client = prisma) {
    const now = clock();
    const range = parseHistoryRange(filters, now);
    const scope = scopeForActor(actor, filters);
    const { page, pageSize } = pagination(filters);

    const assignments = await client.shiftAssignment.findMany({
      where: {
        workDate: { gte: range.from.date, lte: range.to.date },
        employee: { is: employeeScopeWhere(scope, filters) },
        ...(filters.shiftTypeId ? { shiftTypeId: filters.shiftTypeId } : {})
      },
      include: assignmentInclude(),
      orderBy: [{ workDate: 'desc' }, { departmentSnapshot: 'asc' }, { employeeNameSnapshot: 'asc' }]
    });

    const [leaves, correctionsByAssignment] = await Promise.all([
      leavesMap(client, assignments, range.from.date, range.to.date),
      correctionsMap(client, assignments.map((row) => row.id))
    ]);
    const filtered = await buildRows({ assignments, leaves, correctionsByAssignment, asOf: now, filters, client });
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const rows = filtered.slice(start, start + pageSize);

    return {
      generatedAt: now,
      from: range.from.text,
      to: range.to.text,
      scope: { role: scope.role, department: scope.department },
      summary: summaryFor(filtered),
      meta: { page, pageSize, total, totalPages },
      rows
    };
  }

  async function detail({ actor, assignmentId } = {}, client = prisma) {
    const scope = scopeForActor(actor, {});
    const assignment = await client.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: assignmentInclude()
    });
    if (!assignment) throw http(404, 'ATTENDANCE_ASSIGNMENT_NOT_FOUND', 'Attendance assignment was not found.');
    const department = assignment.departmentSnapshot || assignment.employee?.department || null;
    if (scope.role === 'MANAGER' && department !== scope.department) {
      throw http(403, 'ATTENDANCE_SUPERVISOR_SCOPE_FORBIDDEN', 'Manager cannot access another Department Attendance scope.');
    }

    const [leaves, correctionsByAssignment] = await Promise.all([
      leavesMap(client, [assignment], assignment.workDate, assignment.workDate),
      correctionsMap(client, [assignment.id])
    ]);
    const rows = await buildRows({ assignments: [assignment], leaves, correctionsByAssignment, asOf: clock(), filters: {}, client });
    const row = rows[0];
    const rawEvents = assignment.attendanceSession?.events || [];

    return {
      ...row,
      rawEvents: rawEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        effectiveEventAt: event.effectiveEventAt,
        receivedAt: event.receivedAt,
        sourceType: event.sourceType || null,
        locationEvidence: event.locationEvidence || null
      })),
      governance: {
        canCreateAdjustmentRequest: ['ADMIN', 'MANAGER'].includes(scope.role),
        canApproveAdjustmentRequest: scope.role === 'ADMIN',
        directOverrideEnabled: false,
        note: 'V4 adjustment requests must not change authoritative Attendance until ADMIN approval.'
      }
    };
  }

  return { daily, history, detail };
}

module.exports = {
  BANGKOK_TIME_ZONE,
  MAX_HISTORY_DAYS,
  bangkokDateText,
  parseDateText,
  parseHistoryRange,
  scopeForActor,
  operationalStatus,
  summaryFor,
  createAttendanceSupervisorService,
  EMPTY_ID
};
