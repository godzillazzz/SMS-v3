'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { normalizeScheduleTime } = require('../utils/schedule-time');
const { DEFAULT_ATTENDANCE_TIME_POLICY, normalizeAttendanceTimePolicy } = require('./attendance-time-policy.contract');

const BANGKOK_OFFSET = '+07:00';
const ATTENDANCE_RESULT_FLAGS = Object.freeze({
  ON_TIME: 'ON_TIME',
  LATE: 'LATE',
  EARLY_OUT: 'EARLY_OUT',
  ABSENT: 'ABSENT',
  LEAVE: 'LEAVE',
  ASSIST_OTHER_SITE: 'ASSIST_OTHER_SITE',
  WRONG_SHIFT: 'WRONG_SHIFT',
  MISSING_CHECK_IN: 'MISSING_CHECK_IN',
  MISSING_CHECK_OUT: 'MISSING_CHECK_OUT',
  TIME_ABNORMAL: 'TIME_ABNORMAL',
  OUTSIDE_ALL_SITES: 'OUTSIDE_ALL_SITES',
  CORRECTED: 'CORRECTED',
  LOCATION_RISK: 'LOCATION_RISK',
  PHOTO_RISK: 'PHOTO_RISK'
});

function http(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function workDateText(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw http(409, 'ATTENDANCE_RESULT_SCHEDULE_INVALID', 'Attendance work date is invalid.');
  return date.toISOString().slice(0, 10);
}

function timeMinutes(value) {
  const normalized = normalizeScheduleTime(value);
  if (!normalized) return null;
  return Number(normalized.slice(0, 2)) * 60 + Number(normalized.slice(3, 5));
}

function shiftDate(dateText, offsetDays) {
  const date = new Date(`${dateText}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function scheduleBoundary(dateText, timeText) {
  const date = new Date(`${dateText}T${timeText}:00${BANGKOK_OFFSET}`);
  if (Number.isNaN(date.getTime())) throw http(409, 'ATTENDANCE_RESULT_SCHEDULE_INVALID', 'Attendance schedule time is invalid.');
  return date;
}

function assignmentWindow(assignment) {
  const rawStartTime = assignment?.startTime || assignment?.shiftType?.startTime || null;
  const rawEndTime = assignment?.endTime || assignment?.shiftType?.endTime || null;
  const startTime = normalizeScheduleTime(rawStartTime);
  const endTime = normalizeScheduleTime(rawEndTime);
  const startMinutes = timeMinutes(startTime);
  const endMinutes = timeMinutes(endTime);
  if (!startTime || !endTime || startMinutes === null || endMinutes === null) {
    throw http(409, 'ATTENDANCE_RESULT_SCHEDULE_INVALID', 'Attendance Shift start/end time is invalid.');
  }
  const dateText = workDateText(assignment.workDate);
  const endDateText = endMinutes <= startMinutes ? shiftDate(dateText, 1) : dateText;
  return {
    startAt: scheduleBoundary(dateText, startTime),
    endAt: scheduleBoundary(endDateText, endTime),
    overnight: endMinutes <= startMinutes
  };
}

function eventAt(event) {
  if (!event?.effectiveEventAt) return null;
  const date = new Date(event.effectiveEventAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventByType(events, eventType) {
  return (events || []).find((event) => String(event?.eventType || '').toUpperCase() === eventType) || null;
}

function actionableShift(assignment) {
  const code = String(assignment?.shiftType?.code || '').trim().toUpperCase();
  return code !== 'OFF';
}

function leaveShift(assignment) {
  const code = String(assignment?.shiftType?.code || '').trim().toUpperCase();
  return ['AL', 'LEAVE'].includes(code);
}

function positiveMinuteDelta(later, earlier) {
  if (!later || !earlier || later.getTime() <= earlier.getTime()) return 0;
  return Math.ceil((later.getTime() - earlier.getTime()) / 60000);
}

function leaveResult({ window = null, evaluatedAt }) {
  return {
    status: 'LEAVE',
    flags: [ATTENDANCE_RESULT_FLAGS.LEAVE],
    expectedStartAt: window?.startAt || null,
    expectedEndAt: window?.endAt || null,
    scheduledStartAt: window?.startAt || null,
    scheduledEndAt: window?.endAt || null,
    checkInAt: null,
    checkOutAt: null,
    effectiveCheckInAt: null,
    effectiveCheckOutAt: null,
    workedMinutes: null,
    lateMinutes: null,
    earlyOutMinutes: null,
    punctuality: null,
    checkoutCondition: null,
    abnormalTime: false,
    abnormalReasons: [],
    effectivePolicy: null,
    effectivePolicies: { checkIn: null, checkOut: null },
    evaluatedAt
  };
}

function policyForEvent(event, fallback) {
  const snapshot = event?.timePolicySnapshot;
  const values = snapshot?.values && typeof snapshot.values === 'object'
    ? normalizeAttendanceTimePolicy(snapshot.values)
    : normalizeAttendanceTimePolicy(fallback || DEFAULT_ATTENDANCE_TIME_POLICY);
  return {
    values,
    source: snapshot && typeof snapshot === 'object'
      ? { policyId: snapshot.policyId || null, scopeType: snapshot.scopeType || 'COMPANY_DEFAULT', scopeId: snapshot.scopeId || null, effectiveFrom: snapshot.effectiveFrom || null }
      : null
  };
}

function classifyAttendanceDay({ assignment, events = [], approvedLeave = false, asOf = new Date(), policy = DEFAULT_ATTENDANCE_TIME_POLICY } = {}) {
  if (!assignment) throw http(400, 'ATTENDANCE_RESULT_ASSIGNMENT_REQUIRED', 'Shift Assignment is required.');
  const evaluatedAt = new Date(asOf);
  if (Number.isNaN(evaluatedAt.getTime())) throw http(400, 'ATTENDANCE_RESULT_AS_OF_INVALID', 'Attendance result evaluation time is invalid.');

  if (!actionableShift(assignment)) {
    return {
      status: 'NOT_ACTIONABLE',
      flags: [],
      expectedStartAt: null,
      expectedEndAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      checkInAt: null,
      checkOutAt: null,
      effectiveCheckInAt: null,
      effectiveCheckOutAt: null,
      workedMinutes: null,
      lateMinutes: null,
      earlyOutMinutes: null,
      punctuality: null,
      checkoutCondition: null,
      abnormalTime: false,
      abnormalReasons: [],
      effectivePolicy: null,
      effectivePolicies: { checkIn: null, checkOut: null },
      evaluatedAt
    };
  }

  if (leaveShift(assignment)) return leaveResult({ evaluatedAt });

  const window = assignmentWindow(assignment);
  if (approvedLeave) return leaveResult({ window, evaluatedAt });

  const checkIn = eventAt(eventByType(events, 'CHECK_IN'));
  const checkOut = eventAt(eventByType(events, 'CHECK_OUT'));
  const checkInEvent = eventByType(events, 'CHECK_IN');
  const checkOutEvent = eventByType(events, 'CHECK_OUT');
  const fallbackPolicy = normalizeAttendanceTimePolicy(policy || DEFAULT_ATTENDANCE_TIME_POLICY);
  const checkInPolicy = checkIn ? policyForEvent(checkInEvent, fallbackPolicy) : { values: fallbackPolicy, source: null };
  const checkOutPolicy = checkOut ? policyForEvent(checkOutEvent, fallbackPolicy) : { values: fallbackPolicy, source: null };
  const flags = [];
  const abnormalReasons = [];
  let punctuality = null;
  let checkoutCondition = null;
  const lateThreshold = new Date(window.startAt.getTime() + checkInPolicy.values.lateGraceMinutes * 60000);
  const earlyThreshold = new Date(window.endAt.getTime() - checkOutPolicy.values.earlyCheckoutToleranceMinutes * 60000);
  // Keep duration fields relative to the scheduled boundary for existing
  // reports; grace/tolerance changes classification, not elapsed minutes.
  const lateMinutes = checkIn ? positiveMinuteDelta(checkIn, window.startAt) : null;
  const earlyOutMinutes = checkOut ? positiveMinuteDelta(window.endAt, checkOut) : null;

  if (checkIn) {
    punctuality = checkIn.getTime() > window.startAt.getTime() + checkInPolicy.values.lateGraceMinutes * 60000 ? 'LATE' : 'ON_TIME';
    flags.push(punctuality === 'LATE'
      ? ATTENDANCE_RESULT_FLAGS.LATE
      : ATTENDANCE_RESULT_FLAGS.ON_TIME);
  } else if (evaluatedAt.getTime() >= window.endAt.getTime()) {
    flags.push(ATTENDANCE_RESULT_FLAGS.ABSENT, ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN);
  }

  if (checkOut) {
    if (!checkIn && !flags.includes(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN)) {
      flags.push(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN);
    }
    const earlyLeave = checkOutPolicy.values.earlyLeaveEnabled
      && checkOut.getTime() < window.endAt.getTime() - checkOutPolicy.values.earlyCheckoutToleranceMinutes * 60000;
    if (earlyLeave) {
      flags.push(ATTENDANCE_RESULT_FLAGS.EARLY_OUT);
      checkoutCondition = 'EARLY_LEAVE';
    } else checkoutCondition = 'NORMAL';
    if (checkIn && checkOut.getTime() < checkIn.getTime()) {
      flags.push(ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL);
      abnormalReasons.push('CHECK_OUT_BEFORE_CHECK_IN');
    }
  } else if (checkIn) {
    const checkInValues = checkInPolicy.values;
    const missingCheckoutAt = window.endAt.getTime() + checkInValues.missingCheckoutAfterMinutes * 60000;
    if (checkInValues.missingCheckoutEnabled && evaluatedAt.getTime() >= missingCheckoutAt) {
      flags.push(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_OUT, ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL);
      abnormalReasons.push('MISSING_CHECK_OUT');
      checkoutCondition = 'MISSING_CHECK_OUT';
    }
    if (checkInValues.maxShiftDurationEnabled
      && checkInValues.maxShiftDurationMinutes !== null
      && evaluatedAt.getTime() >= checkIn.getTime() + checkInValues.maxShiftDurationMinutes * 60000) {
      flags.push(ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL);
      abnormalReasons.push('MAX_SHIFT_DURATION_EXCEEDED');
    }
  }

  if (checkIn && checkOut && checkInPolicy.values.maxShiftDurationEnabled
    && checkInPolicy.values.maxShiftDurationMinutes !== null
    && checkOut.getTime() - checkIn.getTime() > checkInPolicy.values.maxShiftDurationMinutes * 60000) {
    flags.push(ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL);
    abnormalReasons.push('MAX_SHIFT_DURATION_EXCEEDED');
  }

  const workedMinutes = checkIn && checkOut && checkOut.getTime() >= checkIn.getTime()
    ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000)
    : null;
  const status = flags.includes(ATTENDANCE_RESULT_FLAGS.ABSENT)
    ? 'ABSENT'
    : checkIn && checkOut
      ? 'COMPLETE'
      : checkIn
        ? 'IN_PROGRESS'
        : evaluatedAt.getTime() < window.startAt.getTime()
          ? 'SCHEDULED'
          : 'AWAITING_CHECK_IN';

  return {
    status,
    flags,
    expectedStartAt: window.startAt,
    expectedEndAt: window.endAt,
    scheduledStartAt: window.startAt,
    scheduledEndAt: window.endAt,
    checkInAt: checkIn,
    checkOutAt: checkOut,
    effectiveCheckInAt: checkIn,
    effectiveCheckOutAt: checkOut,
    workedMinutes,
    lateMinutes,
    earlyOutMinutes,
    punctuality,
    checkoutCondition,
    abnormalTime: flags.includes(ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL) || flags.includes(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_OUT),
    abnormalReasons: [...new Set(abnormalReasons)],
    effectivePolicy: checkInPolicy.source || checkOutPolicy.source || null,
    effectivePolicies: { checkIn: checkInPolicy.source, checkOut: checkOutPolicy.source },
    evaluatedAt
  };
}

function createAttendanceResultService({ prisma = prismaDefault, clock = () => new Date(), timePolicyService = null } = {}) {
  const { createAttendanceTimePolicyService } = require('./attendance-time-policy.service');
  const timePolicies = timePolicyService || createAttendanceTimePolicyService({ prisma, clock });
  async function evaluateAssignment({ assignmentId, asOf = clock() } = {}, client = prisma) {
    const assignment = await client.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        shiftType: true,
        securitySite: true,
        attendanceSession: {
          include: { events: { orderBy: { effectiveEventAt: 'asc' } } }
        }
      }
    });
    if (!assignment) throw http(404, 'ATTENDANCE_RESULT_ASSIGNMENT_NOT_FOUND', 'Shift Assignment was not found.');

    const leave = await client.leaveRequest.findFirst({
      where: {
        employeeId: assignment.employeeId,
        status: 'APPROVED',
        startDate: { lte: assignment.workDate },
        endDate: { gte: assignment.workDate }
      },
      select: { id: true }
    });

    const events = await timePolicies.hydrateEvents({ assignment, events: assignment.attendanceSession?.events || [] }, client);
    return classifyAttendanceDay({
      assignment,
      events,
      approvedLeave: Boolean(leave),
      asOf
    });
  }

  return { evaluateAssignment };
}

module.exports = {
  BANGKOK_OFFSET,
  ATTENDANCE_RESULT_FLAGS,
  assignmentWindow,
  classifyAttendanceDay,
  createAttendanceResultService
};
