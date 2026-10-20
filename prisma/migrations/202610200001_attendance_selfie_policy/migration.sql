-- Additive role/action selfie policy. Defaults are provisioned for every UserRole.
CREATE TABLE IF NOT EXISTS public."attendance_selfie_policies" (
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
CREATE INDEX IF NOT EXISTS "attendance_selfie_policies_updated_by_user_id_idx"
  ON public."attendance_selfie_policies"("updated_by_user_id");
INSERT INTO public."attendance_selfie_policies" ("role", "clock_in_required", "clock_out_required")
VALUES ('ADMIN', false, false), ('MANAGER', false, false), ('SUPERVISOR', false, false), ('VIEWER', false, false)
ON CONFLICT ("role") DO NOTHING;
ALTER TABLE public."attendance_selfie_policies" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(required_name, ', ' ORDER BY required_name) INTO missing
  FROM (VALUES
    ('id'), ('role'), ('clock_in_required'), ('clock_out_required'),
    ('created_at'), ('updated_at'), ('updated_by_user_id')
  ) AS required(required_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'attendance_selfie_policies'
      AND c.column_name = required.required_name
  );
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'attendance_selfie_policies schema drift: missing columns %', missing; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_selfie_policies_pkey' AND conrelid = 'public.attendance_selfie_policies'::regclass) THEN
    RAISE EXCEPTION 'attendance_selfie_policies schema drift: missing primary key';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_selfie_policies_role_key' AND conrelid = 'public.attendance_selfie_policies'::regclass) THEN
    RAISE EXCEPTION 'attendance_selfie_policies schema drift: missing role unique constraint';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_selfie_policies_updated_by_user_id_fkey' AND conrelid = 'public.attendance_selfie_policies'::regclass) THEN
    RAISE EXCEPTION 'attendance_selfie_policies schema drift: missing updated_by_user_id foreign key';
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON TABLE public."attendance_selfie_policies" FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON TABLE public."attendance_selfie_policies" FROM authenticated'; END IF;
END $$;
