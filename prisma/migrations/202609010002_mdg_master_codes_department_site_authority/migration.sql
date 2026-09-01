-- MDG-01B stable Personnel Master codes + Department Master -> Security Site authority.
-- Additive only. Legacy names remain for historical compatibility.

ALTER TABLE "department_master" ADD COLUMN "code" VARCHAR(50);
ALTER TABLE "position_master" ADD COLUMN "code" VARCHAR(50);

UPDATE "department_master" SET "code" = 'DEP-' || UPPER(SUBSTRING(REPLACE("id"::text, '-', '') FROM 1 FOR 8)) WHERE "code" IS NULL;
UPDATE "position_master" SET "code" = 'POS-' || UPPER(SUBSTRING(REPLACE("id"::text, '-', '') FROM 1 FOR 8)) WHERE "code" IS NULL;

ALTER TABLE "department_master" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "position_master" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "department_master_code_key" ON "department_master"("code");
CREATE UNIQUE INDEX "position_master_code_key" ON "position_master"("code");

ALTER TABLE "security_site_departments" ADD COLUMN "department_master_id" UUID;

UPDATE "security_site_departments" ssd
SET "department_master_id" = dm."id"
FROM "department_master" dm
WHERE lower(btrim(ssd."department_name")) = dm."normalized_name"
  AND ssd."department_master_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "security_site_departments" WHERE "department_master_id" IS NULL) THEN
    RAISE EXCEPTION 'MDG-01B backfill failed: security_site_departments contains Department values not present in department_master';
  END IF;
END $$;

ALTER TABLE "security_site_departments" ALTER COLUMN "department_master_id" SET NOT NULL;
ALTER TABLE "security_site_departments" ADD CONSTRAINT "security_site_departments_department_master_id_fkey" FOREIGN KEY ("department_master_id") REFERENCES "department_master"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "security_site_departments_department_master_id_idx" ON "security_site_departments"("department_master_id");
CREATE UNIQUE INDEX "security_site_departments_security_site_id_department_master_id_key" ON "security_site_departments"("security_site_id", "department_master_id");
CREATE UNIQUE INDEX "security_site_departments_one_default_per_department_master_key" ON "security_site_departments"("department_master_id") WHERE "is_default" = TRUE;
