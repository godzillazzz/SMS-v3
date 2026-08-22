ALTER TYPE "LicenseDocumentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TABLE "employee_license_document_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "document_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "storage_provider" VARCHAR(50) NOT NULL,
  "storage_bucket" VARCHAR(255) NOT NULL,
  "storage_object_key" VARCHAR(500) NOT NULL,
  "original_file_name" VARCHAR(255) NOT NULL,
  "safe_display_file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "checksum" CHAR(64),
  "proposed_start_date" DATE NOT NULL,
  "proposed_expiry_date" DATE NOT NULL,
  "proposed_license_number" VARCHAR(100),
  "note" VARCHAR(2000),
  "submitted_by_id" UUID NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "correction_reason" VARCHAR(1000),
  CONSTRAINT "employee_license_document_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_license_document_revisions_document_id_revision_key"
  ON "employee_license_document_revisions"("document_id", "revision");
CREATE INDEX "employee_license_document_revisions_document_id_submitted_at_idx"
  ON "employee_license_document_revisions"("document_id", "submitted_at");
CREATE INDEX "employee_license_document_revisions_submitted_by_id_idx"
  ON "employee_license_document_revisions"("submitted_by_id");

ALTER TABLE "employee_license_document_revisions"
  ADD CONSTRAINT "employee_license_document_revisions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "employee_license_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_license_document_revisions"
  ADD CONSTRAINT "employee_license_document_revisions_submitted_by_id_fkey"
  FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;