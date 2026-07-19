CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'HR', 'USER');
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "email" VARCHAR(255) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL, "display_name" VARCHAR(150) NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'USER', "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "employees" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "employee_code" VARCHAR(50) NOT NULL,
  "first_name" VARCHAR(100) NOT NULL, "last_name" VARCHAR(100) NOT NULL,
  "email" VARCHAR(255), "phone" VARCHAR(50), "department" VARCHAR(100),
  "job_title" VARCHAR(100), "hired_at" DATE, "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "actor_user_id" UUID, "action" "AuditAction" NOT NULL,
  "entity_type" VARCHAR(100) NOT NULL, "entity_id" VARCHAR(100) NOT NULL, "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");
