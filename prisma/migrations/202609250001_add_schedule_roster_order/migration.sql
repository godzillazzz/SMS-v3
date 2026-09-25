ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "schedule_order" INTEGER;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY COALESCE(department, '') ORDER BY employee_code ASC, id ASC) * 10 AS roster_order
  FROM "employees"
  WHERE is_active = TRUE AND deleted_at IS NULL
)
UPDATE "employees" e
SET "schedule_order" = ranked.roster_order
FROM ranked
WHERE e.id = ranked.id
  AND e.schedule_order IS NULL;

CREATE INDEX IF NOT EXISTS "employees_department_schedule_order_idx"
  ON "employees"("department", "schedule_order");

CREATE TABLE IF NOT EXISTS "schedule_roster_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "month" DATE NOT NULL,
  "employee_id" UUID NOT NULL,
  "employee_code_snapshot" VARCHAR(50) NOT NULL,
  "employee_name_snapshot" VARCHAR(255) NOT NULL,
  "department_snapshot" VARCHAR(100),
  "job_title_snapshot" VARCHAR(100),
  "roster_order" INTEGER NOT NULL,
  "source" VARCHAR(50) NOT NULL DEFAULT 'SCHEDULE_CREATE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "schedule_roster_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_roster_snapshots_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "schedule_roster_snapshots_month_employee_id_key"
  ON "schedule_roster_snapshots"("month", "employee_id");
CREATE INDEX IF NOT EXISTS "schedule_roster_snapshots_month_department_snapshot_roster_order_idx"
  ON "schedule_roster_snapshots"("month", "department_snapshot", "roster_order");
CREATE INDEX IF NOT EXISTS "schedule_roster_snapshots_employee_id_month_idx"
  ON "schedule_roster_snapshots"("employee_id", "month");

WITH monthly_people AS (
  SELECT DISTINCT ON (DATE_TRUNC('month', sa.work_date)::date, sa.employee_id)
    DATE_TRUNC('month', sa.work_date)::date AS month,
    sa.employee_id,
    e.employee_code,
    sa.employee_name_snapshot,
    sa.department_snapshot,
    e.job_title,
    sa.work_date
  FROM "shift_assignments" sa
  JOIN "employees" e ON e.id = sa.employee_id
  ORDER BY DATE_TRUNC('month', sa.work_date)::date, sa.employee_id, sa.work_date ASC
), ranked_history AS (
  SELECT month, employee_id, employee_code, employee_name_snapshot, department_snapshot, job_title,
         ROW_NUMBER() OVER (
           PARTITION BY month, COALESCE(department_snapshot, '')
           ORDER BY employee_code ASC, employee_id ASC
         ) * 10 AS roster_order
  FROM monthly_people
)
INSERT INTO "schedule_roster_snapshots" (
  "month", "employee_id", "employee_code_snapshot", "employee_name_snapshot",
  "department_snapshot", "job_title_snapshot", "roster_order", "source", "updated_at"
)
SELECT month, employee_id, employee_code, employee_name_snapshot,
       department_snapshot, job_title, roster_order, 'MIGRATION_BACKFILL', CURRENT_TIMESTAMP
FROM ranked_history
ON CONFLICT ("month", "employee_id") DO NOTHING;