'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPECTED_MIGRATION = '202610020002_attendance_time_policy_v1';
const EXPECTED_SCHEMA_SHA256 = 'e4143928cfa88d4bad053aff022ad5a7f4ec15c9feb22c864b797317ebdf154b';
const EXPECTED_MIGRATION_SHA256 = '5822719590321945832adf87647ca448773f5eff8cb40b7d35ccdd8cf5f443ee';

const REQUIRED_COLUMNS = Object.freeze([
  'attendance_time_policies.scope_type',
  'attendance_time_policies.site_id',
  'attendance_time_policies.shift_type_id',
  'attendance_time_policies.policy',
  'attendance_time_policies.effective_from',
  'attendance_events.punctuality',
  'attendance_events.checkout_condition',
  'attendance_events.time_policy_snapshot',
  'attendance_pending_events.time_policy_snapshot',
]);

const REQUIRED_INDEXES = Object.freeze([
  'attendance_time_policies_company_effective_idx',
  'attendance_time_policies_company_effective_key',
  'attendance_time_policies_site_effective_idx',
  'attendance_time_policies_site_effective_key',
  'attendance_time_policies_shift_effective_idx',
  'attendance_time_policies_shift_effective_key',
  'attendance_time_policies_created_by_created_idx',
]);

const REQUIRED_CONSTRAINTS = Object.freeze([
  'attendance_time_policies_pkey',
  'attendance_time_policies_scope_check',
  'attendance_time_policies_values_check',
  'attendance_time_policies_site_fkey',
  'attendance_time_policies_shift_type_fkey',
  'attendance_time_policies_created_by_fkey',
  'attendance_events_punctuality_check',
  'attendance_events_checkout_condition_check',
]);

