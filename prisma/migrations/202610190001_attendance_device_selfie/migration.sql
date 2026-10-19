-- Additive Attendance device selfie storage only.
CREATE TABLE "attendance_device_selfies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "capture_id" UUID NOT NULL,
    "storage_provider" VARCHAR(50) NOT NULL,
    "storage_bucket" VARCHAR(255) NOT NULL,
    "storage_object_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "retention_until" TIMESTAMP(3) NOT NULL,
    "purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_device_selfies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_device_selfies_capture_id_key" ON "attendance_device_selfies"("capture_id");
CREATE UNIQUE INDEX "attendance_device_selfies_storage_object_key_key" ON "attendance_device_selfies"("storage_object_key");
CREATE INDEX "attendance_device_selfies_employee_id_captured_at_idx" ON "attendance_device_selfies"("employee_id", "captured_at");
CREATE INDEX "attendance_device_selfies_purged_at_idx" ON "attendance_device_selfies"("purged_at");

ALTER TABLE "attendance_device_selfies" ADD CONSTRAINT "attendance_device_selfies_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_device_selfies" ADD CONSTRAINT "attendance_device_selfies_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "attendance_device_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
