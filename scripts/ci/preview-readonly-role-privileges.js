'use strict';

const EXPECTED_ROLE = 'smsv3_preview_attendance_inspector';

const PUBLIC_MUTATION_SURFACE_SQL = `
SELECT
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1) AS role_already_exists,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.datacl) acl
    WHERE d.datname = current_database() AND acl.grantee = 0::oid AND acl.privilege_type = 'CREATE'
  ) AS public_database_create,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d
    WHERE d.datname = current_database() AND (d.datacl IS NULL OR EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(d.datacl) acl
      WHERE acl.grantee = 0::oid AND acl.privilege_type IN ('TEMP', 'TEMPORARY')
    ))
  ) AS public_database_temp,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d
    WHERE d.datallowconn AND NOT d.datistemplate AND d.datname <> current_database()
      AND (d.datacl IS NULL OR EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(d.datacl) acl
        WHERE acl.grantee = 0::oid AND acl.privilege_type = 'CONNECT'
      ))
  ) AS public_other_database_connect,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_tablespace t
    CROSS JOIN LATERAL pg_catalog.aclexplode(t.spcacl) acl
    WHERE acl.grantee = 0::oid AND acl.privilege_type = 'CREATE'
  ) AS public_tablespace_create,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND acl.grantee = 0::oid AND acl.privilege_type = 'CREATE'
  ) AS public_user_schema_create,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
    WHERE n.nspname <> 'public' AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND acl.grantee = 0::oid AND acl.privilege_type = 'USAGE'
  ) AS public_other_user_schema_usage,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (
        EXISTS (
          SELECT 1 FROM pg_catalog.aclexplode(c.relacl) acl
          WHERE acl.grantee = 0::oid AND (
            (NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations') AND acl.privilege_type = 'SELECT')
            OR acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
          )
        )
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            AND EXISTS (
              SELECT 1 FROM pg_catalog.aclexplode(a.attacl) acl
              WHERE acl.grantee = 0::oid AND (
                (NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations') AND acl.privilege_type = 'SELECT')
                OR acl.privilege_type IN ('INSERT', 'UPDATE', 'REFERENCES')
              )
            )
        )
      )
  ) AS public_user_relation_privilege,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND (p.proacl IS NULL OR EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(p.proacl) acl
        WHERE acl.grantee = 0::oid AND acl.privilege_type = 'EXECUTE'
      ))
  ) AS public_security_definer_execution,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_largeobject_metadata l
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(l.lomacl, pg_catalog.acldefault('L', l.lomowner))
    ) acl
    WHERE acl.grantee = 0::oid AND acl.privilege_type IN ('SELECT', 'UPDATE')
  ) AS public_large_object_privilege,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pg_catalog'
      AND p.proname = ANY($2::text[])
      AND (p.proacl IS NULL OR EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(p.proacl) acl
        WHERE acl.grantee = 0::oid AND acl.privilege_type = 'EXECUTE'
      ))
  ) AS public_large_object_mutator_execution`;

const PUBLIC_MUTATING_FUNCTION_NAMES = Object.freeze([
  'lo_create', 'lo_creat', 'lo_from_bytea', 'lo_put', 'lo_unlink',
  'lowrite', 'lo_truncate', 'lo_import', 'lo_import_with_oid',
]);

const PUBLIC_MUTATION_CHECKS = Object.freeze({
  role_already_exists: false,
  public_database_create: false,
  public_database_temp: false,
  public_other_database_connect: false,
  public_tablespace_create: false,
  public_user_schema_create: false,
  public_other_user_schema_usage: false,
  public_user_relation_privilege: false,
  public_security_definer_execution: false,
  public_large_object_privilege: false,
  public_large_object_mutator_execution: false,
});

function evaluatePublicMutationSurface(facts) {
  const checks = {};
  for (const [name, expected] of Object.entries(PUBLIC_MUTATION_CHECKS)) checks[name] = facts?.[name] === expected;
  return { passed: Object.values(checks).every(Boolean), checks };
}

async function inspectPublicMutationSurface(client, expectedRole = EXPECTED_ROLE) {
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN READ ONLY');
    const result = await client.query(PUBLIC_MUTATION_SURFACE_SQL, [expectedRole, PUBLIC_MUTATING_FUNCTION_NAMES]);
    if (!Array.isArray(result?.rows) || result.rows.length !== 1) {
      return { passed: false, category: 'PUBLIC_PRIVILEGE_RESULT_MALFORMED', checks: {} };
    }
    const proof = evaluatePublicMutationSurface(result.rows[0]);
    return { ...proof, category: proof.passed ? 'PUBLIC_MUTATION_SURFACE_CLEAR' : 'PUBLIC_MUTATION_PRIVILEGE_PRESENT' };
  } catch (error) {
    return { passed: false, category: safeFailureCategory(error), checks: {} };
  } finally {
    if (connected) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  }
}

