-- Attendance Void table schema.
-- Additive only: preserves all AttendanceEvent evidence and audit rows.
ALTER TABLE "attendance_sessions"
  ADD COLUMN "voided_at" TIMESTAMP(3),
  ADD COLUMN "voided_by_user_id" UUID,
  ADD COLUMN "void_reason" VARCHAR(1000);

ALTER TABLE "attendance_events"
  ADD COLUMN "state" "AttendanceEventState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "voided_at" TIMESTAMP(3),
  ADD COLUMN "voided_by_user_id" UUID,
  ADD COLUMN "void_reason" VARCHAR(1000);

ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_voided_state_check"
  CHECK (("state" <> 'VOIDED' AND "voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL)
      OR ("state" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND char_length("void_reason") BETWEEN 5 AND 1000));

ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_voided_state_check"
  CHECK (("state" <> 'VOIDED' AND "voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL)
      OR ("state" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND char_length("void_reason") BETWEEN 5 AND 1000));

ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_voided_by_user_id_fkey"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_voided_by_user_id_fkey"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "attendance_sessions_state_work_date_idx" ON "attendance_sessions"("state", "work_date");
CREATE INDEX "attendance_events_state_effective_event_at_idx" ON "attendance_events"("state", "effective_event_at");

-- Rollback: not automatic. A rollback must first prove no VOIDED rows exist, then
-- remove indexes/constraints/columns and recreate the enum types safely.
