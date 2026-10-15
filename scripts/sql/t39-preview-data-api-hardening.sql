-- T39 Preview-only Data API / RLS hardening.
-- This file is intentionally outside prisma/migrations so the Production
-- Prisma migration pipeline cannot apply it implicitly.
-- Application authority remains the SMS-v3 backend/Prisma connection.
-- Browser Data API roles are deny-by-default; no anon/authenticated RLS
-- policies are created by this change.

DO $t39_guard$
DECLARE
  actual_cluster_fingerprint text;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'T39_PREVIEW_DATABASE_GUARD_FAILED';
  END IF;

  SELECT encode(
    sha256(convert_to((pg_control_system()).system_identifier::text, 'UTF8')),
    'hex'
  )
  INTO actual_cluster_fingerprint;

  IF actual_cluster_fingerprint <> 'a96200459370c855ff978934689acb140b1c8573e623696cd854c76afa72fc76' THEN
    RAISE EXCEPTION 'T39_PREVIEW_CLUSTER_GUARD_FAILED';
  END IF;
END
$t39_guard$;

DO $t39_rls$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END
$t39_rls$;

-- Existing Data API object access: deny browser roles.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- Future objects created by the application migration owner must also be
-- opt-in. service_role is deliberately unchanged because server-side
-- Supabase operations use it; browser roles remain denied.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;

-- Fail closed if the intended current-state and postgres-owned future-state
-- protections were not achieved. Supabase-managed supabase_admin defaults are
-- audited separately because postgres is not a member of that platform role.
DO $t39_verify$
DECLARE
  rls_disabled_count integer;
  exposed_relation_acl_count integer;
  exposed_function_count integer;
  unsafe_postgres_default_count integer;
BEGIN
  SELECT count(*)::integer
  INTO rls_disabled_count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity;

  SELECT count(*)::integer
  INTO exposed_relation_acl_count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    AND acl.grantee IN (
      SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated')
    );

  SELECT count(*)::integer
  INTO exposed_function_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))
  ) acl
  WHERE n.nspname = 'public'
    AND acl.privilege_type = 'EXECUTE'
    AND (
      acl.grantee = 0
      OR acl.grantee IN (
        SELECT oid FROM pg_catalog.pg_roles
        WHERE rolname IN ('anon', 'authenticated')
      )
    );

  SELECT count(*)::integer
  INTO unsafe_postgres_default_count
  FROM pg_catalog.pg_default_acl d
  JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) acl
  WHERE d.defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres')
    AND n.nspname = 'public'
    AND (
      acl.grantee IN (
        SELECT oid FROM pg_catalog.pg_roles
        WHERE rolname IN ('anon', 'authenticated')
      )
      OR (d.defaclobjtype = 'f' AND acl.grantee = 0)
    );

  IF rls_disabled_count <> 0 THEN
    RAISE EXCEPTION 'T39_POSTCONDITION_RLS_FAILED';
  END IF;
  IF exposed_relation_acl_count <> 0 THEN
    RAISE EXCEPTION 'T39_POSTCONDITION_RELATION_GRANTS_FAILED';
  END IF;
  IF exposed_function_count <> 0 THEN
    RAISE EXCEPTION 'T39_POSTCONDITION_FUNCTION_GRANTS_FAILED';
  END IF;
  IF unsafe_postgres_default_count <> 0 THEN
    RAISE EXCEPTION 'T39_POSTCONDITION_DEFAULT_GRANTS_FAILED';
  END IF;
END
$t39_verify$;
