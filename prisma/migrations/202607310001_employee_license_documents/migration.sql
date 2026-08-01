CREATE TYPE "LicenseDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

CREATE TABLE "employee_license_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "license_id" UUID NOT NULL,
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
  "status" "LicenseDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "is_current" BOOLEAN NOT NULL DEFAULT false,
  "uploaded_by_id" UUID NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" VARCHAR(2000),
  "version" INTEGER NOT NULL,
  "note" VARCHAR(2000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_license_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_license_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_license_documents_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "employee_licenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_license_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_license_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_license_documents_storage_object_key_key" ON "employee_license_documents"("storage_object_key");
CREATE UNIQUE INDEX "employee_license_documents_license_id_version_key" ON "employee_license_documents"("license_id", "version");
CREATE INDEX "employee_license_documents_employee_id_status_idx" ON "employee_license_documents"("employee_id", "status");
CREATE INDEX "employee_license_documents_license_id_is_current_idx" ON "employee_license_documents"("license_id", "is_current");
CREATE INDEX "employee_license_documents_proposed_expiry_date_idx" ON "employee_license_documents"("proposed_expiry_date");
CREATE UNIQUE INDEX "employee_license_documents_one_current_per_license" ON "employee_license_documents"("license_id") WHERE "is_current" = true;
