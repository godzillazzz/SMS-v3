-- Allow historical VOIDED AttendanceSession rows while enforcing one live session per assignment.
-- Additive migration: preserves all existing sessions and events.
DROP INDEX IF EXISTS "attendance_sessions_shift_assignment_id_key";
CREATE INDEX IF NOT EXISTS "attendance_sessions_shift_assignment_id_idx"
  ON "attendance_sessions"("shift_assignment_id");
CREATE UNIQUE INDEX "attendance_sessions_one_live_per_assignment_key"
  ON "attendance_sessions"("shift_assignment_id")
  WHERE "state" <> 'VOIDED';
