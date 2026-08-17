ALTER TABLE "leave_quotas" ADD COLUMN "quota_year" INTEGER;

CREATE UNIQUE INDEX "leave_quotas_employee_id_quota_year_key"
ON "leave_quotas"("employee_id", "quota_year");

CREATE INDEX "leave_quotas_quota_year_idx" ON "leave_quotas"("quota_year");