const PRIVILEGE_FACTS_SQL = `
WITH current_role AS (
  SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
  FROM pg_catalog.pg_roles WHERE rolname = current_user
)
SELECT
  r.rolname = $1 AS expected_role,
  NOT r.rolsuper AS no_superuser,
  NOT r.rolcreaterole AS no_create_role,
  NOT r.rolcreatedb AS no_create_database,
  NOT r.rolreplication AS no_replication,
  NOT r.rolbypassrls AS no_bypass_rls,
  NOT r.rolinherit AS no_role_inheritance,
  current_setting('transaction_read_only') = 'on' AS transaction_read_only,
  current_setting('default_transaction_read_only') = 'on' AS default_transaction_read_only,
  has_database_privilege(r.rolname, current_database(), 'CONNECT') AS can_connect,
  has_database_privilege(r.rolname, current_database(), 'CREATE') AS database_create,
  has_database_privilege(r.rolname, current_database(), 'TEMP') AS database_temp,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d
    WHERE d.datallowconn AND NOT d.datistemplate AND d.datname <> current_database()
      AND has_database_privilege(r.rolname, d.oid, 'CONNECT')
  ) AS no_other_database_connect,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_tablespace t
    WHERE has_tablespace_privilege(r.rolname, t.oid, 'CREATE')
  ) AS no_tablespace_create,
  has_schema_privilege(r.rolname, 'public', 'USAGE') AS public_schema_usage,
  has_schema_privilege(r.rolname, 'public', 'CREATE') AS public_schema_create,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname <> 'public' AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND has_schema_privilege(r.rolname, n.oid, 'USAGE')
  ) AS no_other_user_schema_usage,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND has_schema_privilege(r.rolname, n.oid, 'CREATE')
  ) AS no_user_schema_create,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (
        (NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations') AND has_table_privilege(r.rolname, c.oid, 'SELECT'))
        OR has_table_privilege(r.rolname, c.oid, 'INSERT')
        OR has_table_privilege(r.rolname, c.oid, 'UPDATE')
        OR has_table_privilege(r.rolname, c.oid, 'DELETE')
        OR has_table_privilege(r.rolname, c.oid, 'TRUNCATE')
        OR has_table_privilege(r.rolname, c.oid, 'REFERENCES')
        OR has_table_privilege(r.rolname, c.oid, 'TRIGGER')
        OR EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            AND (
              (NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations')
                AND has_column_privilege(r.rolname, c.oid, a.attnum, 'SELECT'))
              OR has_column_privilege(r.rolname, c.oid, a.attnum, 'INSERT')
              OR has_column_privilege(r.rolname, c.oid, a.attnum, 'UPDATE')
              OR has_column_privilege(r.rolname, c.oid, a.attnum, 'REFERENCES')
            )
        )
      )
  ) AS no_relation_data_or_mutation_privilege,
  NOT has_table_privilege(r.rolname, 'public._prisma_migrations', 'INSERT')
    AND NOT has_table_privilege(r.rolname, 'public._prisma_migrations', 'UPDATE')
    AND NOT has_table_privilege(r.rolname, 'public._prisma_migrations', 'DELETE')
    AND NOT has_table_privilege(r.rolname, 'public._prisma_migrations', 'TRUNCATE')
    AND NOT has_table_privilege(r.rolname, 'public._prisma_migrations', 'REFERENCES')
    AND NOT has_table_privilege(r.rolname, 'public._prisma_migrations', 'TRIGGER')
    AS ledger_select_only,
  has_table_privilege(r.rolname, 'public._prisma_migrations', 'SELECT') AS ledger_select,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND c.relkind = 'S'
      AND (has_sequence_privilege(r.rolname, c.oid, 'SELECT')
        OR has_sequence_privilege(r.rolname, c.oid, 'USAGE')
        OR has_sequence_privilege(r.rolname, c.oid, 'UPDATE'))
  ) AS no_sequence_privileges,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_largeobject_metadata l
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(l.lomacl, pg_catalog.acldefault('L', l.lomowner))
    ) acl
    WHERE acl.grantee IN (r.oid, 0::oid) AND acl.privilege_type IN ('SELECT', 'UPDATE')
  ) AS no_large_object_privileges,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND p.prosecdef
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  ) AS no_user_security_definer_execution,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.prosecdef AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  ) AS no_security_definer_execution,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pg_catalog'
      AND p.proname = ANY($2::text[])
      AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  ) AS no_large_object_mutator_execution,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid
  ) AS no_role_memberships,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname = current_database() AND d.datdba = r.oid
  )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid
        AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relowner = r.oid AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proowner = r.oid AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typowner = r.oid AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_largeobject_metadata l WHERE l.lomowner = r.oid
    ) AS no_object_ownership,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.datacl) acl
    WHERE d.datname = current_database() AND acl.grantee = r.oid AND acl.is_grantable
  )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) acl
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND acl.grantee = r.oid AND acl.is_grantable
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND acl.grantee = r.oid AND acl.is_grantable
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND acl.grantee = r.oid AND acl.is_grantable
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(t.typacl) acl
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND acl.grantee = r.oid AND acl.is_grantable
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
      WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_' AND a.attacl IS NOT NULL
        AND acl.grantee = r.oid AND acl.is_grantable
    ) AS no_grant_options
FROM current_role r`;

