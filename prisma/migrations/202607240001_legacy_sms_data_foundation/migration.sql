-- Preserve the legacy SMS data model without coupling runtime code to Google Sheets.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VIEWER';

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED');

ALTER TABLE "employees"
  ADD COLUMN "legacy_employee_id" VARCHAR(100),
  ADD COLUMN "display_name" VARCHAR(255),
  ADD COLUMN "skill" VARCHAR(255);

CREATE UNIQUE INDEX "employees_legacy_employee_id_key" ON "employees"("legacy_employee_id");

ALTER TABLE "users"
  ADD COLUMN "legacy_user_id" VARCHAR(100),
  ADD COLUMN "employee_id" UUID,
  ADD COLUMN "legacy_role" VARCHAR(50),
  ADD COLUMN "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "password_reset_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "department" VARCHAR(100),
  ADD COLUMN "requested_at" TIMESTAMP(3),
  ADD COLUMN "approved_by_legacy_ref" VARCHAR(255),
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "rejection_reason" VARCHAR(2000),
  ADD COLUMN "legacy_updated_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_legacy_user_id_key" ON "users"("legacy_user_id");
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "shift_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "start_time" VARCHAR(20),
  "end_time" VARCHAR(20),
  "hours" DECIMAL(6,2) NOT NULL,
  "color" VARCHAR(50),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shift_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shift_types_code_key" ON "shift_types"("code");

CREATE TABLE "shift_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "shift_type_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "employee_name_snapshot" VARCHAR(255) NOT NULL,
  "department_snapshot" VARCHAR(100),
  "start_time" VARCHAR(20),
  "end_time" VARCHAR(20),
  "hours" DECIMAL(6,2) NOT NULL,
  "remark" VARCHAR(2000),
  "source" VARCHAR(100),
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "updated_by_legacy_ref" VARCHAR(255),
  "legacy_updated_at" TIMESTAMP(3),
  "license_status" VARCHAR(100),
  "license_expiry_date" DATE,
  "license_override" BOOLEAN NOT NULL DEFAULT false,
  "override_reason" VARCHAR(2000),
  "override_by_legacy_ref" VARCHAR(255),
  "override_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shift_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shift_assignments_shift_type_id_fkey" FOREIGN KEY ("shift_type_id") REFERENCES "shift_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "shift_assignments_work_date_employee_id_key" ON "shift_assignments"("work_date", "employee_id");
CREATE INDEX "shift_assignments_employee_id_work_date_idx" ON "shift_assignments"("employee_id", "work_date");
CREATE INDEX "shift_assignments_shift_type_id_work_date_idx" ON "shift_assignments"("shift_type_id", "work_date");

CREATE TABLE "employee_licenses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "legacy_license_id" VARCHAR(100) NOT NULL,
  "employee_id" UUID NOT NULL,
  "license_type" VARCHAR(150) NOT NULL,
  "license_number" VARCHAR(255),
  "issue_date" DATE,
  "expiry_date" DATE,
  "status" VARCHAR(100),
  "document_url" VARCHAR(2000),
  "document_migration_status" VARCHAR(40) NOT NULL DEFAULT 'NONE',
  "remark" VARCHAR(2000),
  "updated_by_legacy_ref" VARCHAR(255),
  "legacy_updated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_licenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_licenses_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "employee_licenses_legacy_license_id_key" ON "employee_licenses"("legacy_license_id");
CREATE INDEX "employee_licenses_employee_id_idx" ON "employee_licenses"("employee_id");
CREATE INDEX "employee_licenses_expiry_date_idx" ON "employee_licenses"("expiry_date");

CREATE TABLE "leave_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "employee_id" UUID NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL,
  "employee_name_snapshot" VARCHAR(255) NOT NULL,
  "department_snapshot" VARCHAR(100),
  "leave_type" VARCHAR(100) NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "day_count" DECIMAL(6,2) NOT NULL,
  "reason" VARCHAR(2000),
  "attachment_url" VARCHAR(2000),
  "attachment_migration_status" VARCHAR(40) NOT NULL DEFAULT 'NONE',
  "status" VARCHAR(100) NOT NULL,
  "approved_by_legacy_ref" VARCHAR(255),
  "approved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_requests_date_order_check" CHECK ("end_date" >= "start_date"),
  CONSTRAINT "leave_requests_day_count_check" CHECK ("day_count" >= 0)
);
CREATE UNIQUE INDEX "leave_requests_source_fingerprint_key" ON "leave_requests"("source_fingerprint");
CREATE INDEX "leave_requests_employee_id_start_date_idx" ON "leave_requests"("employee_id", "start_date");
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

