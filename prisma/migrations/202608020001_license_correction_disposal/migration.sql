ALTER TYPE "LicenseDocumentStatus" ADD VALUE 'RETURNED_FOR_CORRECTION';
ALTER TYPE "LicenseDocumentStatus" ADD VALUE 'EXPIRED';

ALTER TABLE "employee_license_documents"
  ADD COLUMN "correction_reason" VARCHAR(1000),
  ADD COLUMN "returned_by_id" UUID,
  ADD COLUMN "returned_at" TIMESTAMP(3),
  ADD COLUMN "resubmitted_at" TIMESTAMP(3),
  ADD COLUMN "storage_delete_object_key" VARCHAR(500),
  ADD COLUMN "immediate_deletion_requested_at" TIMESTAMP(3),
  ADD COLUMN "expiration_processed_at" TIMESTAMP(3),
  ADD CONSTRAINT "employee_license_documents_returned_by_id_fkey"
    FOREIGN KEY ("returned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "employee_license_documents_expiration_idx"
  ON "employee_license_documents"("status", "is_current", "expiration_processed_at");

CREATE INDEX "employee_license_documents_storage_delete_object_idx"
  ON "employee_license_documents"("storage_delete_object_key");
