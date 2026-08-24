CREATE TYPE "FaceVerificationPurpose" AS ENUM ('ATTENDANCE_EVENT', 'PATROL_EVENT');
CREATE TYPE "FaceVerificationSessionStatus" AS ENUM ('CREATED', 'DEVICE_PROOF_VERIFIED', 'PROVIDER_PENDING', 'VERIFIED', 'FAILED', 'EXPIRED', 'CONSUMED');

CREATE TABLE "face_verification_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "device_enrollment_id" UUID NOT NULL,
  "device_credential_fingerprint" CHAR(64) NOT NULL,
  "reference_photo_id" UUID NOT NULL,
  "reference_photo_checksum" CHAR(64) NOT NULL,
  "device_challenge_id" UUID NOT NULL,
  "purpose" "FaceVerificationPurpose" NOT NULL,
  "status" "FaceVerificationSessionStatus" NOT NULL DEFAULT 'CREATED',
  "context_digest" CHAR(64) NOT NULL,
  "provider" VARCHAR(80),
  "provider_session_ref_hash" CHAR(64),
  "provider_policy_profile_id" VARCHAR(120),
  "provider_engine_version" VARCHAR(120),
  "provider_result_code" VARCHAR(80),
  "pad_passed" BOOLEAN,
  "face_match_passed" BOOLEAN,
  "injection_risk_detected" BOOLEAN,
  "device_proof_verified_at" TIMESTAMP(3),
  "verified_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "failure_code" VARCHAR(80),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "face_verification_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "face_verification_sessions_verified_state_check" CHECK (
    "status" NOT IN ('VERIFIED','CONSUMED') OR (
      "device_proof_verified_at" IS NOT NULL AND
      "verified_at" IS NOT NULL AND
      "pad_passed" IS TRUE AND
      "face_match_passed" IS TRUE AND
      "injection_risk_detected" IS FALSE
    )
  )
);

CREATE TABLE "face_verification_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "device_enrollment_id" UUID NOT NULL,
  "device_credential_fingerprint" CHAR(64) NOT NULL,
  "reference_photo_id" UUID NOT NULL,
  "reference_photo_checksum" CHAR(64) NOT NULL,
  "purpose" "FaceVerificationPurpose" NOT NULL,
  "receipt_hash" CHAR(64) NOT NULL,
  "context_digest" CHAR(64) NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "face_verification_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "face_verification_sessions_device_challenge_id_key" ON "face_verification_sessions"("device_challenge_id");
CREATE UNIQUE INDEX "face_verification_sessions_provider_session_ref_hash_key" ON "face_verification_sessions"("provider_session_ref_hash") WHERE "provider_session_ref_hash" IS NOT NULL;
CREATE INDEX "face_verification_sessions_employee_purpose_status_expires_idx" ON "face_verification_sessions"("employee_id", "purpose", "status", "expires_at");
CREATE INDEX "face_verification_sessions_device_purpose_status_expires_idx" ON "face_verification_sessions"("device_enrollment_id", "purpose", "status", "expires_at");
CREATE INDEX "face_verification_sessions_reference_status_created_idx" ON "face_verification_sessions"("reference_photo_id", "status", "created_at");
CREATE INDEX "face_verification_sessions_user_created_idx" ON "face_verification_sessions"("user_id", "created_at");
CREATE UNIQUE INDEX "face_verification_sessions_one_active_per_employee_device_purpose"
  ON "face_verification_sessions"("employee_id", "device_enrollment_id", "purpose")
  WHERE "status" IN ('CREATED','DEVICE_PROOF_VERIFIED','PROVIDER_PENDING','VERIFIED');

CREATE UNIQUE INDEX "face_verification_receipts_session_id_key" ON "face_verification_receipts"("session_id");
CREATE UNIQUE INDEX "face_verification_receipts_receipt_hash_key" ON "face_verification_receipts"("receipt_hash");
CREATE INDEX "face_verification_receipts_employee_purpose_expires_consumed_idx" ON "face_verification_receipts"("employee_id", "purpose", "expires_at", "consumed_at");
CREATE INDEX "face_verification_receipts_device_purpose_expires_consumed_idx" ON "face_verification_receipts"("device_enrollment_id", "purpose", "expires_at", "consumed_at");
CREATE INDEX "face_verification_receipts_reference_issued_idx" ON "face_verification_receipts"("reference_photo_id", "issued_at");

ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_device_enrollment_id_fkey" FOREIGN KEY ("device_enrollment_id") REFERENCES "attendance_device_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_reference_photo_id_fkey" FOREIGN KEY ("reference_photo_id") REFERENCES "employee_reference_photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_device_challenge_id_fkey" FOREIGN KEY ("device_challenge_id") REFERENCES "attendance_device_challenges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "face_verification_receipts" ADD CONSTRAINT "face_verification_receipts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "face_verification_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "face_verification_receipts" ADD CONSTRAINT "face_verification_receipts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "face_verification_receipts" ADD CONSTRAINT "face_verification_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "face_verification_receipts" ADD CONSTRAINT "face_verification_receipts_device_enrollment_id_fkey" FOREIGN KEY ("device_enrollment_id") REFERENCES "attendance_device_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "face_verification_receipts" ADD CONSTRAINT "face_verification_receipts_reference_photo_id_fkey" FOREIGN KEY ("reference_photo_id") REFERENCES "employee_reference_photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
