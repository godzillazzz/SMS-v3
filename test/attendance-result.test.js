'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ATTENDANCE_RESULT_FLAGS,
  assignmentWindow,
  classifyAttendanceDay
} = require('../src/services/attendance-result.service');

function assignment({ code = 'DAY', startTime = '07:00', endTime = '19:00' } = {}) {
  return {
    id: 'assignment-test',
    workDate: new Date('2026-08-25T00:00:00.000Z'),
    startTime,
    endTime,
    shiftType: { code, startTime, endTime }
  };
}

function event(eventType, effectiveEventAt) {
  return { eventType, effectiveEventAt: new Date(effectiveEventAt) };
}

test('DAY boundaries use Asia/Bangkok local schedule time', () => {
  const window = assignmentWindow(assignment());
  assert.equal(window.startAt.toISOString(), '2026-08-25T00:00:00.000Z');
  assert.equal(window.endAt.toISOString(), '2026-08-25T12:00:00.000Z');
  assert.equal(window.overnight, false);
});

test('NIGHT boundaries end on the next Bangkok calendar day', () => {
  const window = assignmentWindow(assignment({ code: 'NIGHT', startTime: '19:00', endTime: '07:00' }));
  assert.equal(window.startAt.toISOString(), '2026-08-25T12:00:00.000Z');
  assert.equal(window.endAt.toISOString(), '2026-08-26T00:00:00.000Z');
  assert.equal(window.overnight, true);
});

test('no grace period: exact start is ON_TIME and one second late is LATE', () => {
  const exact = classifyAttendanceDay({
    assignment: assignment(),
    events: [event('CHECK_IN', '2026-08-25T00:00:00.000Z')],
    asOf: new Date('2026-08-25T01:00:00.000Z')
  });
  assert.deepEqual(exact.flags, [ATTENDANCE_RESULT_FLAGS.ON_TIME]);

  const late = classifyAttendanceDay({
    assignment: assignment(),
    events: [event('CHECK_IN', '2026-08-25T00:00:01.000Z')],
    asOf: new Date('2026-08-25T01:00:00.000Z')
  });
  assert.deepEqual(late.flags, [ATTENDANCE_RESULT_FLAGS.LATE]);
});

test('no early-out grace: checkout one second before expected end is EARLY_OUT', () => {
  const result = classifyAttendanceDay({
    assignment: assignment(),
    events: [
      event('CHECK_IN', '2026-08-25T00:00:00.000Z'),
      event('CHECK_OUT', '2026-08-25T11:59:59.000Z')
    ],
    asOf: new Date('2026-08-25T12:00:00.000Z')
  });
  assert.equal(result.status, 'COMPLETE');
  assert.deepEqual(result.flags, [ATTENDANCE_RESULT_FLAGS.ON_TIME, ATTENDANCE_RESULT_FLAGS.EARLY_OUT]);
  assert.equal(result.workedMinutes, 719);
});

test('checkout at expected end is not EARLY_OUT', () => {
  const result = classifyAttendanceDay({
    assignment: assignment(),
    events: [
      event('CHECK_IN', '2026-08-25T00:00:00.000Z'),
      event('CHECK_OUT', '2026-08-25T12:00:00.000Z')
    ],
    asOf: new Date('2026-08-25T12:00:00.000Z')
  });
  assert.deepEqual(result.flags, [ATTENDANCE_RESULT_FLAGS.ON_TIME]);
  assert.equal(result.workedMinutes, 720);
});

test('missing checkout never fabricates checkout time or worked minutes', () => {
  const result = classifyAttendanceDay({
    assignment: assignment(),
    events: [event('CHECK_IN', '2026-08-25T00:05:00.000Z')],
    asOf: new Date('2026-08-25T12:00:00.000Z')
  });
  assert.equal(result.status, 'IN_PROGRESS');
  assert.deepEqual(result.flags, [ATTENDANCE_RESULT_FLAGS.LATE, ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_OUT]);
  assert.equal(result.checkOutAt, null);
  assert.equal(result.workedMinutes, null);
});

test('no check-in after shift end is ABSENT plus MISSING_CHECK_IN without invented time', () => {
  const result = classifyAttendanceDay({
    assignment: assignment(),
    events: [],
    asOf: new Date('2026-08-25T12:00:00.000Z')
  });
  assert.equal(result.status, 'ABSENT');
  assert.deepEqual(result.flags, [ATTENDANCE_RESULT_FLAGS.ABSENT, ATTENDANCE_RESULT_FLAGS.MISSING_CHECK_IN]);
  assert.equal(result.checkInAt, null);
  assert.equal(result.checkOutAt, null);
  assert.equal(result.workedMinutes, null);
});

test('approved leave wins over absence evaluation', () => {
  const result = classifyAttendanceDay({
    assignment: assignment(),
    events: [],
    approvedLeave: true,
    asOf: new Date('2026-08-25T13:00:00.000Z')
  });
  assert.equal(result.status, 'LEAVE');
  assert.deepEqual(result.flags, [ATTENDANCE_RESULT_FLAGS.LEAVE]);
});

test('AL schedule is classified as LEAVE without requiring an Attendance event', () => {
  const result = classifyAttendanceDay({
    assignment: assignment({ code: 'AL' }),
    events: [],
    asOf: new Date('2026-08-25T13:00:00.000Z')
  });
  assert.equal(result.status, 'LEAVE');
  assert.deepEqual(result.flags, [ATTENDANCE_RESULT_FLAGS.LEAVE]);
});

test('OFF schedule is not actionable', () => {
  const result = classifyAttendanceDay({ assignment: assignment({ code: 'OFF' }) });
  assert.equal(result.status, 'NOT_ACTIONABLE');
  assert.deepEqual(result.flags, []);
  assert.equal(result.expectedStartAt, null);
  assert.equal(result.expectedEndAt, null);
});

test('impossible checkout before check-in is TIME_ABNORMAL and worked time remains null', () => {
  const result = classifyAttendanceDay({
    assignment: assignment(),
    events: [
      event('CHECK_IN', '2026-08-25T02:00:00.000Z'),
      event('CHECK_OUT', '2026-08-25T01:00:00.000Z')
    ],
    asOf: new Date('2026-08-25T12:00:00.000Z')
  });
  assert.ok(result.flags.includes(ATTENDANCE_RESULT_FLAGS.TIME_ABNORMAL));
  assert.equal(result.workedMinutes, null);
});
