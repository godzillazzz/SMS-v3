ALTER TABLE "employee_license_documents"
  ADD COLUMN "proposed_license_number" VARCHAR(100),
  ADD COLUMN "storage_delete_after" TIMESTAMP(3),
  ADD COLUMN "storage_deleted_at" TIMESTAMP(3),
  ADD COLUMN "storage_delete_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "storage_delete_last_error_at" TIMESTAMP(3),
  ADD COLUMN "storage_delete_last_error_code" VARCHAR(80);

CREATE INDEX "employee_license_documents_storage_cleanup_idx"
  ON "employee_license_documents"("status", "storage_delete_after", "storage_deleted_at");