const PROOF_CHECKS = Object.freeze({
  expected_role: true,
  no_superuser: true,
  no_create_role: true,
  no_create_database: true,
  no_replication: true,
  no_bypass_rls: true,
  no_role_inheritance: true,
  transaction_read_only: true,
  default_transaction_read_only: true,
  can_connect: true,
  database_create: false,
  database_temp: false,
  no_other_database_connect: true,
  no_tablespace_create: true,
  public_schema_usage: true,
  public_schema_create: false,
  no_other_user_schema_usage: true,
  no_user_schema_create: true,
  no_relation_data_or_mutation_privilege: true,
  ledger_select_only: true,
  ledger_select: true,
  no_sequence_privileges: true,
  no_large_object_privileges: true,
  no_user_security_definer_execution: true,
  no_security_definer_execution: true,
  no_role_memberships: true,
  no_object_ownership: true,
  no_grant_options: true,
  no_large_object_mutator_execution: true,
});

const PASSIVE_QUERIES = Object.freeze({
  ledger: 'SELECT count(*)::bigint AS row_count FROM public."_prisma_migrations"',
  catalog: 'SELECT 1 AS readable FROM pg_catalog.pg_class LIMIT 1',
});

function evaluatePrivilegeFacts(facts, passive = {}) {
  const checks = {};
  for (const [name, expected] of Object.entries(PROOF_CHECKS)) checks[name] = facts?.[name] === expected;
  checks.ledger_readable = passive.ledgerReadable === true;
  checks.catalog_readable = passive.catalogReadable === true;
  return { passed: Object.values(checks).every(Boolean), checks };
}

function safeFailureCategory(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === '28P01' || code === '28000') return 'AUTHENTICATION_FAILED';
  if (code === '42501') return 'PRIVILEGE_CHECK_FAILED';
  if (code === '42883') return 'REQUIRED_CATALOG_FUNCTION_UNAVAILABLE';
  if (/^08[A-Z0-9]{3}$/.test(code) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(code)) return 'CONNECTION_FAILED';
  if (['42P01', '42703', '3F000'].includes(code)) return 'REQUIRED_CATALOG_OBJECT_UNAVAILABLE';
  return 'READ_ONLY_CHECK_FAILED';
}

async function inspectReadOnlyRole(client, expectedRole = EXPECTED_ROLE) {
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN READ ONLY');
    const result = await client.query(PRIVILEGE_FACTS_SQL, [expectedRole, PUBLIC_MUTATING_FUNCTION_NAMES]);
    const facts = Array.isArray(result?.rows) && result.rows.length === 1 ? result.rows[0] : null;
    if (!facts) return { passed: false, category: 'PRIVILEGE_RESULT_MALFORMED', checks: {} };
    const ledgerResult = await client.query(PASSIVE_QUERIES.ledger);
    const catalogResult = await client.query(PASSIVE_QUERIES.catalog);
    const passive = {
      ledgerReadable: Array.isArray(ledgerResult?.rows) && ledgerResult.rows.length === 1,
      catalogReadable: Array.isArray(catalogResult?.rows) && catalogResult.rows.length === 1,
    };
    const proof = evaluatePrivilegeFacts(facts, passive);
    return { ...proof, category: proof.passed ? 'READ_ONLY_PRIVILEGES_PROVEN' : 'PRIVILEGE_INVARIANT_FAILED' };
  } catch (error) {
    return { passed: false, category: safeFailureCategory(error), checks: {} };
  } finally {
    if (connected) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  }
}

module.exports = {
  EXPECTED_ROLE,
  PUBLIC_MUTATION_CHECKS,
  PUBLIC_MUTATING_FUNCTION_NAMES,
  PUBLIC_MUTATION_SURFACE_SQL,
  PASSIVE_QUERIES,
  PRIVILEGE_FACTS_SQL,
  PROOF_CHECKS,
  evaluatePrivilegeFacts,
  evaluatePublicMutationSurface,
  inspectPublicMutationSurface,
  inspectReadOnlyRole,
  safeFailureCategory,
};
