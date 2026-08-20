-- G06.1A Time Attendance Core Foundation: additive schema only. Production execution is not authorized here.

CREATE TYPE "AttendanceSessionState" AS ENUM ('OPEN', 'REVIEW_REQUIRED', 'CLOSED');
CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT');
CREATE TYPE "AttendanceEventProvenance" AS ENUM ('ONLINE', 'OFFLINE', 'MANAGER_ON_BEHALF', 'ADMIN_ON_BEHALF');
CREATE TYPE "AttendanceTimeBasis" AS ENUM ('SERVER_RECEIVED', 'DEVICE_CAPTURED', 'CORRECTED');
CREATE TYPE "AttendanceCorrectionType" AS ENUM ('TIME', 'EVENT_TYPE', 'LOCATION', 'EXPECTATION', 'OTHER');
CREATE TYPE "AttendanceRiskCode" AS ENUM ('OFFLINE_SYNC_OVERDUE', 'OFFLINE_TIME_RISK', 'OFFLINE_SCHEDULE_CONFLICT', 'LOCATION_RISK', 'PHOTO_RISK', 'EVIDENCE_INTEGRITY_CONFLICT');
CREATE TYPE "AttendanceReviewState" AS ENUM ('REVIEW_REQUIRED', 'RESOLVED', 'DISMISSED');
CREATE TYPE "AttendanceBusinessFlag" AS ENUM ('ON_TIME', 'LATE', 'EARLY_OUT', 'ABSENT', 'LEAVE', 'ASSIST_OTHER_SITE', 'WRONG_SHIFT', 'MISSING_CHECK_IN', 'MISSING_CHECK_OUT', 'TIME_ABNORMAL', 'OUTSIDE_ALL_SITES', 'CORRECTED');
CREATE TYPE "AttendanceCertificationStatus" AS ENUM ('DRAFT', 'CERTIFIED', 'LOCKED');

CREATE TABLE "security_sites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "geofence_radius_meters" INTEGER NOT NULL,
  "address" VARCHAR(500),
  "description" VARCHAR(2000),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_sites_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "security_sites" ADD CONSTRAINT "security_sites_latitude_range" CHECK ("latitude" >= -90 AND "latitude" <= 90);
ALTER TABLE "security_sites" ADD CONSTRAINT "security_sites_longitude_range" CHECK ("longitude" >= -180 AND "longitude" <= 180);
ALTER TABLE "security_sites" ADD CONSTRAINT "security_sites_geofence_radius_positive" CHECK ("geofence_radius_meters" > 0);
CREATE UNIQUE INDEX "security_sites_code_key" ON "security_sites"("code");
CREATE INDEX "security_sites_is_active_code_idx" ON "security_sites"("is_active", "code");

CREATE TABLE "security_site_departments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "security_site_id" UUID NOT NULL,
  "department_name" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_site_departments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "security_site_departments_security_site_id_department_name_key" ON "security_site_departments"("security_site_id", "department_name");
CREATE INDEX "security_site_departments_department_name_idx" ON "security_site_departments"("department_name");

CREATE TABLE "duties" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "description" VARCHAR(2000),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "duties_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "duties_code_key" ON "duties"("code");
CREATE INDEX "duties_is_active_code_idx" ON "duties"("is_active", "code");

ALTER TABLE "shift_types" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "shift_types" ADD COLUMN "is_overnight" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shift_assignments" ADD COLUMN "security_site_id" UUID;
ALTER TABLE "shift_assignments" ADD COLUMN "duty_id" UUID;
CREATE INDEX "shift_assignments_security_site_id_work_date_idx" ON "shift_assignments"("security_site_id", "work_date");
CREATE INDEX "shift_assignments_duty_id_work_date_idx" ON "shift_assignments"("duty_id", "work_date");

CREATE TABLE "attendance_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "shift_assignment_id" UUID,
  "expected_shift_type_id" UUID,
  "expected_site_id" UUID,
  "expected_duty_id" UUID,
  "work_date" DATE NOT NULL,
  "expectation_snapshot" JSONB NOT NULL,
  "source_schedule_snapshot" JSONB,
  "state" "AttendanceSessionState" NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_sessions_shift_assignment_id_key" ON "attendance_sessions"("shift_assignment_id");
CREATE INDEX "attendance_sessions_employee_id_work_date_idx" ON "attendance_sessions"("employee_id", "work_date");
CREATE INDEX "attendance_sessions_work_date_state_idx" ON "attendance_sessions"("work_date", "state");

