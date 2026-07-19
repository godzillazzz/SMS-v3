-- SMS v3 Backend Foundation Hardening (Review Gate 1)
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "token_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failed_login_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_user_id" UUID;

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGIN_FAILED';

CREATE INDEX IF NOT EXISTS "employees_is_active_deleted_at_idx" ON "employees"("is_active", "deleted_at");
CREATE INDEX IF NOT EXISTS "employees_department_idx" ON "employees"("department");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");
