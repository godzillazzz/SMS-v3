'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createSecuritySiteAuthorityService } = require('./security-site-authority.service');
const { classifyAttendanceDay } = require('./attendance-result.service');
const { bangkokParts, isOvernightAssignment } = require('./attendance-verification-context.service');
const { currentCorrectionsForAssignments, applyCurrentCorrections } = require('./attendance-correction.service');

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const MAX_HISTORY_DAYS = 62;

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function dateText(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw http(400, 'ATTENDANCE_SELF_DATE_INVALID', 'Attendance date is invalid.');
  return date.toISOString().slice(0, 10);
}

function parseDate(value, code = 'ATTENDANCE_SELF_DATE_INVALID') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw http(400, code, 'Date must use YYYY-MM-DD.');
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw http(400, code, 'Date is invalid.');
  return parsed;
}

function monthStart(month) {
  const text = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(text)) throw http(400, 'ATTENDANCE_SELF_MONTH_INVALID', 'Month must use YYYY-MM.');
  const parsed = new Date(`${text}-01T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 7) !== text) throw http(400, 'ATTENDANCE_SELF_MONTH_INVALID', 'Month is invalid.');
  return parsed;
}

function monthEndExclusive(start) {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

function shiftDate(text, offsetDays) {
  const date = new Date(`${text}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function eventByType(events, type) {
  return (events || []).find((row) => String(row?.eventType || '').toUpperCase() === type) || null;
}

function actualSiteId(events) {
  for (const event of events || []) {
    const evidence = event?.locationEvidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) continue;
    const value = evidence.actualSiteId || evidence.siteId || null;
    if (value) return String(value);
  }
  return null;
}

function employeeSummary(employee) {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    displayName: employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
    firstName: employee.firstName,
    lastName: employee.lastName,
    department: employee.department || null,
    jobTitle: employee.jobTitle || null
  };
}

function shiftSummary(assignment) {
  return {
    id: assignment.shiftTypeId,
    code: assignment.shiftType?.code || null,
    name: assignment.shiftType?.name || null,
    startTime: assignment.startTime || assignment.shiftType?.startTime || null,
    endTime: assignment.endTime || assignment.shiftType?.endTime || null
  };
}

function siteSummary(site) {
  return site ? { id: site.id, code: site.code, name: site.name } : null;
}

