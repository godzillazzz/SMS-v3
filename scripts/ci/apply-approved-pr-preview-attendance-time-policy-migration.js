'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { classifyMigrationStatus, loadKnownMigrations } = require('./prisma-migration');

const EXPECTED_MIGRATION = '202610020002_attendance_time_policy_v1';

function runPrisma(args, { env = process.env, run = spawnSync } = {}) {
  const result = run('npx', ['--no-install', 'prisma', ...args], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
    exitCode: typeof result.status === 'number' ? result.status : 1,
  };
}

function classifyBeforeStatus(output, exitCode, expectedMigration = EXPECTED_MIGRATION) {
  const status = classifyMigrationStatus(output, exitCode, { knownMigrations: [expectedMigration] });
  if (status.classification === 'UP_TO_DATE') return { applyNeeded: false, status };
  if (status.classification !== 'PENDING_MIGRATIONS_ONLY'
    || status.migrationNames.length !== 1
    || status.migrationNames[0] !== expectedMigration
    || status.driftDetected
    || status.migrationHistoryMismatch
    || status.schemaMismatch) {
    throw new Error('Preview migration state is not the exact approved pending state');
  }
  return { applyNeeded: true, status };
}

function verifyAfterStatus(output, exitCode, expectedMigration = EXPECTED_MIGRATION) {
  const status = classifyMigrationStatus(output, exitCode, { knownMigrations: [expectedMigration] });
  if (status.classification !== 'UP_TO_DATE' || status.driftDetected || status.migrationHistoryMismatch || status.schemaMismatch) {
    throw new Error('Preview migration did not reach the expected current state');
  }
  return status;
}

