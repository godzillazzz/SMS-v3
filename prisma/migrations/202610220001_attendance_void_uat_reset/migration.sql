-- Attendance Void enum additions only.
-- Additive only: preserves all AttendanceEvent evidence and audit rows.
ALTER TYPE "AttendanceSessionState" ADD VALUE IF NOT EXISTS 'VOIDED';
CREATE TYPE "AttendanceEventState" AS ENUM ('ACTIVE', 'VOIDED');

-- Rollback: not automatic. A rollback must first prove no VOIDED rows exist, then
-- recreate AttendanceSessionState without VOIDED and drop AttendanceEventState.
