'use strict';

const ATTENDANCE_TIME_POLICY_VERSION = 'ATTENDANCE_TIME_POLICY_V1';

// Preserve the deployed classifier defaults: no grace, late check-in remains
// allowed, early leave is reported, and a missing checkout is visible at the
// scheduled end until an Admin selects a different threshold.
const DEFAULT_ATTENDANCE_TIME_POLICY = Object.freeze({
  lateGraceMinutes: 0,
  earliestCheckInEnabled: false,
  earliestCheckInMinutesBeforeStart: 60,
  latestCheckInEnabled: false,
  latestCheckInMinutesAfterStart: null,
  earliestCheckOutEnabled: false,
  earliestCheckOutMinutesAfterStart: 0,
  latestCheckOutEnabled: false,
  latestCheckOutMinutesAfterEnd: null,
  earlyLeaveEnabled: true,
  earlyCheckoutToleranceMinutes: 0,
  missingCheckoutEnabled: true,
  missingCheckoutAfterMinutes: 0,
  maxShiftDurationEnabled: false,
  maxShiftDurationMinutes: null
});

const POLICY_RULES = Object.freeze([
  ['lateGraceMinutes', 0, 360],
  ['earliestCheckInMinutesBeforeStart', 0, 720],
  ['latestCheckInMinutesAfterStart', 0, 1440],
  ['earliestCheckOutMinutesAfterStart', 0, 2880],
  ['latestCheckOutMinutesAfterEnd', 0, 1440],
  ['earlyCheckoutToleranceMinutes', 0, 720],
  ['missingCheckoutAfterMinutes', 0, 1440],
  ['maxShiftDurationMinutes', 60, 2880]
]);

const BOOLEAN_FIELDS = Object.freeze([
  'earliestCheckInEnabled', 'latestCheckInEnabled', 'earliestCheckOutEnabled',
  'latestCheckOutEnabled', 'earlyLeaveEnabled', 'missingCheckoutEnabled',
  'maxShiftDurationEnabled'
]);

function invalid(message, field = null) {
  const error = new Error(message);
  error.code = 'ATTENDANCE_TIME_POLICY_INVALID';
  if (field) error.field = field;
  return error;
}

function normalizeAttendanceTimePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Attendance time policy must be an object.');
  const allowed = new Set([...POLICY_RULES.map(([field]) => field), ...BOOLEAN_FIELDS]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw invalid(`Unknown Attendance time policy field: ${key}.`, key);

  const value = { ...DEFAULT_ATTENDANCE_TIME_POLICY };
  for (const field of BOOLEAN_FIELDS) {
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'boolean') throw invalid(`${field} must be true or false.`, field);
      value[field] = input[field];
    }
  }
  for (const [field, min, max] of POLICY_RULES) {
    if (input[field] === undefined) continue;
    if (input[field] === null && ['latestCheckInMinutesAfterStart', 'latestCheckOutMinutesAfterEnd', 'maxShiftDurationMinutes'].includes(field)) {
      value[field] = null;
      continue;
    }
    if (input[field] === null) throw invalid(`${field} cannot be null.`, field);
    const number = Number(input[field]);
    if (!Number.isInteger(number) || number < min || number > max) throw invalid(`${field} must be an integer from ${min} to ${max}.`, field);
    value[field] = number;
  }

  const enabledLimits = [
    ['latestCheckInEnabled', 'latestCheckInMinutesAfterStart'],
    ['latestCheckOutEnabled', 'latestCheckOutMinutesAfterEnd'],
    ['maxShiftDurationEnabled', 'maxShiftDurationMinutes']
  ];
  for (const [toggle, field] of enabledLimits) {
    if (value[toggle] && value[field] === null) throw invalid(`${field} is required when ${toggle} is enabled.`, field);
  }
  if (value.latestCheckInEnabled
    && value.latestCheckInMinutesAfterStart < value.lateGraceMinutes) {
    throw invalid('Latest CHECK_IN limit cannot be shorter than the late grace period.', 'latestCheckInMinutesAfterStart');
  }
  if (value.maxShiftDurationEnabled && value.earliestCheckOutEnabled
    && value.earliestCheckOutMinutesAfterStart >= value.maxShiftDurationMinutes) {
    throw invalid('Earliest CHECK_OUT must occur before the maximum shift duration.', 'earliestCheckOutMinutesAfterStart');
  }
  return value;
}

module.exports = {
  ATTENDANCE_TIME_POLICY_VERSION,
  DEFAULT_ATTENDANCE_TIME_POLICY,
  POLICY_RULES,
  BOOLEAN_FIELDS,
  normalizeAttendanceTimePolicy
};
