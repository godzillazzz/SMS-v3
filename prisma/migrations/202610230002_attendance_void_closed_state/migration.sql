-- Permit VOIDED historical AttendanceSession rows while preserving OPEN/CLOSED invariants.
-- The existing voided-state constraint remains authoritative for void metadata.
ALTER TABLE "attendance_sessions"
  DROP CONSTRAINT "attendance_sessions_closed_state_check";

ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_closed_state_check"
  CHECK (("state" = 'OPEN' AND "closed_at" IS NULL)
      OR ("state" = 'CLOSED' AND "closed_at" IS NOT NULL)
      OR ("state" = 'VOIDED'));
