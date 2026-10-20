-- Additive role/action selfie policy. Defaults are provisioned for every UserRole.
CREATE TABLE public."attendance_selfie_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "role" "UserRole" NOT NULL,
  "clock_in_required" BOOLEAN NOT NULL DEFAULT false,
  "clock_out_required" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by_user_id" UUID,
  CONSTRAINT "attendance_selfie_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_selfie_policies_role_key" UNIQUE ("role"),
  CONSTRAINT "attendance_selfie_policies_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES public."users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "attendance_selfie_policies_updated_by_user_id_idx"
  ON public."attendance_selfie_policies"("updated_by_user_id");
INSERT INTO public."attendance_selfie_policies" ("role", "clock_in_required", "clock_out_required")
VALUES ('ADMIN', false, false), ('MANAGER', false, false), ('SUPERVISOR', false, false), ('VIEWER', false, false)
ON CONFLICT ("role") DO NOTHING;
ALTER TABLE public."attendance_selfie_policies" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON TABLE public."attendance_selfie_policies" FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON TABLE public."attendance_selfie_policies" FROM authenticated'; END IF;
END $$;
