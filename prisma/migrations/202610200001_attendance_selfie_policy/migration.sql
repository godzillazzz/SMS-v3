-- Additive role/action selfie policy. Existing objects are validated before use.
DO $$
DECLARE
  table_oid oid;
  rls_enabled boolean;
  expected record;
  actual_type text;
  actual_nullable text;
  actual_default text;
  actual_udt text;
  constraint_name text;
  constraint_def text;
  index_oid oid;
  index_def text;
BEGIN
  SELECT c.oid, c.relrowsecurity INTO table_oid, rls_enabled
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'attendance_selfie_policies' AND c.relkind = 'r';
  IF table_oid IS NULL THEN RETURN; END IF;
  IF rls_enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'attendance_selfie_policies schema drift: RLS must be enabled'; END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('id', 'uuid', false, 'gen_random_uuid'),
    ('role', 'USER-DEFINED', false, NULL),
    ('clock_in_required', 'boolean', false, 'false'),
    ('clock_out_required', 'boolean', false, 'false'),
    ('created_at', 'timestamp with time zone', false, 'current_timestamp'),
    ('updated_at', 'timestamp with time zone', false, 'current_timestamp'),
    ('updated_by_user_id', 'uuid', true, NULL)
  ) AS v(column_name, data_type, nullable, default_marker)
  LOOP
    SELECT c.data_type, c.is_nullable, c.column_default, c.udt_name
      INTO actual_type, actual_nullable, actual_default, actual_udt
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'attendance_selfie_policies' AND c.column_name = expected.column_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'attendance_selfie_policies schema drift: missing column %', expected.column_name; END IF;
    IF actual_type <> expected.data_type
      OR (expected.data_type = 'USER-DEFINED' AND actual_udt <> 'UserRole')
      OR (expected.data_type <> 'USER-DEFINED' AND actual_udt <> CASE expected.data_type WHEN 'uuid' THEN 'uuid' WHEN 'boolean' THEN 'bool' WHEN 'timestamp with time zone' THEN 'timestamptz' ELSE actual_udt END)
      OR ((actual_nullable = 'YES') <> expected.nullable)
      OR (expected.default_marker IS NOT NULL AND (actual_default IS NULL OR lower(actual_default) NOT LIKE '%' || expected.default_marker || '%'))
    THEN RAISE EXCEPTION 'attendance_selfie_policies schema drift: column % has wrong type/nullability/default', expected.column_name; END IF;
  END LOOP;
  SELECT conname, pg_get_constraintdef(oid) INTO constraint_name, constraint_def
    FROM pg_constraint WHERE conrelid = table_oid AND contype = 'p';
  IF constraint_name <> 'attendance_selfie_policies_pkey' OR constraint_def NOT ILIKE '%PRIMARY KEY (id)%' THEN RAISE EXCEPTION 'attendance_selfie_policies schema drift: primary key'; END IF;
  SELECT conname, pg_get_constraintdef(oid) INTO constraint_name, constraint_def
    FROM pg_constraint WHERE conrelid = table_oid AND contype = 'u' AND conname = 'attendance_selfie_policies_role_key';
  IF constraint_name IS NULL OR constraint_def NOT ILIKE '%UNIQUE (role)%' THEN RAISE EXCEPTION 'attendance_selfie_policies schema drift: role unique constraint'; END IF;
  SELECT pg_get_constraintdef(oid) INTO constraint_def
    FROM pg_constraint WHERE conrelid = table_oid AND conname = 'attendance_selfie_policies_updated_by_user_id_fkey' AND contype = 'f';
  IF constraint_def IS NULL OR constraint_def NOT ILIKE '%FOREIGN KEY (updated_by_user_id)%' OR constraint_def NOT ILIKE '%REFERENCES%users(id)%' OR constraint_def NOT ILIKE '%ON DELETE SET NULL%' THEN RAISE EXCEPTION 'attendance_selfie_policies schema drift: updated_by_user_id foreign key'; END IF;
  SELECT i.indexrelid, pg_get_indexdef(i.indexrelid) INTO index_oid, index_def
    FROM pg_index i WHERE i.indexrelid::regclass::text = 'attendance_selfie_policies_updated_by_user_id_idx';
  IF index_oid IS NULL OR index_def NOT ILIKE '%updated_by_user_id%' THEN RAISE EXCEPTION 'attendance_selfie_policies schema drift: updated_by_user_id index'; END IF;
END $$;
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
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON TABLE public."attendance_selfie_policies" FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON TABLE public."attendance_selfie_policies" FROM authenticated'; END IF;
END $$;