const MIGRATION_LEDGER_SQL = `
  SELECT migration_name, checksum,
         (finished_at IS NOT NULL) AS finished,
         (rolled_back_at IS NOT NULL) AS rolled_back
  FROM "_prisma_migrations"
  ORDER BY started_at, migration_name
`;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listMigrations(migrationsRoot) {
  if (!migrationsRoot || !fs.existsSync(migrationsRoot)) throw new Error('Pinned migrations are unavailable');
  return fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.name))
    .map((entry) => {
      const migrationPath = path.join(migrationsRoot, entry.name, 'migration.sql');
      if (!fs.existsSync(migrationPath)) throw new Error('Pinned migration file is unavailable');
      return { name: entry.name, checksum: sha256File(migrationPath) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function prismaCliState({ stdout = '', stderr = '', exitCode = 1 } = {}) {
  const output = `${stdout}\n${stderr}`;
  const lower = output.toLowerCase();
  const names = [...new Set(output.match(/\b\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*\b/g) || [])];
  const failed = /\bP(?:3009|3018)\b/i.test(output) || /failed migration|migration .* failed|failed to apply migration/i.test(lower);
  const diverged = /\bP(?:3005|3008|3011|3015|3017|3019)\b/i.test(output)
    || /applied migration.*missing|migration history.*(?:diverg|differ|mismatch)|database migrations? are out of sync/i.test(lower);
  const pending = /following migration(?:\(s\)|s)? have not yet been applied|pending migration/i.test(lower);
  const upToDate = /database schema is up to date|no pending migrations|all migrations have been applied/i.test(lower);

  if (failed) return { state: 'FAILED_OR_PARTIAL', migrationNames: names };
  if (diverged) return { state: 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS', migrationNames: names };
  if (pending) {
    return {
      state: names.length === 1 && names[0] === EXPECTED_MIGRATION ? 'EXACTLY_PENDING' : 'OTHER_PENDING_MIGRATIONS',
      migrationNames: names,
    };
  }
  if (exitCode === 0 && upToDate) return { state: 'APPLIED_UP_TO_DATE', migrationNames: [] };
  return { state: 'UNKNOWN_FAIL_CLOSED', migrationNames: names };
}

function classifyLedger({ migrations, rows, schema, ledgerReadable = true } = {}) {
  const migrationMap = new Map((migrations || []).map((migration) => [migration.name, migration.checksum.toLowerCase()]));
  if (!migrationMap.has(EXPECTED_MIGRATION)) return { state: 'UNKNOWN_FAIL_CLOSED', targetApplied: 'UNKNOWN' };
  if (!ledgerReadable || !Array.isArray(rows)) {
    return {
      state: schema?.present ? 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS' : 'UNKNOWN_FAIL_CLOSED',
      targetApplied: 'UNKNOWN',
    };
  }

  const normalized = rows.map((row) => ({
    name: String(row?.migration_name || ''),
    checksum: String(row?.checksum || '').toLowerCase(),
    finished: Boolean(row?.finished),
    rolledBack: Boolean(row?.rolled_back),
  }));
  if (normalized.some((row) => !migrationMap.has(row.name))) {
    return { state: 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS', targetApplied: 'UNKNOWN' };
  }
  if (normalized.some((row) => row.checksum !== migrationMap.get(row.name))) {
    return { state: 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS', targetApplied: 'UNKNOWN' };
  }
  if (normalized.some((row) => !row.finished && !row.rolledBack)) {
    const targetFailed = normalized.some((row) => row.name === EXPECTED_MIGRATION && !row.finished && !row.rolledBack);
    const targetWasCompleted = normalized.some((row) => row.name === EXPECTED_MIGRATION && row.finished && !row.rolledBack);
    return { state: 'FAILED_OR_PARTIAL', targetApplied: targetFailed ? 'UNKNOWN' : targetWasCompleted ? 'YES' : 'NO' };
  }

  const completedByName = new Map();
  for (const row of normalized) {
    if (row.finished && !row.rolledBack) completedByName.set(row.name, (completedByName.get(row.name) || 0) + 1);
  }
  if ([...completedByName.values()].some((count) => count > 1)) {
    return { state: 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS', targetApplied: 'UNKNOWN' };
  }

  const applied = new Set([...completedByName].filter(([, count]) => count === 1).map(([name]) => name));
  const pending = [...migrationMap.keys()].filter((name) => !applied.has(name));
  const targetApplied = applied.has(EXPECTED_MIGRATION) ? 'YES' : 'NO';

  if (targetApplied === 'NO' && schema?.present) {
    return { state: 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS', targetApplied };
  }
  if (targetApplied === 'YES' && (!schema?.present || !schema?.verified)) {
    return { state: schema?.present ? 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS' : 'FAILED_OR_PARTIAL', targetApplied };
  }
  if (pending.length === 1 && pending[0] === EXPECTED_MIGRATION) {
    return { state: 'EXACTLY_PENDING', targetApplied, pendingCount: pending.length };
  }
  if (pending.length > 0) return { state: 'OTHER_PENDING_MIGRATIONS', targetApplied, pendingCount: pending.length };
  if (targetApplied === 'YES' && schema?.verified) return { state: 'APPLIED_UP_TO_DATE', targetApplied, pendingCount: 0 };
  return { state: 'UNKNOWN_FAIL_CLOSED', targetApplied: 'UNKNOWN' };
}

function reconcileStatus(ledger, cli) {
  if (ledger.state === 'FAILED_OR_PARTIAL' || ledger.state === 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS') return ledger;
  if (cli.state === 'FAILED_OR_PARTIAL' || cli.state === 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS') {
    return { ...ledger, state: cli.state };
  }
  if (ledger.state === 'UNKNOWN_FAIL_CLOSED' || cli.state === 'UNKNOWN_FAIL_CLOSED') {
    return { ...ledger, state: 'UNKNOWN_FAIL_CLOSED' };
  }
  if (ledger.state !== cli.state) return { ...ledger, state: 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS' };
  return ledger;
}

function safeErrorCode(error) {
  return String(error?.code || error?.meta?.code || '').match(/^P\d{4}$/)?.[0] || 'NOT_EXPOSED';
}

function asSet(rows, key) {
  return new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.[key] || '')));
}

async function inspectSchema(prisma) {
  const tableRows = await prisma.$queryRawUnsafe("SELECT to_regclass('public.attendance_time_policies')::text AS name");
  const tablePresent = (Array.isArray(tableRows) ? tableRows : []).some((row) => ['attendance_time_policies', 'public.attendance_time_policies'].includes(String(row?.name || '')));
  const columnRows = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name = 'attendance_time_policies' AND column_name IN ('scope_type', 'site_id', 'shift_type_id', 'policy', 'effective_from'))
        OR (table_name = 'attendance_events' AND column_name IN ('punctuality', 'checkout_condition', 'time_policy_snapshot'))
        OR (table_name = 'attendance_pending_events' AND column_name = 'time_policy_snapshot'))
  `);
  const columns = new Set((Array.isArray(columnRows) ? columnRows : []).map((row) => `${row?.table_name}.${row?.column_name}`));
  const present = tablePresent || columns.size > 0;
  if (!tablePresent) return { present, verified: false, reason: 'POLICY_TABLE_ABSENT' };
  if (!REQUIRED_COLUMNS.every((column) => columns.has(column))) return { present, verified: false, reason: 'REQUIRED_COLUMNS_ABSENT' };

  const rlsRows = await prisma.$queryRawUnsafe(`
    SELECT c.relrowsecurity AS enabled
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'attendance_time_policies'
  `);
  const rls = rlsRows?.length === 1 && rlsRows[0]?.enabled === true;
  const indexRows = await prisma.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'attendance_time_policies'
  `);
  const indexes = asSet(indexRows, 'indexname');
  const constraintsRows = await prisma.$queryRawUnsafe(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid IN (to_regclass('public.attendance_time_policies'), to_regclass('public.attendance_events'))
  `);
  const constraints = asSet(constraintsRows, 'conname');
  const revokeRows = await prisma.$queryRawUnsafe(`
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
  const revokes = revokeRows?.[0]?.anon_has_any_privilege === false
    && revokeRows?.[0]?.authenticated_has_any_privilege === false;
  const indexesPresent = REQUIRED_INDEXES.every((index) => indexes.has(index));
  const constraintsPresent = REQUIRED_CONSTRAINTS.every((constraint) => constraints.has(constraint));
  return { present, verified: rls && indexesPresent && constraintsPresent && revokes, rls, indexesPresent, constraintsPresent, revokes };
}

function runPrismaMigrateStatus({ schemaPath, env = process.env, run = spawnSync } = {}) {
  if (!schemaPath || !path.isAbsolute(schemaPath)) return { state: 'UNKNOWN_FAIL_CLOSED', migrationNames: [] };
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = run(command, ['--no-install', 'prisma', 'migrate', 'status', '--schema', schemaPath], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result?.error) return { state: 'UNKNOWN_FAIL_CLOSED', migrationNames: [] };
  return prismaCliState({ stdout: result?.stdout, stderr: result?.stderr, exitCode: typeof result?.status === 'number' ? result.status : 1 });
}

async function inspectPreviewMigrationState({
  env = process.env,
  applicationRoot = process.env.APPLICATION_SOURCE_ROOT,
  releaseControlRoot = process.env.RELEASE_CONTROL_ROOT,
  prisma,
  targetGuard,
  run = spawnSync,
  log = console.log,
  expectedSchemaSha256 = EXPECTED_SCHEMA_SHA256,
  expectedMigrationSha256 = EXPECTED_MIGRATION_SHA256,
} = {}) {
  let client;
  let ownedClient = false;
  let result = { state: 'UNKNOWN_FAIL_CLOSED', targetApplied: 'UNKNOWN', schema: { present: false, verified: false } };
  try {
    if (typeof targetGuard === 'function') targetGuard({ env, log });
    else {
      const guardPath = path.join(releaseControlRoot || '', 'scripts', 'ci', 'verify-preview-migration-target.js');
      const guard = require(guardPath);
      guard.verifyPreviewMigrationTarget({ env, log });
    }

    if (String(env.VERCEL_ENV || '').toLowerCase() !== 'preview'
      || !env.DATABASE_URL || !env.DIRECT_URL) throw new Error('Preview read-only environment is unavailable');
    const schemaPath = path.join(applicationRoot || '', 'prisma', 'schema.prisma');
    const migrationsRoot = path.join(applicationRoot || '', 'prisma', 'migrations');
    const targetFile = path.join(migrationsRoot, EXPECTED_MIGRATION, 'migration.sql');
    if (!path.isAbsolute(schemaPath) || !fs.existsSync(schemaPath) || !fs.existsSync(targetFile)) throw new Error('Pinned application source is unavailable');
    if (sha256File(schemaPath) !== expectedSchemaSha256 || sha256File(targetFile) !== expectedMigrationSha256) throw new Error('Pinned migration source checksum mismatch');

    const migrations = listMigrations(migrationsRoot);
    if (migrations.filter((migration) => migration.name === EXPECTED_MIGRATION).length !== 1) throw new Error('Pinned migration source is ambiguous');
    const cli = runPrismaMigrateStatus({ schemaPath, env, run });

    if (!prisma) {
      const { PrismaClient } = require('@prisma/client');
      client = new PrismaClient();
      ownedClient = true;
    } else client = prisma;

    let ledgerRows;
    let ledgerReadable = true;
    try {
      ledgerRows = await client.$queryRawUnsafe(MIGRATION_LEDGER_SQL);
    } catch (error) {
      ledgerReadable = false;
      log(`MIGRATION_LEDGER_QUERY_CODE=${safeErrorCode(error)}`);
    }

    let schema;
    try {
      schema = await inspectSchema(client);
    } catch (error) {
      schema = { present: false, verified: false, errorCode: safeErrorCode(error) };
      log(`SCHEMA_READ_QUERY_CODE=${schema.errorCode}`);
    }

    const fromLedger = classifyLedger({ migrations, rows: ledgerRows, schema, ledgerReadable });
    result = reconcileStatus(fromLedger, cli);
    result.schema = schema;
    result.cliState = cli.state;
    result.pendingCount = result.pendingCount ?? null;
    log(`PRISMA_MIGRATE_STATUS_CLASS=${cli.state}`);
    log(`MIGRATION_STATUS_CLASS=${result.state}`);
    log(`TARGET_MIGRATION_APPLIED=${result.targetApplied}`);
    log(`SCHEMA_PRESENT=${schema.present ? 'YES' : schema.present === false ? 'NO' : 'UNKNOWN'}`);
    log(`SCHEMA_INVARIANTS=${schema.verified ? 'PASS' : 'FAIL'}`);
    log(`OTHER_PENDING_COUNT=${Number.isInteger(result.pendingCount) ? result.pendingCount : 'UNKNOWN'}`);
    log('RAW_DATABASE_OUTPUT_EMITTED=false');
    log('RAW_ATTENDANCE_OR_POLICY_ROWS_READ=false');
  } catch {
    result = { state: 'UNKNOWN_FAIL_CLOSED', targetApplied: 'UNKNOWN', schema: { present: false, verified: false } };
    log('MIGRATION_STATUS_CLASS=UNKNOWN_FAIL_CLOSED');
    log('TARGET_MIGRATION_APPLIED=UNKNOWN');
    log('SCHEMA_INVARIANTS=UNKNOWN');
    log('RAW_DATABASE_OUTPUT_EMITTED=false');
  } finally {
    if (ownedClient && client) await client.$disconnect().catch(() => {});
  }
  return result;
}

function writeOutputs(result, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const values = [
    `migration_class=${result.state}`,
    `migration_applied=${result.targetApplied}`,
    `schema_verified=${result.schema?.verified ? 'YES' : result.schema?.verified === false ? 'NO' : 'UNKNOWN'}`,
    `preview_get_allowed=${result.state === 'APPLIED_UP_TO_DATE' && result.schema?.verified ? 'YES' : 'NO'}`,
  ];
  fs.appendFileSync(outputPath, `${values.join('\n')}\n`, { encoding: 'utf8' });
}

async function main() {
  const result = await inspectPreviewMigrationState();
  writeOutputs(result);
  return result.state === 'UNKNOWN_FAIL_CLOSED' ? 1 : 0;
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  EXPECTED_MIGRATION,
  EXPECTED_MIGRATION_SHA256,
  EXPECTED_SCHEMA_SHA256,
  MIGRATION_LEDGER_SQL,
  REQUIRED_COLUMNS,
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
  classifyLedger,
  inspectPreviewMigrationState,
  inspectSchema,
  listMigrations,
  prismaCliState,
  reconcileStatus,
  runPrismaMigrateStatus,
};
