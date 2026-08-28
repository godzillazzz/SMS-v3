'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { normalizeScheduleTime } = require('../utils/schedule-time');

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
    checkInAt: null,
    checkOutAt: null,
    workedMinutes: null,
    lateMinutes: null,
    earlyOutMinutes: null,
    evaluatedAt
  };
}

function classifyAttendanceDay({ assignment, events = [], approvedLeave = false, asOf = new Date() } = {}) {
  if (!assignment) throw http(400, 'ATTENDANCE_RESULT_ASSIGNMENT_REQUIRED', 'Shift Assignment is required.');
  const evaluatedAt = new Date(asOf);
  if (Number.isNaN(evaluatedAt.getTime())) throw http(400, 'ATTENDANCE_RESULT_AS_OF_INVALID', 'Attendance result evaluation time is invalid.');

  if (!actionableShift(assignment)) {
    return {
      status: 'NOT_ACTIONABLE',
      flags: [],
      expectedStartAt: null,
      expectedEndAt: null,
      checkInAt: null,
      checkOutAt: null,
      workedMinutes: null,
      lateMinutes: null,
      earlyOutMinutes: null,
      evaluatedAt
    };
  }

  if (leaveShift(assignment)) return leaveResult({ evaluatedAt });

  const window = assignmentWindow(assignment);
  if (approvedLeave) return leaveResult({ window, evaluatedAt });

  const checkIn = eventAt(eventByType(events, 'CHECK_IN'));
  const checkOut = eventAt(eventByType(events, 'CHECK_OUT'));
  const flags = [];
  const lateMinutes = checkIn ? positiveMinuteDelta(checkIn, window.startAt) : null;
  const earlyOutMinutes = checkOut ? positiveMinuteDelta(window.endAt, checkOut) : null;

  if (checkIn) {
    flags.push(lateMinutes > 0
      ? ATTENDANCE_RESULT_FLAGS.LATE
      : ATTENDANCE_RESULT_FLAGS.ON_TIME);
  } else if (evaluatedAt.getTime() >= window.endAt.getTime()) {
    flags.push(ATTENDANCE_RESULT_FLAGS.ABSENT, ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN);
  }

  if (checkOut) {
    if (!checkIn && !flags.includes(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN)) {
      flags.push(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN);
    }
    if (earlyOutMinutes > 0) flags.push(ATTENDANCE_RESULT_FLAGS.EARLY_OUT);
    if (checkIn && checkOut.getTime() < checkIn.getTime()) flags.push(ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL);
  } else if (checkIn && evaluatedAt.getTime() >= window.endAt.getTime()) {
    flags.push(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_OUT, ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL);
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
    checkInAt: checkIn,
    checkOutAt: checkOut,
    workedMinutes,
    lateMinutes,
    earlyOutMinutes,
    evaluatedAt
  };
}

function createAttendanceResultService({ prisma = prismaDefault, clock = () => new Date() } = {}) {
  async function evaluateAssignment({ assignmentId, asOf = clock() } = {}, client = prisma) {
    const assignment = await client.shiftAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        shiftType: true,
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

    return classifyAttendanceDay({
      assignment,
      events: assignment.attendanceSession?.events || [],
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
