CREATE TABLE "leave_type_master" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "quota_bucket" VARCHAR(20) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_type_master_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_type_master_code_key" ON "leave_type_master"("code");
CREATE INDEX "leave_type_master_is_active_sort_order_idx" ON "leave_type_master"("is_active", "sort_order");

ALTER TABLE "leave_requests"
  ADD COLUMN "leave_type_id" UUID,
  ADD COLUMN "leave_type_name_snapshot" VARCHAR(150),
  ADD COLUMN "leave_quota_bucket_snapshot" VARCHAR(20);

INSERT INTO "leave_type_master" ("code", "name", "quota_bucket", "is_active", "is_system", "sort_order")
VALUES
  ('SICK', 'ลาป่วย', 'SICK', true, true, 10),
  ('PERSONAL', 'ลากิจ', 'PERSONAL', true, true, 20),
  ('VACATION', 'ลาพักร้อน', 'VACATION', true, true, 30)
ON CONFLICT ("code") DO NOTHING;

UPDATE "leave_requests" AS lr
SET
  "leave_type_id" = ltm."id",
  "leave_type_name_snapshot" = ltm."name",
  "leave_quota_bucket_snapshot" = ltm."quota_bucket"
FROM "leave_type_master" AS ltm
WHERE ltm."code" = CASE
  WHEN upper(trim(lr."leave_type")) = 'SICK' OR lr."leave_type" ILIKE '%ป่วย%' THEN 'SICK'
  WHEN upper(trim(lr."leave_type")) = 'PERSONAL' OR lr."leave_type" ILIKE '%กิจ%' THEN 'PERSONAL'
  WHEN upper(trim(lr."leave_type")) = 'VACATION' OR lr."leave_type" ILIKE '%พักร้อน%' THEN 'VACATION'
  ELSE NULL
END;

UPDATE "leave_requests"
SET "leave_type_name_snapshot" = "leave_type"
WHERE "leave_type_name_snapshot" IS NULL;

CREATE INDEX "leave_requests_leave_type_id_idx" ON "leave_requests"("leave_type_id");

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_leave_type_id_fkey"
  FOREIGN KEY ("leave_type_id") REFERENCES "leave_type_master"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
