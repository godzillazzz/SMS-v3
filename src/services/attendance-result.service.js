'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');

const BANGKOK_OFFSET = '+07:00';
const ATTENDANCE_RESULT_FLAGS = Object.freeze({
  ON_TIME: 'ON_TIME',
  LATE: 'LATE',
  EARLY_OUT: 'EARLY_OUT',
  ABSENT: 'ABSENT',
  LEAVE: 'LEAVE',
  MISSING_CHECK_IN: 'MISSING_CHECK_IN',
  MISSING_CHECK_OUT: 'MISSING_CHECK_OUT',
  TIME_ABNORMAL: 'TIME_ABNORMAL'
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
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
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
  const startTime = assignment?.startTime || assignment?.shiftType?.startTime || null;
  const endTime = assignment?.endTime || assignment?.shiftType?.endTime || null;
  const startMinutes = timeMinutes(startTime);
  const endMinutes = timeMinutes(endTime);
  if (startMinutes === null || endMinutes === null) {
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
  return !['OFF'].includes(code);
}

function leaveShift(assignment) {
  const code = String(assignment?.shiftType?.code || '').trim().toUpperCase();
  return ['AL', 'LEAVE'].includes(code);
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
      evaluatedAt
    };
  }

  const window = assignmentWindow(assignment);
  if (approvedLeave || leaveShift(assignment)) {
    return {
      status: 'LEAVE',
      flags: [ATTENDANCE_RESULT_FLAGS.LEAVE],
      expectedStartAt: window.startAt,
      expectedEndAt: window.endAt,
      checkInAt: null,
      checkOutAt: null,
      workedMinutes: null,
      evaluatedAt
    };
  }

  const checkIn = eventAt(eventByType(events, 'CHECK_IN'));
  const checkOut = eventAt(eventByType(events, 'CHECK_OUT'));
  const flags = [];

  if (checkIn) {
    flags.push(checkIn.getTime() > window.startAt.getTime()
      ? ATTENDANCE_RESULT_FLAGS.LATE
      : ATTENDANCE_RESULT_FLAGS.ON_TIME);
  } else if (evaluatedAt.getTime() >= window.endAt.getTime()) {
    flags.push(ATTENDANCE_RESULT_FLAGS.ABSENT, ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN);
  }

  if (checkOut) {
    if (!checkIn && !flags.includes(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN)) {
      flags.push(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN);
    }
    if (checkOut.getTime() < window.endAt.getTime()) flags.push(ATTENDANCE_RESULT_FLAGS.EARLY_OUT);
    if (checkIn && checkOut.getTime() < checkIn.getTime()) flags.push(ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL);
  } else if (checkIn && evaluatedAt.getTime() >= window.endAt.getTime()) {
    flags.push(ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_OUT);
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
