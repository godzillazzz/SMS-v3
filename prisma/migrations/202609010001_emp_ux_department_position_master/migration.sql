CREATE TABLE "department_master" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "normalized_name" VARCHAR(100) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "department_master_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "department_master_normalized_name_key" ON "department_master"("normalized_name");
CREATE INDEX "department_master_is_active_sort_order_name_idx" ON "department_master"("is_active", "sort_order", "name");

CREATE TABLE "position_master" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(100) NOT NULL,
  "normalized_name" VARCHAR(100) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "position_master_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "position_master_normalized_name_key" ON "position_master"("normalized_name");
CREATE INDEX "position_master_is_active_sort_order_name_idx" ON "position_master"("is_active", "sort_order", "name");

INSERT INTO "department_master" ("name", "normalized_name")
SELECT MIN(BTRIM("department")), LOWER(BTRIM("department"))
FROM "employees"
WHERE "department" IS NOT NULL AND BTRIM("department") <> ''
GROUP BY LOWER(BTRIM("department"))
ON CONFLICT ("normalized_name") DO NOTHING;

INSERT INTO "position_master" ("name", "normalized_name")
SELECT MIN(BTRIM("job_title")), LOWER(BTRIM("job_title"))
FROM "employees"
WHERE "job_title" IS NOT NULL AND BTRIM("job_title") <> ''
GROUP BY LOWER(BTRIM("job_title"))
ON CONFLICT ("normalized_name") DO NOTHING;
