-- Employee Master Governed Edit V1: additive workflow and immutable revision history.
ALTER TYPE "EmployeeLifecycleEventType" ADD VALUE IF NOT EXISTS 'MASTER_EDIT';

CREATE TYPE "EmployeeChangeRequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "EmployeeChangeEffectiveMode" AS ENUM ('IMMEDIATE', 'FUTURE_EFFECTIVE');
CREATE TYPE "EmployeeChangeEventAction" AS ENUM ('DRAFT_SAVED', 'SUBMIT', 'RETURN_FOR_CORRECTION', 'RESUBMIT', 'APPROVE', 'REJECT', 'CANCEL', 'STALE_CONFLICT', 'APPLY_EFFECTIVE');

CREATE TABLE "employee_change_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "status" "EmployeeChangeRequestStatus" NOT NULL DEFAULT 'DRAFT',
  "request_owner_user_id" UUID NOT NULL,
  "request_owner_role_snapshot" VARCHAR(50) NOT NULL,
  "active_employee_id" UUID,
  "current_revision" INTEGER NOT NULL DEFAULT 0,
  "approved_revision" INTEGER,
  "draft_proposal" JSONB,
  "draft_effective_mode" "EmployeeChangeEffectiveMode" NOT NULL DEFAULT 'IMMEDIATE',
  "draft_effective_date" DATE,
  "draft_reason" VARCHAR(1000),
  "last_reviewer_comment" VARCHAR(1000),
  "approved_at" TIMESTAMP(3),
  "applied_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_change_requests_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "employee_change_request_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "base_employee_updated_at" TIMESTAMP(3) NOT NULL,
  "base_lifecycle_sequence" INTEGER NOT NULL,
  "before_snapshot" JSONB NOT NULL,
  "after_snapshot" JSONB NOT NULL,
  "changed_fields" JSONB NOT NULL,
  "effective_mode" "EmployeeChangeEffectiveMode" NOT NULL,
  "effective_date" DATE,
  "reason" VARCHAR(1000),
  "submitted_by_user_id" UUID NOT NULL,
  "submitted_by_role_snapshot" VARCHAR(50) NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proposal_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_change_request_revisions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "employee_change_request_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "revision" INTEGER,
  "action" "EmployeeChangeEventAction" NOT NULL,
  "from_status" "EmployeeChangeRequestStatus",
  "to_status" "EmployeeChangeRequestStatus",
  "actor_user_id" UUID,
  "actor_role_snapshot" VARCHAR(50),
  "reason" VARCHAR(1000),
  "metadata" JSONB,
  "idempotency_key" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_change_request_events_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "employee_lifecycle_events" ADD COLUMN "source_change_request_id" UUID, ADD COLUMN "source_change_request_revision" INTEGER;
CREATE UNIQUE INDEX "employee_change_requests_active_employee_id_key" ON "employee_change_requests"("active_employee_id");
CREATE INDEX "employee_change_requests_employee_id_created_at_idx" ON "employee_change_requests"("employee_id", "created_at");
CREATE INDEX "employee_change_requests_status_created_at_idx" ON "employee_change_requests"("status", "created_at");
CREATE INDEX "employee_change_requests_request_owner_user_id_status_created_at_idx" ON "employee_change_requests"("request_owner_user_id", "status", "created_at");
CREATE UNIQUE INDEX "employee_change_request_revisions_request_id_revision_key" ON "employee_change_request_revisions"("request_id", "revision");
CREATE INDEX "employee_change_request_revisions_submitted_by_user_id_submitted_at_idx" ON "employee_change_request_revisions"("submitted_by_user_id", "submitted_at");
CREATE UNIQUE INDEX "employee_change_request_events_idempotency_key_key" ON "employee_change_request_events"("idempotency_key");
CREATE INDEX "employee_change_request_events_request_id_created_at_idx" ON "employee_change_request_events"("request_id", "created_at");
CREATE INDEX "employee_change_request_events_employee_id_created_at_idx" ON "employee_change_request_events"("employee_id", "created_at");
CREATE INDEX "employee_change_request_events_action_created_at_idx" ON "employee_change_request_events"("action", "created_at");
CREATE INDEX "employee_lifecycle_events_source_change_request_id_source_change_request_revision_idx" ON "employee_lifecycle_events"("source_change_request_id", "source_change_request_revision");
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_change_requests" ADD CONSTRAINT "employee_change_requests_request_owner_user_id_fkey" FOREIGN KEY ("request_owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_change_request_revisions" ADD CONSTRAINT "employee_change_request_revisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "employee_change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_change_request_revisions" ADD CONSTRAINT "employee_change_request_revisions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_change_request_events" ADD CONSTRAINT "employee_change_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "employee_change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_change_request_events" ADD CONSTRAINT "employee_change_request_events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_change_request_events" ADD CONSTRAINT "employee_change_request_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_lifecycle_events" ADD CONSTRAINT "employee_lifecycle_events_source_change_request_id_fkey" FOREIGN KEY ("source_change_request_id") REFERENCES "employee_change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
