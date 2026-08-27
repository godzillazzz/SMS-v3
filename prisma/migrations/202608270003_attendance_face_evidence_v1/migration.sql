-- G06 Attendance private live-photo evidence V1.
-- Metadata remains after purge; private object bytes are retained for one rolling year.

CREATE TABLE "attendance_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "face_verification_session_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "reference_photo_id" UUID NOT NULL,
  "storage_provider" VARCHAR(50) NOT NULL,
  "storage_bucket" VARCHAR(255) NOT NULL,
  "storage_object_key" VARCHAR(500) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "captured_at" TIMESTAMPTZ NOT NULL,
  "retention_until" TIMESTAMPTZ NOT NULL,
  "purge_requested_at" TIMESTAMPTZ,
  "purged_at" TIMESTAMPTZ,
  "purge_attempts" INTEGER NOT NULL DEFAULT 0,
  "purge_last_error_at" TIMESTAMPTZ,
  "purge_last_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_evidence_face_verification_session_id_key" UNIQUE ("face_verification_session_id"),
  CONSTRAINT "attendance_evidence_storage_object_key_key" UNIQUE ("storage_object_key"),
  CONSTRAINT "attendance_evidence_size_positive" CHECK ("size_bytes" > 0),
  CONSTRAINT "attendance_evidence_retention_after_capture" CHECK ("retention_until" > "captured_at"),
  CONSTRAINT "attendance_evidence_session_fkey" FOREIGN KEY ("face_verification_session_id") REFERENCES "face_verification_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_evidence_employee_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_evidence_reference_photo_fkey" FOREIGN KEY ("reference_photo_id") REFERENCES "employee_reference_photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "attendance_evidence_employee_id_captured_at_idx" ON "attendance_evidence"("employee_id", "captured_at");
CREATE INDEX "attendance_evidence_retention_until_purged_at_idx" ON "attendance_evidence"("retention_until", "purged_at");
CREATE INDEX "attendance_evidence_reference_photo_id_captured_at_idx" ON "attendance_evidence"("reference_photo_id", "captured_at");
