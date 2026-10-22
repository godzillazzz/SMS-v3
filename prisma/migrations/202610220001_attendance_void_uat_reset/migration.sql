-- Attendance Void + UAT reset state model.
-- Additive only: preserves all AttendanceEvent evidence and audit rows.
ALTER TYPE "AttendanceSessionState" ADD VALUE IF NOT EXISTS 'VOIDED';
CREATE TYPE "AttendanceEventState" AS ENUM ('ACTIVE', 'VOIDED');

-- PostgreSQL cannot use an enum value added in the current transaction until
-- that transaction is committed (SQLSTATE 55P04). Prisma runs migrations in a
-- transaction, so commit the enum changes before any table definition uses
-- 'VOIDED', then continue the additive schema changes in a new transaction.
COMMIT;
BEGIN;

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
-- remove indexes/constraints/columns and recreate AttendanceSessionState without VOIDED.
