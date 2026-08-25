-- G06 Department <-> SecuritySite authority foundation.
-- Department remains the existing Employee.department string in this gate.
CREATE TABLE "security_site_departments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "security_site_id" UUID NOT NULL,
  "department_name" VARCHAR(100) NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_site_departments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_site_departments_department_name_nonblank" CHECK (length(btrim("department_name")) > 0)
);

CREATE UNIQUE INDEX "security_site_departments_security_site_id_department_name_key"
  ON "security_site_departments"("security_site_id", "department_name");

CREATE INDEX "security_site_departments_department_name_idx"
  ON "security_site_departments"("department_name");

CREATE INDEX "security_site_departments_department_name_is_default_idx"
  ON "security_site_departments"("department_name", "is_default");

-- Database-level invariant: a Department can have at most one Default/Home Site.
CREATE UNIQUE INDEX "security_site_departments_one_default_per_department_key"
  ON "security_site_departments"("department_name")
  WHERE "is_default" = TRUE;

ALTER TABLE "security_site_departments"
  ADD CONSTRAINT "security_site_departments_security_site_id_fkey"
  FOREIGN KEY ("security_site_id") REFERENCES "security_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
