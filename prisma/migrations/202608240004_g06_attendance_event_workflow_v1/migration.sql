CREATE TYPE "AttendanceSessionState" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT');
CREATE TYPE "AttendanceEventProvenance" AS ENUM ('ONLINE');
CREATE TYPE "AttendanceTimeBasis" AS ENUM ('SERVER_RECEIVED');

CREATE TABLE "attendance_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "shift_assignment_id" UUID NOT NULL,
  "expected_shift_type_id" UUID NOT NULL,
  "expected_site_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "expectation_snapshot" JSONB NOT NULL,
  "expectation_digest" CHAR(64) NOT NULL,
  "state" "AttendanceSessionState" NOT NULL DEFAULT 'OPEN',
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_sessions_expectation_digest_format" CHECK ("expectation_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "attendance_sessions_closed_state_check" CHECK (("state" = 'OPEN' AND "closed_at" IS NULL) OR ("state" = 'CLOSED' AND "closed_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "attendance_sessions_shift_assignment_id_key" ON "attendance_sessions"("shift_assignment_id");
CREATE INDEX "attendance_sessions_employee_id_work_date_idx" ON "attendance_sessions"("employee_id", "work_date");
CREATE INDEX "attendance_sessions_work_date_state_idx" ON "attendance_sessions"("work_date", "state");

CREATE TABLE "attendance_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "face_verification_session_id" UUID NOT NULL,
  "capture_id" UUID NOT NULL,
  "event_type" "AttendanceEventType" NOT NULL,
  "provenance" "AttendanceEventProvenance" NOT NULL DEFAULT 'ONLINE',
  "received_at" TIMESTAMP(3) NOT NULL,
  "effective_event_at" TIMESTAMP(3) NOT NULL,
  "time_basis" "AttendanceTimeBasis" NOT NULL DEFAULT 'SERVER_RECEIVED',
  "context_digest" CHAR(64) NOT NULL,
  "location_evidence" JSONB NOT NULL,
  "verification_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_events_context_digest_format" CHECK ("context_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "attendance_events_server_time_check" CHECK ("effective_event_at" = "received_at")
);

CREATE UNIQUE INDEX "attendance_events_face_verification_session_id_key" ON "attendance_events"("face_verification_session_id");
CREATE UNIQUE INDEX "attendance_events_capture_id_key" ON "attendance_events"("capture_id");
CREATE UNIQUE INDEX "attendance_events_session_id_event_type_key" ON "attendance_events"("session_id", "event_type");
CREATE INDEX "attendance_events_session_id_effective_event_at_idx" ON "attendance_events"("session_id", "effective_event_at");
CREATE INDEX "attendance_events_received_at_idx" ON "attendance_events"("received_at");

ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_shift_assignment_id_fkey"
  FOREIGN KEY ("shift_assignment_id") REFERENCES "shift_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_expected_shift_type_id_fkey"
  FOREIGN KEY ("expected_shift_type_id") REFERENCES "shift_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_sessions"
  ADD CONSTRAINT "attendance_sessions_expected_site_id_fkey"
  FOREIGN KEY ("expected_site_id") REFERENCES "security_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_face_verification_session_id_fkey"
  FOREIGN KEY ("face_verification_session_id") REFERENCES "face_verification_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