CREATE TABLE "leave_quotas" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "employee_id" UUID,
  "employee_name_snapshot" VARCHAR(255) NOT NULL,
  "sick_leave" DECIMAL(7,2) NOT NULL,
  "personal_leave" DECIMAL(7,2) NOT NULL,
  "vacation_leave" DECIMAL(7,2) NOT NULL,
  "match_status" VARCHAR(30) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_quotas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_quotas_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "leave_quotas_source_fingerprint_key" ON "leave_quotas"("source_fingerprint");
CREATE INDEX "leave_quotas_employee_id_idx" ON "leave_quotas"("employee_id");
CREATE INDEX "leave_quotas_match_status_idx" ON "leave_quotas"("match_status");

CREATE TABLE "schedule_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "month" DATE NOT NULL,
  "status" VARCHAR(100) NOT NULL,
  "revision" INTEGER NOT NULL,
  "changed_by_legacy_ref" VARCHAR(255),
  "changed_at" TIMESTAMP(3),
  "change_type" VARCHAR(100),
  "approved_by_legacy_ref" VARCHAR(255),
  "approved_at" TIMESTAMP(3),
  "approval_note" VARCHAR(2000),
  "schedule_hash" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "schedule_approvals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "schedule_approvals_month_revision_key" ON "schedule_approvals"("month", "revision");
CREATE INDEX "schedule_approvals_month_status_idx" ON "schedule_approvals"("month", "status");

CREATE TABLE "schedule_approval_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "month" DATE NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" VARCHAR(100),
  "change_type" VARCHAR(100),
  "performed_by_legacy_ref" VARCHAR(255),
  "note" VARCHAR(2000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "schedule_approval_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "schedule_approval_events_source_fingerprint_key" ON "schedule_approval_events"("source_fingerprint");
CREATE INDEX "schedule_approval_events_month_occurred_at_idx" ON "schedule_approval_events"("month", "occurred_at");

CREATE TABLE "scheduling_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rule_id" VARCHAR(100) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "value" VARCHAR(1000) NOT NULL,
  "unit" VARCHAR(100),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "scheduling_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "scheduling_rules_rule_id_key" ON "scheduling_rules"("rule_id");

CREATE TABLE "system_settings" (
  "key" VARCHAR(150) NOT NULL,
  "value" VARCHAR(2000) NOT NULL,
  "description" VARCHAR(2000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "legacy_user_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "legacy_user_id" VARCHAR(100),
  "email_snapshot" VARCHAR(255),
  "role_snapshot" VARCHAR(50),
  "department_snapshot" VARCHAR(100),
  "reason" VARCHAR(2000),
  "performed_by_legacy_ref" VARCHAR(255),
  "legacy_employee_id" VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_user_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legacy_user_audit_events_source_fingerprint_key" ON "legacy_user_audit_events"("source_fingerprint");
CREATE INDEX "legacy_user_audit_events_legacy_user_id_occurred_at_idx" ON "legacy_user_audit_events"("legacy_user_id", "occurred_at");
CREATE INDEX "legacy_user_audit_events_action_occurred_at_idx" ON "legacy_user_audit_events"("action", "occurred_at");

CREATE TABLE "legacy_license_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_fingerprint" VARCHAR(64) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "legacy_employee_id" VARCHAR(100),
  "legacy_license_id" VARCHAR(100),
  "work_date" DATE,
  "shift_code" VARCHAR(50),
  "license_status" VARCHAR(100),
  "expiry_date" DATE,
  "reason" VARCHAR(2000),
  "approved_by_legacy_ref" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_license_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legacy_license_audit_events_source_fingerprint_key" ON "legacy_license_audit_events"("source_fingerprint");
CREATE INDEX "legacy_license_audit_events_legacy_employee_id_occurred_at_idx" ON "legacy_license_audit_events"("legacy_employee_id", "occurred_at");
CREATE INDEX "legacy_license_audit_events_action_occurred_at_idx" ON "legacy_license_audit_events"("action", "occurred_at");