async function verifyTimePolicySchema({ prisma, log = console.log }) {
  const ownsClient = !prisma;
  const PrismaClient = ownsClient ? require('@prisma/client').PrismaClient : null;
  const client = prisma || new PrismaClient();
  try {
    const tableRows = await client.$queryRawUnsafe("SELECT to_regclass('public.attendance_time_policies')::text AS name");
    const tableExists = tableRows.some((row) => ['attendance_time_policies', 'public.attendance_time_policies'].includes(String(row?.name || '')));
    if (!tableExists) throw new Error('Expected Preview schema is absent');

    const columnRows = await client.$queryRawUnsafe(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'attendance_time_policies' AND column_name IN ('scope_type', 'site_id', 'shift_type_id', 'policy', 'effective_from'))
          OR (table_name = 'attendance_events' AND column_name IN ('punctuality', 'checkout_condition', 'time_policy_snapshot'))
          OR (table_name = 'attendance_pending_events' AND column_name = 'time_policy_snapshot'))
    `);
    const found = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
    const required = [
      'attendance_time_policies.scope_type', 'attendance_time_policies.site_id', 'attendance_time_policies.shift_type_id',
      'attendance_time_policies.policy', 'attendance_time_policies.effective_from',
      'attendance_events.punctuality', 'attendance_events.checkout_condition', 'attendance_events.time_policy_snapshot',
      'attendance_pending_events.time_policy_snapshot',
    ];
    if (!required.every((column) => found.has(column))) throw new Error('Expected Preview schema columns are absent');

    const rlsRows = await client.$queryRawUnsafe(`
      SELECT c.relrowsecurity AS enabled
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'attendance_time_policies'
    `);
    if (rlsRows.length !== 1 || rlsRows[0].enabled !== true) throw new Error('Expected RLS protection is absent');

    const indexRows = await client.$queryRawUnsafe(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'attendance_time_policies'
    `);
    const indexes = new Set(indexRows.map((row) => String(row.indexname || '')));
    const requiredIndexes = [
      'attendance_time_policies_company_effective_idx', 'attendance_time_policies_company_effective_key',
      'attendance_time_policies_site_effective_idx', 'attendance_time_policies_site_effective_key',
      'attendance_time_policies_shift_effective_idx', 'attendance_time_policies_shift_effective_key',
      'attendance_time_policies_created_by_created_idx',
    ];
    if (!requiredIndexes.every((index) => indexes.has(index))) throw new Error('Expected time policy indexes are absent');

    const constraintRows = await client.$queryRawUnsafe(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid IN ('public.attendance_time_policies'::regclass, 'public.attendance_events'::regclass)
    `);
    const constraints = new Set(constraintRows.map((row) => String(row.conname || '')));
    const requiredConstraints = [
      'attendance_time_policies_pkey', 'attendance_time_policies_scope_check', 'attendance_time_policies_values_check',
      'attendance_time_policies_site_fkey', 'attendance_time_policies_shift_type_fkey', 'attendance_time_policies_created_by_fkey',
      'attendance_events_punctuality_check', 'attendance_events_checkout_condition_check',
    ];
    if (!requiredConstraints.every((constraint) => constraints.has(constraint))) throw new Error('Expected time policy constraints are absent');

    const revokeRows = await client.$queryRawUnsafe(`
      SELECT
        EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'anon' AND (
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'SELECT') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'INSERT') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'UPDATE') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'DELETE') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRUNCATE') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'REFERENCES') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRIGGER')
        )) AS anon_has_any_privilege,
        EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'authenticated' AND (
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'SELECT') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'INSERT') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'UPDATE') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'DELETE') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRUNCATE') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'REFERENCES') OR
          has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRIGGER')
        )) AS authenticated_has_any_privilege
    `);
    if (revokeRows[0]?.anon_has_any_privilege !== false || revokeRows[0]?.authenticated_has_any_privilege !== false) throw new Error('Sensitive table role revokes are absent');

    log('ATTENDANCE_TIME_POLICY_TABLE=PASS');
    log('ATTENDANCE_TIME_POLICY_COLUMNS=PASS');
    log('ATTENDANCE_TIME_POLICY_RLS=PASS');
    log('ATTENDANCE_TIME_POLICY_INDEXES=PASS');
    log('ATTENDANCE_TIME_POLICY_CONSTRAINTS=PASS');
    log('ATTENDANCE_TIME_POLICY_ROLE_REVOKES=PASS');
    log('RAW_ATTENDANCE_OR_POLICY_ROWS_READ=false');
  } catch {
    log('ATTENDANCE_TIME_POLICY_SCHEMA_VERIFICATION=FAIL');
    throw new Error('Preview Attendance Time Policy schema verification failed');
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

async function applyApprovedMigration({ schemaPath, migrationsPath, env = process.env, run = spawnSync, log = console.log } = {}) {
  if (String(env.EXPECTED_MIGRATION_HEAD || EXPECTED_MIGRATION) !== EXPECTED_MIGRATION) throw new Error('Unexpected migration name');
  if (!env.DATABASE_URL || !env.DIRECT_URL) throw new Error('Preview database credentials are unavailable');
  if (!schemaPath || !migrationsPath || !path.isAbsolute(schemaPath) || !path.isAbsolute(migrationsPath)) throw new Error('Pinned Prisma source paths are required');
  const known = loadKnownMigrations(migrationsPath);
  if (known.filter((name) => name === EXPECTED_MIGRATION).length !== 1) throw new Error('Pinned migration directory is unavailable');

  const before = runPrisma(['migrate', 'status', '--schema', schemaPath], { env, run });
  const decision = classifyBeforeStatus(before.output, before.exitCode);
  log(`MIGRATION_STATUS_BEFORE=${decision.status.classification}`);
  if (decision.applyNeeded) {
    const deployed = runPrisma(['migrate', 'deploy', '--schema', schemaPath], { env, run });
    if (deployed.exitCode !== 0) {
      const failure = classifyMigrationStatus(deployed.output, deployed.exitCode, { knownMigrations: known });
      log(`MIGRATION_APPLY_CLASS=${failure.classification}`);
      throw new Error('Approved Preview migration apply failed');
    }
    log('MIGRATION_APPLY_NEEDED=true');
    log('MIGRATION_APPLY_RESULT=PASS');
  } else {
    log('MIGRATION_APPLY_NEEDED=false');
    log('MIGRATION_ALREADY_APPLIED=PASS');
  }

  const after = runPrisma(['migrate', 'status', '--schema', schemaPath], { env, run });
  const current = verifyAfterStatus(after.output, after.exitCode);
  log(`MIGRATION_STATUS_AFTER=${current.classification}`);
  await verifyTimePolicySchema({ log });
  log('PREVIEW_MIGRATION_VERIFICATION=PASS');
  log('RAW_DATABASE_OUTPUT_EMITTED=false');
  return { applyNeeded: decision.applyNeeded, migrationStatus: current.classification };
}

if (require.main === module) {
  const [schemaPath, migrationsPath] = process.argv.slice(2);
  applyApprovedMigration({ schemaPath, migrationsPath }).catch(() => {
    console.error('Approved Preview migration failed closed; raw database output was not emitted');
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_MIGRATION, applyApprovedMigration, classifyBeforeStatus, runPrisma, verifyAfterStatus, verifyTimePolicySchema };
