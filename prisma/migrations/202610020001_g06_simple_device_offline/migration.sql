DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AttendancePendingEventStatus') THEN
    CREATE TYPE "AttendancePendingEventStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED');
  END IF;
END $$;

ALTER TABLE "attendance_device_enrollments"
  ADD COLUMN IF NOT EXISTS "observation_only" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "attendance_events"
  ALTER COLUMN "face_verification_session_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "device_enrollment_id" UUID,
  ADD COLUMN IF NOT EXISTS "source_mode" VARCHAR(16) NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN IF NOT EXISTS "device_captured_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "review_required" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "review_reasons" JSONB;

ALTER TABLE "attendance_events"
  DROP CONSTRAINT IF EXISTS "attendance_events_server_time_check";

ALTER TABLE "attendance_events"
  DROP CONSTRAINT IF EXISTS "attendance_events_source_mode_check";

ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_source_mode_check"
  CHECK (
    ("source_mode" = 'ONLINE' AND "device_captured_at" IS NULL AND "effective_event_at" = "received_at")
    OR
    ("source_mode" = 'OFFLINE' AND "device_captured_at" IS NOT NULL AND "effective_event_at" = "device_captured_at" AND "device_captured_at" <= "received_at")
  );

CREATE INDEX IF NOT EXISTS "attendance_events_device_enrollment_id_received_at_idx"
  ON "attendance_events"("device_enrollment_id", "received_at");

CREATE INDEX IF NOT EXISTS "attendance_events_review_required_received_at_idx"
  ON "attendance_events"("review_required", "received_at");

CREATE TABLE IF NOT EXISTS "attendance_pending_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "shift_assignment_id" UUID NOT NULL,
  "capture_id" UUID NOT NULL,
  "event_type" "AttendanceEventType" NOT NULL,
  "source_mode" VARCHAR(16) NOT NULL DEFAULT 'OFFLINE',
  "captured_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "location_evidence" JSONB NOT NULL,
  "device_snapshot" JSONB NOT NULL,
  "risk_flags" JSONB NOT NULL,
  "payload_digest" CHAR(64) NOT NULL,
  "status" "AttendancePendingEventStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_comment" VARCHAR(1000),
  "attendance_event_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_pending_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_pending_events_payload_digest_format" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "attendance_pending_events_offline_only" CHECK ("source_mode" = 'OFFLINE'),
  CONSTRAINT "attendance_pending_events_capture_before_receive" CHECK ("captured_at" <= "received_at")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_pending_events_capture_id_key"
  ON "attendance_pending_events"("capture_id");

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_pending_events_attendance_event_id_key"
  ON "attendance_pending_events"("attendance_event_id");

CREATE INDEX IF NOT EXISTS "attendance_pending_events_employee_id_captured_at_idx"
  ON "attendance_pending_events"("employee_id", "captured_at");

CREATE INDEX IF NOT EXISTS "attendance_pending_events_status_received_at_idx"
  ON "attendance_pending_events"("status", "received_at");

CREATE INDEX IF NOT EXISTS "attendance_pending_events_shift_assignment_id_event_type_idx"
  ON "attendance_pending_events"("shift_assignment_id", "event_type");

ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_device_enrollment_id_fkey"
  FOREIGN KEY ("device_enrollment_id") REFERENCES "attendance_device_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_pending_events"
  ADD CONSTRAINT "attendance_pending_events_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_pending_events_shift_assignment_id_fkey"
  FOREIGN KEY ("shift_assignment_id") REFERENCES "shift_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_pending_events_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_pending_events_attendance_event_id_fkey"
  FOREIGN KEY ("attendance_event_id") REFERENCES "attendance_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pending offline payload metadata is server-authoritative Attendance data.
ALTER TABLE public."attendance_pending_events" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."attendance_pending_events" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."attendance_pending_events" FROM authenticated';
  END IF;
END
$$;
