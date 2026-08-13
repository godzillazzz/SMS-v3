CREATE TYPE "EmployeeLifecycleEventType" AS ENUM (
  'DEPARTMENT_TRANSFER',
  'NAME_CHANGE',
  'POSITION_CHANGE',
  'EMPLOYMENT_TERMINATION',
  'REHIRE'
);

CREATE TYPE "EmployeeLifecycleEventStatus" AS ENUM ('PENDING', 'APPLIED');

ALTER TABLE "users"
  ADD COLUMN "employment_suspended_at" TIMESTAMP(3);

CREATE TABLE "employee_lifecycle_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employee_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "EmployeeLifecycleEventType" NOT NULL,
  "status" "EmployeeLifecycleEventStatus" NOT NULL DEFAULT 'PENDING',
  "effective_date" DATE NOT NULL,
  "old_value" JSONB NOT NULL,
  "new_value" JSONB NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "changed_by_user_id" UUID NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "expected_employee_updated_at" TIMESTAMP(3) NOT NULL,
  "applied_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_lifecycle_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_lifecycle_events_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_lifecycle_events_changed_by_user_id_fkey"
    FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "employee_lifecycle_events_idempotency_key_key"
  ON "employee_lifecycle_events"("idempotency_key");

CREATE UNIQUE INDEX "employee_lifecycle_events_employee_id_sequence_key"
  ON "employee_lifecycle_events"("employee_id", "sequence");

CREATE INDEX "employee_lifecycle_events_employee_id_effective_date_sequence_idx"
  ON "employee_lifecycle_events"("employee_id", "effective_date", "sequence");

CREATE INDEX "employee_lifecycle_events_status_effective_date_idx"
  ON "employee_lifecycle_events"("status", "effective_date");

CREATE INDEX "employee_lifecycle_events_changed_by_user_id_created_at_idx"
  ON "employee_lifecycle_events"("changed_by_user_id", "created_at");
