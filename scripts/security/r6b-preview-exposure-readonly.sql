-- R6-B Preview public schema audit (READ ONLY; no DDL, no business rows).
-- Run only in the provider-confirmed Supabase Preview project:
-- ezxanpfagitckpfsnflp. The caller must authenticate the project scope.
-- Neither project name nor database name proves effective Vercel runtime scope.

SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  (SELECT count(*) FROM pg_policies p
   WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS policy_count,
  has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
  has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
  has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
  has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- Private storage metadata: does not inspect Storage objects.
SELECT b.id, b.public AS bucket_is_public, c.relrowsecurity AS storage_objects_rls
FROM storage.buckets b
JOIN pg_class c ON c.relname = 'objects'
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'storage'
WHERE b.id = 'license-documents-g05-preview';
