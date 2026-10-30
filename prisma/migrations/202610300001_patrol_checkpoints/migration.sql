-- Patrol checkpoints (QR) and patrol scans with mandatory checkpoint photo.
-- Additive only: creates two new tables; no existing table, column or row is changed.
BEGIN;

CREATE TABLE "patrol_checkpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "department" VARCHAR(100) NOT NULL,
    "location_note" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "qr_token" VARCHAR(64) NOT NULL,
    "qr_version" INTEGER NOT NULL DEFAULT 1,
    "qr_rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patrol_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patrol_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkpoint_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "scanned_by_user_id" UUID,
    "client_scan_id" UUID NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "work_date" DATE NOT NULL,
    "checkpoint_department" VARCHAR(100) NOT NULL,
    "employee_department" VARCHAR(100),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "accuracy_meters" INTEGER,
    "note" VARCHAR(500),
    "photo_storage_provider" VARCHAR(20) NOT NULL,
    "photo_bucket" VARCHAR(255) NOT NULL,
    "photo_object_key" VARCHAR(500) NOT NULL,
    "photo_mime_type" VARCHAR(50) NOT NULL,
    "photo_size_bytes" INTEGER NOT NULL,
    "photo_checksum" CHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patrol_scans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patrol_checkpoints_code_key" ON "patrol_checkpoints"("code");
CREATE UNIQUE INDEX "patrol_checkpoints_qr_token_key" ON "patrol_checkpoints"("qr_token");
CREATE INDEX "patrol_checkpoints_department_is_active_sort_order_idx" ON "patrol_checkpoints"("department", "is_active", "sort_order");
CREATE UNIQUE INDEX "patrol_scans_client_scan_id_key" ON "patrol_scans"("client_scan_id");
CREATE UNIQUE INDEX "patrol_scans_photo_object_key_key" ON "patrol_scans"("photo_object_key");
CREATE INDEX "patrol_scans_work_date_checkpoint_id_idx" ON "patrol_scans"("work_date", "checkpoint_id");
CREATE INDEX "patrol_scans_checkpoint_id_scanned_at_idx" ON "patrol_scans"("checkpoint_id", "scanned_at");
CREATE INDEX "patrol_scans_employee_id_scanned_at_idx" ON "patrol_scans"("employee_id", "scanned_at");

ALTER TABLE "patrol_scans" ADD CONSTRAINT "patrol_scans_checkpoint_id_fkey" FOREIGN KEY ("checkpoint_id") REFERENCES "patrol_checkpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "patrol_scans" ADD CONSTRAINT "patrol_scans_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
