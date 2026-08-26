CREATE TYPE "EmployeeReferencePhotoStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'CANCELLED', 'SUPERSEDED');

CREATE TABLE "employee_reference_photos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "status" "EmployeeReferencePhotoStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "storage_provider" VARCHAR(50) NOT NULL,
  "storage_bucket" VARCHAR(255) NOT NULL,
  "storage_object_key" VARCHAR(500) NOT NULL,
  "original_file_name" VARCHAR(255) NOT NULL,
  "safe_display_file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "image_width" INTEGER NOT NULL,
  "image_height" INTEGER NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "uploaded_by_role_snapshot" VARCHAR(50) NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" VARCHAR(1000),
  "activated_at" TIMESTAMP(3),
  "superseded_at" TIMESTAMP(3),
  "storage_deletion_requested_at" TIMESTAMP(3),
  "storage_deleted_at" TIMESTAMP(3),
  "storage_delete_attempts" INTEGER NOT NULL DEFAULT 0,
  "storage_delete_last_error_at" TIMESTAMP(3),
  "storage_delete_last_error_code" VARCHAR(80),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_reference_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_reference_photos_storage_object_key_key" ON "employee_reference_photos"("storage_object_key");
CREATE INDEX "employee_reference_photos_employee_id_status_created_at_idx" ON "employee_reference_photos"("employee_id", "status", "created_at");
CREATE INDEX "employee_reference_photos_status_storage_delete_idx" ON "employee_reference_photos"("status", "storage_deletion_requested_at", "storage_deleted_at");
CREATE INDEX "employee_reference_photos_uploaded_by_created_at_idx" ON "employee_reference_photos"("uploaded_by_user_id", "created_at");

CREATE UNIQUE INDEX "employee_reference_photos_one_active_per_employee"
  ON "employee_reference_photos"("employee_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "employee_reference_photos_one_pending_per_employee"
  ON "employee_reference_photos"("employee_id") WHERE "status" = 'PENDING_APPROVAL';

ALTER TABLE "employee_reference_photos" ADD CONSTRAINT "employee_reference_photos_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_reference_photos" ADD CONSTRAINT "employee_reference_photos_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_reference_photos" ADD CONSTRAINT "employee_reference_photos_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
