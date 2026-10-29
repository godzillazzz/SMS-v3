'use strict';
// Attendance release-control schema pin.
//
// ATTENDANCE_SCHEMA_SHA256 is the single reviewed pin of the exact prisma/schema.prisma bytes
// that attendance migration / release control planes are allowed to operate on.
//
// MAINTENANCE RULE: any reviewed change to prisma/schema.prisma must update
// ATTENDANCE_SCHEMA_SHA256 in this file, together with the governed evidence and tests, in the
// SAME governed commit. A stale pin fails closed (SCHEMA_PIN_MISMATCH) before any database
// access and is never repaired by weakening a guard.
const crypto = require('node:crypto');

const SCHEMA_PIN_MISMATCH = 'SCHEMA_PIN_MISMATCH';
const ATTENDANCE_SCHEMA_SHA256 = '45c7c3fd9f694ad788813fd13469c7c3046e054a6aaae8c48e49fd8da167c804';

// The mismatch error carries the coded token only: never schema content, path or digest.
class AttendanceSchemaPinError extends Error {
  constructor() {
    super(SCHEMA_PIN_MISMATCH);
    this.name = 'AttendanceSchemaPinError';
    this.code = SCHEMA_PIN_MISMATCH;
  }
}

function attendanceSchemaDigest(bytes) {
  if (bytes === undefined || bytes === null) throw new AttendanceSchemaPinError();
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Pure assertion: accepts schema bytes (Buffer/string) and never reads the filesystem, so the
// same helper can pin a checked-out tree, a scratch copy, or an in-memory fixture.
function assertAttendanceSchemaPin(bytes) {
  let digest;
  try {
    digest = attendanceSchemaDigest(bytes);
  } catch {
    throw new AttendanceSchemaPinError();
  }
  if (digest !== ATTENDANCE_SCHEMA_SHA256) throw new AttendanceSchemaPinError();
  return digest;
}

function isAttendanceSchemaPinError(error) {
  if (!error) return false;
  if (error instanceof AttendanceSchemaPinError) return true;
  return error.code === SCHEMA_PIN_MISMATCH || error.message === SCHEMA_PIN_MISMATCH;
}

module.exports = {
  SCHEMA_PIN_MISMATCH,
  ATTENDANCE_SCHEMA_SHA256,
  AttendanceSchemaPinError,
  attendanceSchemaDigest,
  assertAttendanceSchemaPin,
  isAttendanceSchemaPinError,
};