CREATE TABLE "attendance_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "capture_id" VARCHAR(128) NOT NULL,
  "event_type" "AttendanceEventType" NOT NULL,
  "provenance" "AttendanceEventProvenance" NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL,
  "effective_event_at" TIMESTAMP(3) NOT NULL,
  "time_basis" "AttendanceTimeBasis" NOT NULL,
  "location_evidence" JSONB,
  "offline_context" JSONB,
  "device_context" JSONB,
  "capture_expectation_snapshot" JSONB,
  "authoritative_expectation_snapshot" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_events_capture_id_key" ON "attendance_events"("capture_id");
CREATE INDEX "attendance_events_session_id_effective_event_at_idx" ON "attendance_events"("session_id", "effective_event_at");
CREATE INDEX "attendance_events_provenance_received_at_idx" ON "attendance_events"("provenance", "received_at");

CREATE TABLE "attendance_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "object_reference" VARCHAR(500) NOT NULL,
  "provider" VARCHAR(100) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL,
  "retention_until" TIMESTAMP(3) NOT NULL,
  "purged_at" TIMESTAMP(3),
  "purge_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_evidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_evidence_object_reference_key" ON "attendance_evidence"("object_reference");
CREATE INDEX "attendance_evidence_event_id_idx" ON "attendance_evidence"("event_id");
CREATE INDEX "attendance_evidence_retention_until_purged_at_idx" ON "attendance_evidence"("retention_until", "purged_at");

CREATE TABLE "attendance_corrections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "event_id" UUID,
  "correction_type" "AttendanceCorrectionType" NOT NULL,
  "previous_value" JSONB,
  "corrected_value" JSONB NOT NULL,
  "reason" VARCHAR(2000) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_role" "UserRole" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_corrections_session_id_created_at_idx" ON "attendance_corrections"("session_id", "created_at");
CREATE INDEX "attendance_corrections_actor_user_id_created_at_idx" ON "attendance_corrections"("actor_user_id", "created_at");

CREATE TABLE "attendance_risk_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "event_id" UUID,
  "code" "AttendanceRiskCode" NOT NULL,
  "state" "AttendanceReviewState" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "context" JSONB,
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "resolution" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_risk_reviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_risk_reviews_session_id_state_idx" ON "attendance_risk_reviews"("session_id", "state");
CREATE INDEX "attendance_risk_reviews_code_state_idx" ON "attendance_risk_reviews"("code", "state");

CREATE TABLE "attendance_business_flags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "flag" "AttendanceBusinessFlag" NOT NULL,
  "source" VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_business_flags_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_business_flags_session_id_flag_key" ON "attendance_business_flags"("session_id", "flag");
CREATE INDEX "attendance_business_flags_flag_idx" ON "attendance_business_flags"("flag");

CREATE TABLE "attendance_month_certifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "month" DATE NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "AttendanceCertificationStatus" NOT NULL DEFAULT 'DRAFT',
  "certified_by_user_id" UUID,
  "certified_at" TIMESTAMP(3),
  "locked_at" TIMESTAMP(3),
  "snapshot_hash" CHAR(64),
  "snapshot_reference" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_month_certifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_month_certifications_month_revision_key" ON "attendance_month_certifications"("month", "revision");
CREATE INDEX "attendance_month_certifications_month_status_idx" ON "attendance_month_certifications"("month", "status");

ALTER TABLE "security_site_departments" ADD CONSTRAINT "security_site_departments_security_site_id_fkey" FOREIGN KEY ("security_site_id") REFERENCES "security_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_security_site_id_fkey" FOREIGN KEY ("security_site_id") REFERENCES "security_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_duty_id_fkey" FOREIGN KEY ("duty_id") REFERENCES "duties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_shift_assignment_id_fkey" FOREIGN KEY ("shift_assignment_id") REFERENCES "shift_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_expected_shift_type_id_fkey" FOREIGN KEY ("expected_shift_type_id") REFERENCES "shift_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_expected_site_id_fkey" FOREIGN KEY ("expected_site_id") REFERENCES "security_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_expected_duty_id_fkey" FOREIGN KEY ("expected_duty_id") REFERENCES "duties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_evidence" ADD CONSTRAINT "attendance_evidence_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "attendance_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "attendance_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_risk_reviews" ADD CONSTRAINT "attendance_risk_reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_risk_reviews" ADD CONSTRAINT "attendance_risk_reviews_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "attendance_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_risk_reviews" ADD CONSTRAINT "attendance_risk_reviews_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_business_flags" ADD CONSTRAINT "attendance_business_flags_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_month_certifications" ADD CONSTRAINT "attendance_month_certifications_certified_by_user_id_fkey" FOREIGN KEY ("certified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "system_settings" ("key", "value", "description", "created_at", "updated_at") VALUES
  ('ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES', '1440', 'Maximum age for normal attendance offline synchronization in minutes.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS', '7', 'Future client-local attendance evidence retention in days.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
