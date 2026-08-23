CREATE TYPE "AttendanceDeviceEnrollmentStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REVOKED', 'REJECTED', 'CANCELLED');
CREATE TYPE "AttendanceDeviceRequestType" AS ENUM ('INITIAL', 'REPLACEMENT');
CREATE TYPE "AttendanceDeviceChangeRequestStatus" AS ENUM ('PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "AttendanceDeviceChallengePurpose" AS ENUM ('DEVICE_ENROLLMENT', 'ATTENDANCE_EVENT', 'PATROL_EVENT');

CREATE TABLE "attendance_device_enrollments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "public_key" BYTEA NOT NULL,
  "key_algorithm" VARCHAR(50) NOT NULL,
  "credential_fingerprint" CHAR(64) NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "platform_hint" VARCHAR(100),
  "user_agent_snapshot" VARCHAR(500),
  "status" "AttendanceDeviceEnrollmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "proof_verified_at" TIMESTAMP(3),
  "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_reason" VARCHAR(1000),
  "created_by_user_id" UUID NOT NULL,
  "approved_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_device_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_device_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "device_enrollment_id" UUID,
  "purpose" "AttendanceDeviceChallengePurpose" NOT NULL,
  "challenge_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_device_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_device_change_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "request_type" "AttendanceDeviceRequestType" NOT NULL,
  "status" "AttendanceDeviceChangeRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "requested_by_user_id" UUID NOT NULL,
  "candidate_device_enrollment_id" UUID NOT NULL,
  "current_device_enrollment_id" UUID,
  "reason" VARCHAR(1000),
  "reviewer_comment" VARCHAR(1000),
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "returned_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_device_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_device_enrollments_credential_fingerprint_key" ON "attendance_device_enrollments"("credential_fingerprint");
CREATE INDEX "attendance_device_enrollments_employee_id_status_idx" ON "attendance_device_enrollments"("employee_id", "status");
CREATE INDEX "attendance_device_enrollments_created_by_user_id_created_at_idx" ON "attendance_device_enrollments"("created_by_user_id", "created_at");
CREATE INDEX "attendance_device_enrollments_approved_by_user_id_idx" ON "attendance_device_enrollments"("approved_by_user_id");
CREATE UNIQUE INDEX "attendance_device_enrollments_one_active_per_employee" ON "attendance_device_enrollments"("employee_id") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "attendance_device_challenges_challenge_hash_key" ON "attendance_device_challenges"("challenge_hash");
CREATE INDEX "attendance_device_challenges_employee_id_purpose_expires_at_consumed_at_idx" ON "attendance_device_challenges"("employee_id", "purpose", "expires_at", "consumed_at");
CREATE INDEX "attendance_device_challenges_device_enrollment_id_purpose_expires_at_idx" ON "attendance_device_challenges"("device_enrollment_id", "purpose", "expires_at");
CREATE UNIQUE INDEX "attendance_device_challenges_one_unconsumed_per_device_purpose" ON "attendance_device_challenges"("device_enrollment_id", "purpose") WHERE "consumed_at" IS NULL AND "device_enrollment_id" IS NOT NULL;

CREATE UNIQUE INDEX "attendance_device_change_requests_candidate_device_enrollment_id_key" ON "attendance_device_change_requests"("candidate_device_enrollment_id");
CREATE INDEX "attendance_device_change_requests_employee_id_status_created_at_idx" ON "attendance_device_change_requests"("employee_id", "status", "created_at");
CREATE INDEX "attendance_device_change_requests_requested_by_user_id_status_idx" ON "attendance_device_change_requests"("requested_by_user_id", "status");
CREATE INDEX "attendance_device_change_requests_reviewed_by_user_id_reviewed_at_idx" ON "attendance_device_change_requests"("reviewed_by_user_id", "reviewed_at");
CREATE UNIQUE INDEX "attendance_device_change_requests_one_actionable_per_employee" ON "attendance_device_change_requests"("employee_id") WHERE "status" IN ('PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION');

ALTER TABLE "attendance_device_enrollments" ADD CONSTRAINT "attendance_device_enrollments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_device_enrollments" ADD CONSTRAINT "attendance_device_enrollments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_device_enrollments" ADD CONSTRAINT "attendance_device_enrollments_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_device_challenges" ADD CONSTRAINT "attendance_device_challenges_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_device_challenges" ADD CONSTRAINT "attendance_device_challenges_device_enrollment_id_fkey" FOREIGN KEY ("device_enrollment_id") REFERENCES "attendance_device_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_device_change_requests" ADD CONSTRAINT "attendance_device_change_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_device_change_requests" ADD CONSTRAINT "attendance_device_change_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_device_change_requests" ADD CONSTRAINT "attendance_device_change_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_device_change_requests" ADD CONSTRAINT "attendance_device_change_requests_candidate_device_enrollment_id_fkey" FOREIGN KEY ("candidate_device_enrollment_id") REFERENCES "attendance_device_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_device_change_requests" ADD CONSTRAINT "attendance_device_change_requests_current_device_enrollment_id_fkey" FOREIGN KEY ("current_device_enrollment_id") REFERENCES "attendance_device_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