function createAttendanceSelfService({ prisma = prismaDefault, clock = () => new Date(), siteAuthorityService = null, correctionsForAssignments = currentCorrectionsForAssignments, applyCorrections = applyCurrentCorrections } = {}) {
  const siteAuthority = siteAuthorityService || createSecuritySiteAuthorityService({ prisma });

  async function identity(actor, client = prisma) {
    const user = await client.user.findUnique({
      where: { id: actor?.sub },
      select: {
        id: true,
        isActive: true,
        accountStatus: true,
        employeeId: true,
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            displayName: true,
            department: true,
            jobTitle: true,
            isActive: true,
            deletedAt: true
          }
        }
      }
    });
    if (!user?.employeeId || !user.employee) throw http(403, 'ATTENDANCE_EMPLOYEE_LINK_REQUIRED', 'A linked employee account is required.');
    if (!user.isActive || user.accountStatus !== 'ACTIVE' || !user.employee.isActive || user.employee.deletedAt) {
      throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot use Attendance self service.');
    }
    return { userId: user.id, employee: user.employee };
  }

  async function latestApprovalForWorkDate(workDate, client = prisma) {
    const month = new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), 1));
    return client.scheduleApproval.findFirst({
      where: { month },
      orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }]
    });
  }

  async function resolveExpectedSite(assignment, client = prisma) {
    const sessionSite = assignment.attendanceSession?.expectedSite || null;
    if (sessionSite) return sessionSite;
    if (assignment.securitySite) return assignment.securitySite;
    try {
      return (await siteAuthority.resolve({ assignment, existingSession: assignment.attendanceSession || null }, client)).site;
    } catch {
      return null;
    }
  }

  async function approvedLeave(employeeId, workDate, client = prisma) {
    return Boolean(await client.leaveRequest.findFirst({
      where: {
        employeeId,
        status: 'APPROVED',
        startDate: { lte: workDate },
        endDate: { gte: workDate }
      },
      select: { id: true }
    }));
  }

  async function normalizeAssignment(assignment, employee, asOf, client = prisma, providedCorrections = null) {
    const rawEvents = assignment.attendanceSession?.events || [];
    const corrections = providedCorrections || await correctionsForAssignments(client, [assignment.id]);
    const effectiveEvents = applyCorrections(rawEvents, corrections);
    const hasLeave = await approvedLeave(employee.id, assignment.workDate, client);
    const result = classifyAttendanceDay({ assignment, events: effectiveEvents, approvedLeave: hasLeave, asOf });
    const expectedSite = await resolveExpectedSite(assignment, client);
    const observedSiteId = actualSiteId(rawEvents);
    let actualSite = null;
    if (observedSiteId) {
      actualSite = expectedSite?.id === observedSiteId
        ? expectedSite
        : await client.securitySite.findUnique({ where: { id: observedSiteId }, select: { id: true, code: true, name: true } }).catch(() => null);
    }
    const originalCheckIn = eventByType(rawEvents, 'CHECK_IN');
    const originalCheckOut = eventByType(rawEvents, 'CHECK_OUT');
    const correctedTypes = corrections.map((row) => String(row.eventType || '').toUpperCase()).filter(Boolean);
    const corrected = correctedTypes.length > 0;
    return {
      date: dateText(assignment.workDate),
      assignmentId: assignment.id,
      sessionId: assignment.attendanceSession?.id || null,
      employee: employeeSummary(employee),
      shift: shiftSummary(assignment),
      expectedSite: siteSummary(expectedSite),
      actualSite: siteSummary(actualSite),
      expectedStartAt: result.expectedStartAt,
      expectedEndAt: result.expectedEndAt,
      originalCheckInAt: originalCheckIn?.effectiveEventAt || null,
      originalCheckOutAt: originalCheckOut?.effectiveEventAt || null,
      checkInAt: result.checkInAt,
      checkOutAt: result.checkOutAt,
      checkInEventId: originalCheckIn?.id || null,
      checkOutEventId: originalCheckOut?.id || null,
      workedMinutes: result.workedMinutes,
      lateMinutes: result.lateMinutes,
      earlyOutMinutes: result.earlyOutMinutes,
      status: result.status,
      flags: result.flags,
      corrected,
      correctionEventTypes: correctedTypes,
      authority: corrected ? 'EFFECTIVE_ATTENDANCE_CORRECTION' : 'RAW_ATTENDANCE_EVENT'
    };
  }

  function assignmentInclude() {
    return {
      shiftType: true,
      securitySite: { select: { id: true, code: true, name: true } },
      attendanceSession: {
        include: {
          expectedSite: { select: { id: true, code: true, name: true } },
          events: { orderBy: { effectiveEventAt: 'asc' } }
        }
      }
    };
  }

  async function currentAssignment(employeeId, now, client = prisma) {
    const local = bangkokParts(now);
    const yesterday = shiftDate(local.date, -1);
    const rows = await client.shiftAssignment.findMany({
      where: {
        employeeId,
        workDate: { in: [new Date(`${yesterday}T00:00:00.000Z`), new Date(`${local.date}T00:00:00.000Z`)] }
      },
      include: assignmentInclude(),
      orderBy: { workDate: 'asc' }
    });
    const byDate = new Map(rows.map((row) => [dateText(row.workDate), row]));
    const previous = byDate.get(yesterday);
    const today = byDate.get(local.date);
    if (previous && isOvernightAssignment(previous)) {
      const endText = previous.endTime || previous.shiftType?.endTime || '00:00';
      const [hour, minute] = String(endText).split(':').map(Number);
      const endMinutes = Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
      if (local.minutes < endMinutes) return previous;
    }
    return today || null;
  }

  async function today({ actor } = {}, client = prisma) {
    const now = clock();
    const resolved = await identity(actor, client);
    const assignment = await currentAssignment(resolved.employee.id, now, client);
    if (!assignment) {
      return {
        generatedAt: now,
        employee: employeeSummary(resolved.employee),
        assignment: null,
        scheduleReady: false,
        reason: 'NO_ASSIGNMENT'
      };
    }
    const approval = await latestApprovalForWorkDate(assignment.workDate, client);
    if (!approval || approval.status !== 'APPROVED') {
      return {
        generatedAt: now,
        employee: employeeSummary(resolved.employee),
        assignment: null,
        scheduleReady: false,
        reason: 'SCHEDULE_NOT_APPROVED'
      };
    }
    return {
      generatedAt: now,
      employee: employeeSummary(resolved.employee),
      assignment: await normalizeAssignment(assignment, resolved.employee, now, client),
      scheduleReady: true,
      scheduleRevision: approval.revision
    };
  }

  async function history({ actor, from, to } = {}, client = prisma) {
    const resolved = await identity(actor, client);
    const end = parseDate(to || bangkokParts(clock()).date);
    const start = parseDate(from || shiftDate(dateText(end), -30));
    if (start.getTime() > end.getTime()) throw http(400, 'ATTENDANCE_SELF_RANGE_INVALID', 'History start date must not be after end date.');
    const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days > MAX_HISTORY_DAYS) throw http(400, 'ATTENDANCE_SELF_RANGE_TOO_LARGE', `History range cannot exceed ${MAX_HISTORY_DAYS} days.`);
    const endExclusive = new Date(end.getTime() + 86400000);
    const assignments = await client.shiftAssignment.findMany({
      where: {
        employeeId: resolved.employee.id,
        workDate: { gte: start, lt: endExclusive }
      },
      include: assignmentInclude(),
      orderBy: { workDate: 'desc' }
    });
    const corrections = await correctionsForAssignments(client, assignments.map((assignment) => assignment.id));
    const correctionsByAssignment = new Map();
    for (const correction of corrections) {
      const key = String(correction.shiftAssignmentId);
      const bucket = correctionsByAssignment.get(key) || [];
      bucket.push(correction);
      correctionsByAssignment.set(key, bucket);
    }

    const rows = [];
    for (const assignment of assignments) {
      const approval = await latestApprovalForWorkDate(assignment.workDate, client);
      if (!approval || approval.status !== 'APPROVED') continue;
      rows.push(await normalizeAssignment(
        assignment,
        resolved.employee,
        clock(),
        client,
        correctionsByAssignment.get(String(assignment.id)) || []
      ));
    }
    return { generatedAt: clock(), employee: employeeSummary(resolved.employee), from: dateText(start), to: dateText(end), rows };
  }

  async function schedule({ actor, month } = {}, client = prisma) {
    const resolved = await identity(actor, client);
    const currentMonth = bangkokParts(clock()).date.slice(0, 7);
    const start = monthStart(month || currentMonth);
    const end = monthEndExclusive(start);
    const approval = await client.scheduleApproval.findFirst({
      where: { month: start },
      orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }]
    });
    if (!approval || approval.status !== 'APPROVED') {
      return {
        generatedAt: clock(),
        employee: employeeSummary(resolved.employee),
        month: dateText(start).slice(0, 7),
        approved: false,
        revision: approval?.revision || null,
        rows: []
      };
    }
    const assignments = await client.shiftAssignment.findMany({
      where: {
        employeeId: resolved.employee.id,
        workDate: { gte: start, lt: end }
      },
      include: { shiftType: true, securitySite: { select: { id: true, code: true, name: true } }, attendanceSession: { include: { expectedSite: { select: { id: true, code: true, name: true } } } } },
      orderBy: { workDate: 'asc' }
    });
    const rows = [];
    for (const assignment of assignments) {
      const expectedSite = await resolveExpectedSite(assignment, client);
      rows.push({
        date: dateText(assignment.workDate),
        assignmentId: assignment.id,
        shift: shiftSummary(assignment),
        expectedSite: siteSummary(expectedSite),
        remark: assignment.remark || null
      });
    }
    return {
      generatedAt: clock(),
      employee: employeeSummary(resolved.employee),
      month: dateText(start).slice(0, 7),
      approved: true,
      revision: approval.revision,
      rows
    };
  }

  return { today, history, schedule };
}

module.exports = {
  BANGKOK_TIME_ZONE,
  MAX_HISTORY_DAYS,
  createAttendanceSelfService
};
