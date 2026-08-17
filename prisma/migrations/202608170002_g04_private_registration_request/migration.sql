CREATE TYPE "RegistrationRequestStatus" AS ENUM ('PENDING', 'MATCHED', 'APPROVED', 'REJECTED');

CREATE TABLE "registration_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submitted_name" VARCHAR(200) NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "password_hash" VARCHAR(255),
  "department_hint" VARCHAR(100),
  "status" "RegistrationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "email_verified_at" TIMESTAMP(3),
  "matched_employee_id" UUID,
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "rejection_reason" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "registration_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registration_requests_matched_employee_id_fkey" FOREIGN KEY ("matched_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "registration_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "registration_requests_email_key" ON "registration_requests"("email");
CREATE INDEX "registration_requests_status_created_at_idx" ON "registration_requests"("status", "created_at");
CREATE INDEX "registration_requests_email_verified_at_status_idx" ON "registration_requests"("email_verified_at", "status");
CREATE INDEX "registration_requests_matched_employee_id_idx" ON "registration_requests"("matched_employee_id");
