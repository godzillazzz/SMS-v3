'use strict';

const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  EVIDENCE_WORKFLOW_PATH,
  MIGRATIONS,
  MIGRATION_POLICY,
  PREREQUISITE,
  PRODUCTION_SOURCE_SHA,
  SOURCE_COMMIT_SHA,
  SOURCE_TREE_SHA,
  VERIFIER_PATH,
  normalizeStatements,
  sha256,
  validateAttendanceVoidManifest,
  validateAttendanceVoidSource,
  validateAttendanceVoidSql
} = require('./attendance-void-control-plane');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = '.github/releases/approved-attendance-void-migration.json';
const M1_SCHEMA_SOURCE_SHA = '56c33991503e09c5904279205fe1aaa423a8b219';
const OLD_SCHEMA_SOURCE_SHA = PRODUCTION_SOURCE_SHA;
const REQUIRED_ROLES = Object.freeze(['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']);
const TABLES = Object.freeze(['attendance_sessions', 'attendance_events', 'attendance_selfie_policies']);
const MAX_SCHEMA_DIFF_OUTPUT_CHARS = 12_000;
const EXPECTED_CHECK_NAMES = Object.freeze([
  'P1_SOURCE_IDENTITY',
  'P2_DISPOSABLE_DATABASE_IDENTITY',
  'P3_MIGRATION_LEDGER_AND_PENDING_SET',
  'P4_BASELINE_SCHEMA_AND_ENUMS',
  'P5_LEGACY_METADATA_INTEGRITY',
  'P6_DUPLICATE_LIVE_SESSIONS_ZERO',
  'P7_CLOSED_STATE_VIOLATIONS_ZERO',
  'P8_SELFIE_POLICY_RLS_AND_PRIVILEGES',
  'P9_LOCK_AND_RELATION_SIZE_EVIDENCE',
  'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF',
  'P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS',
  'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY'
]);

function assert(condition, message) {
  if (!condition) throw new Error(`attendance void evidence guard: ${message}`);
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

function assertDisposableUrl(rawUrl, expectedDatabase, env = process.env) {
  assert(env.ATTENDANCE_VOID_DISPOSABLE_DATABASE === 'true', 'disposable-database execution guard is not enabled');
  let url;
  try {
    url = new URL(rawUrl || '');
  } catch {
    throw new Error('database target URL is missing or malformed');
  }
  assert(['postgres:', 'postgresql:'].includes(url.protocol), 'database target must be PostgreSQL');
  const localMode = env.ATTENDANCE_VOID_LOCAL_DISPOSABLE_DATABASE === 'true';
  const expectedHost = localMode ? '127.0.0.1' : 'postgres';
  const expectedPort = localMode ? '55432' : '5432';
  assert(url.hostname === expectedHost, 'database target host is not an approved disposable database endpoint');
  assert((url.port || '5432') === expectedPort, 'database target port mismatch');
  if (localMode) assert(env.ATTENDANCE_VOID_DISPOSABLE_DATABASE === 'true', 'local disposable database guard is not enabled');
  assert(decodeURIComponent(url.username) === 'ci_user', 'database target user is not the disposable CI user');
  assert(decodeURIComponent(url.password) === 'ci_test_only', 'database target credential is not the disposable test credential');
  assert(decodeURIComponent(url.pathname.replace(/^\//, '')) === expectedDatabase, 'database target name mismatch');
  return Object.freeze({ hostAlias: 'postgres', databaseName: expectedDatabase, roleName: 'ci_user' });
}

function createCheckCollector() {
  const checks = new Map();
  function verifyEvidence(name, phase, details) {
    assert(details && typeof details === 'object' && !Array.isArray(details), `${name} evidence details are missing`);
    if (name === 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF' && phase === 'preflight') {
      assert(false, 'P10 preflight must be PARTIAL until the second deploy and post-apply diffs pass');
    }
    if (name === 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF' && phase === 'post_apply') {
      assert(details.second_deploy_idempotent === true && details.full_migration_to_schema_diff === 'EMPTY' && details.disposable_database_to_new_schema_diff === 'EMPTY', 'post-apply P10 evidence is incomplete');
      assert(JSON.stringify(details.first_deploy_migrations) === JSON.stringify(MIGRATIONS.map(({ name: migration }) => migration)), 'P10 first deploy evidence does not show exact M2-M5 order');
    }

    if (name === 'P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS' && phase === 'post_apply') {
      assert(details.post_schema_verified === true && details.row_counts_unchanged === true && Array.isArray(details.migration_checksums) && details.migration_checksums.length === MIGRATIONS.length && details.migration_checksums.every(({ checksum_match }) => checksum_match === true), 'P11 post-apply evidence is incomplete');
      assert(JSON.stringify(details.migration_checksums.map(({ migration_name }) => migration_name)) === JSON.stringify(MIGRATIONS.map(({ name: migration }) => migration)), 'P11 post-apply checksum evidence is not exact M2-M5 order');
    }
    if (name === 'P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS' && phase === 'preflight') {
      assert(details.row_counts_before && TABLES.every((table) => Number.isSafeInteger(details.row_counts_before[table]) && details.row_counts_before[table] >= 0), 'P11 preflight row-count evidence is incomplete');
      assert(details.source_migration_checksums_verified === true && details.no_data_backfill_or_DML_in_approved_SQL === true, 'P11 preflight source evidence is incomplete');
    }
    if (name === 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY' && phase === 'preflight') {
      assert(false, 'P12 preflight must be PARTIAL until new-schema compatibility is tested after apply');
    }
    if (name === 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY' && phase === 'post_apply') {
      assert(details.old_application_schema_read === 'PASS' && details.new_application_schema_read === 'PASS' && details.database_writes === false, 'P12 post-apply compatibility evidence is incomplete');
    }
  }
  return {
    pass(phase, name, details = {}) {
      assert(['preflight', 'post_apply'].includes(phase), 'unknown evidence phase');
      assert(EXPECTED_CHECK_NAMES.includes(name), `unknown P check: ${name}`);
      verifyEvidence(name, phase, details);
      const check = checks.get(name) || { preflight: { status: 'NOT_RUN' }, post_apply: { status: 'NOT_RUN' } };
      check[phase] = { status: 'PASS', ...jsonSafe(details) };
      checks.set(name, check);
    },
    fail(phase, name, details = {}) {
      assert(['preflight', 'post_apply'].includes(phase), 'unknown evidence phase');
      assert(EXPECTED_CHECK_NAMES.includes(name), `unknown P check: ${name}`);
      const check = checks.get(name) || { preflight: { status: 'NOT_RUN' }, post_apply: { status: 'NOT_RUN' } };
      check[phase] = { status: 'FAIL', ...jsonSafe(details) };
      checks.set(name, check);
    },
    partial(phase, name, details = {}) {
      assert(phase === 'preflight' && ['P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY'].includes(name), 'partial evidence is allowed only for P10/P12 preflight');
      if (name === 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF') {
        assert(details.disposable_database_to_m1_schema_diff === 'EMPTY', 'P10 M1 baseline schema evidence is incomplete');
      } else {
        assert(details.old_application_schema_read === 'PASS' && details.new_application_schema_read === 'NOT_RUN' && details.database_writes === false, 'P12 preflight partial evidence is incomplete');
      }
      const check = checks.get(name) || { preflight: { status: 'NOT_RUN' }, post_apply: { status: 'NOT_RUN' } };
      check[phase] = { status: 'PARTIAL', ...jsonSafe(details) };
      checks.set(name, check);
    },
    complete() {
      return Object.fromEntries(EXPECTED_CHECK_NAMES.map((name) => [name, checks.get(name) || { preflight: { status: 'NOT_RUN' }, post_apply: { status: 'NOT_RUN' } }]));
    },
    assertComplete() {
      for (const name of EXPECTED_CHECK_NAMES) assert(checks.has(name), `${name} evidence was not produced`);
      for (const [name, check] of checks) {
        assert(check.post_apply.status === 'PASS', `${name} post-apply evidence is not PASS`);
        const preflightStatus = ['P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY'].includes(name) ? 'PARTIAL' : 'PASS';
        assert(check.preflight.status === preflightStatus, `${name} preflight evidence is not ${preflightStatus}`);
      }
    }
  };
}

function sqlCli(name, args, { env = process.env, input, cwd = ROOT } = {}) {
  const result = spawnSync(name, args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw new Error(`${name} could not start`);
  if (result.status !== 0) throw new Error(`${name} command failed with exit code ${result.status ?? 1}`);
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

function gitBytes(args, root = ROOT) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
}

function prepareBaseline({ root = ROOT, tempRoot = process.env.RUNNER_TEMP || process.env.TMPDIR } = {}) {
  assert(tempRoot && path.isAbsolute(tempRoot), 'RUNNER_TEMP or TMPDIR must identify an isolated temporary directory');
  const baselineRoot = fs.mkdtempSync(path.join(tempRoot, 'smsv3-attendance-void-baseline-'));
  const migrationRoot = path.join(baselineRoot, 'prisma', 'migrations');
  fs.mkdirSync(migrationRoot, { recursive: true });
  const sourceMigrations = execFileSync('git', ['-C', root, 'ls-tree', '-d', '--name-only', `${SOURCE_COMMIT_SHA}:prisma/migrations`], { encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).sort();
  const baselineMigrations = sourceMigrations.filter((name) => name <= PREREQUISITE.name);
  assert(baselineMigrations.at(-1) === PREREQUISITE.name, 'baseline does not end at the exact M1 prerequisite');
  const afterM1 = sourceMigrations.filter((name) => name > PREREQUISITE.name);
  assert(JSON.stringify(afterM1) === JSON.stringify(MIGRATIONS.map(({ name }) => name)), 'source tree has pending migrations outside exact M2-M5');
  const provider = execFileSync('git', ['-C', root, 'show', `${SOURCE_COMMIT_SHA}:prisma/schema.prisma`], { encoding: 'utf8' }).match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/);
  assert(provider?.[1] === 'postgresql', 'approved source datasource provider is not PostgreSQL');
  const copyMigrations = (destination, names) => {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of names) {
      const dir = path.join(destination, name);
      fs.mkdirSync(dir, { recursive: true });
      const migrationPath = `prisma/migrations/${name}/migration.sql`;
      fs.writeFileSync(path.join(dir, 'migration.sql'), gitBytes(['show', `${SOURCE_COMMIT_SHA}:${migrationPath}`], root));
    }
    fs.writeFileSync(path.join(destination, 'migration_lock.toml'), 'provider = "postgresql"\n');
  };
  copyMigrations(migrationRoot, baselineMigrations);
  const schemaPath = path.join(baselineRoot, 'prisma', 'schema.prisma');
  const fullSchemaPath = path.join(baselineRoot, 'target', 'schema.prisma');
  const fullMigrationRoot = path.join(baselineRoot, 'target', 'migrations');
  copyMigrations(fullMigrationRoot, sourceMigrations);
  const oldApplicationSchema = gitBytes(['show', `${M1_SCHEMA_SOURCE_SHA}:prisma/schema.prisma`], root);
  fs.writeFileSync(schemaPath, oldApplicationSchema);
  fs.mkdirSync(path.dirname(fullSchemaPath), { recursive: true });
  fs.writeFileSync(fullSchemaPath, gitBytes(['show', `${SOURCE_COMMIT_SHA}:prisma/schema.prisma`], root));

  return Object.freeze({
    baselineRoot,
    schemaPath,
    migrationsRoot: migrationRoot,
    fullMigrationRoot,
    fullSchemaPath,
    migrationCount: baselineMigrations.length,
    fullMigrationCount: sourceMigrations.length,
    lastMigration: PREREQUISITE.name
  });
}

function sourceMetadata(root = ROOT) {
  const result = validateAttendanceVoidSource(JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8')), root);
  return {
    source_commit_sha: result.sourceCommitSha,
    source_tree_sha: result.sourceTreeSha,
    current_control_head_sha: result.currentControlHeadSha,
    production_source_ancestor_verified: result.ancestryVerified,
    exact_prisma_change_set_verified: result.exactPrismaChangeSet,
    migration_checksums: Object.fromEntries(MIGRATIONS.map(({ name, sha256: digest }) => [name, digest])),
    prerequisite_migration: { name: PREREQUISITE.name, sha256: PREREQUISITE.sha256 }
  };
}

async function queryRows(prisma, sql) {
  return jsonSafe(await prisma.$queryRawUnsafe(sql));
}

async function scalarCount(prisma, sql) {
  const rows = await queryRows(prisma, sql);
  assert(rows.length === 1, 'expected one aggregate row');
  return Number(rows[0].count);
}

async function databaseFingerprint(prisma) {
  const rows = await queryRows(prisma, `
    SELECT d.oid::text AS database_oid,
           current_database() AS database_name,
           current_user AS role_name,
           current_setting('server_version_num') AS server_version_num,
           c.system_identifier::text AS system_identifier
    FROM pg_database d CROSS JOIN pg_control_system() c
    WHERE d.datname = current_database()
  `);
  assert(rows.length === 1, 'disposable database fingerprint query did not return one row');
  const row = rows[0];
  const digest = sha256(JSON.stringify({ database_oid: row.database_oid, database_name: row.database_name, role_name: row.role_name, server_version_num: row.server_version_num, system_identifier: row.system_identifier }));
  return Object.freeze({ sha256: digest, databaseName: row.database_name, roleName: row.role_name, serverVersionNum: row.server_version_num });
}

function formatCheckStatus(name, check) {
  const preflight = check?.preflight?.status || 'NOT_RUN';
  const postApply = check?.post_apply?.status || 'NOT_RUN';
  return `${name}=preflight:${preflight},post_apply:${postApply}`;
}

function redactedSchemaDiffOutput(value) {
  const text = String(value || '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[REDACTED CONNECTION STRING]')
    .replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED EMAIL]');
  return text.length > MAX_SCHEMA_DIFF_OUTPUT_CHARS
    ? `${text.slice(0, MAX_SCHEMA_DIFF_OUTPUT_CHARS)}...[truncated]`
    : text;
}

function schemaDiffFailureDetails(error, label, fallback = {}) {
  const details = error?.details && typeof error.details === 'object' ? error.details : {};
  const exitCode = Number.isSafeInteger(details.exit_code)
    ? details.exit_code
    : Number.isSafeInteger(error?.status) ? error.status : (fallback.exit_code ?? 1);
  return Object.freeze({
    command_label: label,
    exit_code: exitCode,
    stdout: redactedSchemaDiffOutput(details.stdout ?? error?.stdout ?? fallback.stdout),
    stderr: redactedSchemaDiffOutput(details.stderr ?? error?.stderr ?? fallback.stderr)
  });
}

function runEmptySchemaDiff(args, env, label, root, prismaRunner) {
  let output;
  try {
    output = prismaRunner(args, env, label, root);
  } catch (error) {
    const details = schemaDiffFailureDetails(error, label);
    const failure = new Error(`${label} failed (exit=${details.exit_code})`);
    failure.code = label;
    failure.details = details;
    throw failure;
  }
  if (output.length !== 0 && !/No difference detected\.?/i.test(output)) {
    const failure = new Error(`${label} is not empty`);
    failure.code = label;
    failure.details = schemaDiffFailureDetails(failure, label, { exit_code: 0, stdout: output, stderr: '' });
    throw failure;
  }
  return 'EMPTY';
}

function runM1BaselineSchemaDiffs(baseline, env, root = ROOT, prismaRunner = runPrisma) {
  assert(baseline && baseline.schemaPath, 'M1 baseline evidence directory is missing');
  assertDisposableUrl(env.DIRECT_URL, 'sms_v3_test', env);
  const databaseDiff = runEmptySchemaDiff([
    'migrate', 'diff',
    '--from-url', env.DIRECT_URL,
    '--to-schema-datamodel', baseline.schemaPath,
    '--exit-code'
  ], env, 'disposable database to M1 schema diff', root, prismaRunner);
  return Object.freeze({ disposable_database_to_m1_schema_diff: databaseDiff });
}

function verifyIdempotentDeploy(schemaPath, env, root = ROOT, prismaRunner = runPrisma) {
  const output = prismaRunner(['migrate', 'deploy', '--schema', schemaPath], env, 'second idempotent Prisma migrate deploy', root);
  assert(!/Applying migration\s+[0-9]{12,14}_/.test(output), 'second migrate deploy attempted to apply an additional migration');
  assert(/already up to date|no pending migrations|No pending migrations|No migration found/i.test(output) || output.length === 0, 'second migrate deploy output was not recognizable');
  return true;
}

function runPostApplySchemaDiffs(baseline, env, root = ROOT, prismaRunner = runPrisma) {
  assert(baseline && baseline.fullMigrationRoot && baseline.fullSchemaPath, 'post-apply full migration/schema baseline is missing');
  assertDisposableUrl(env.DIRECT_URL, 'sms_v3_test', env);
  assertDisposableUrl(env.SHADOW_DATABASE_URL, 'sms_v3_shadow', env);
  const migrationDiff = runEmptySchemaDiff([
    'migrate', 'diff',
    '--from-migrations', baseline.fullMigrationRoot,
    '--to-schema-datamodel', baseline.fullSchemaPath,
    '--shadow-database-url', env.SHADOW_DATABASE_URL,
    '--exit-code'
  ], env, 'full M1-M5 migration-to-schema diff', root, prismaRunner);
  const databaseDiff = runEmptySchemaDiff([
    'migrate', 'diff',
    '--from-url', env.DIRECT_URL,
    '--to-schema-datamodel', baseline.fullSchemaPath,
    '--exit-code'
  ], env, 'disposable database to new schema diff', root, prismaRunner);
  return Object.freeze({ full_migration_to_schema_diff: migrationDiff, disposable_database_to_new_schema_diff: databaseDiff });
}

async function migrationLedger(prisma) {
  return queryRows(prisma, `
    SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
           rolled_back_at IS NOT NULL AS rolled_back, logs IS NOT NULL AS has_error_log
    FROM public."_prisma_migrations"
    ORDER BY migration_name
  `);
}

function migrationDirectories(root = ROOT) {
  return execFileSync('git', ['-C', root, 'ls-tree', '-d', '--name-only', `${SOURCE_COMMIT_SHA}:prisma/migrations`], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).sort();
}

function migrationStatus(ledger, directories) {
  const applied = new Map();
  for (const row of ledger) {
    if (row.rolled_back) continue;
    if (row.finished) applied.set(row.migration_name, row.checksum);
  }
  const pending = directories.filter((name) => !applied.has(name));
  const failed = ledger.filter((row) => !row.finished && !row.rolled_back).map((row) => row.migration_name);
  return { applied, pending, failed };
}

async function relationShapes(prisma) {
  const [enums, columns, constraints, indexes] = await Promise.all([
    queryRows(prisma, `
      SELECT t.typname AS type_name, e.enumlabel AS enum_label
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typnamespace = 'public'::regnamespace
        AND t.typname IN ('AttendanceSessionState', 'AttendanceEventState')
      ORDER BY t.typname, e.enumsortorder
    `),
    queryRows(prisma, `
      SELECT table_name, column_name, data_type, udt_name, character_maximum_length, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('attendance_sessions', 'attendance_events')
      ORDER BY table_name, ordinal_position
    `),
    queryRows(prisma, `
      SELECT c.conname AS constraint_name, c.contype AS constraint_type,
             c.convalidated AS validated, pg_get_constraintdef(c.oid) AS definition,
             t.relname AS table_name
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      WHERE c.connamespace = 'public'::regnamespace
        AND t.relname IN ('attendance_sessions', 'attendance_events')
      ORDER BY t.relname, c.conname
    `),
    queryRows(prisma, `
      SELECT t.relname AS table_name, i.relname AS index_name,
             pg_get_indexdef(i.oid) AS definition,
             pg_get_expr(ix.indpred, ix.indrelid) AS predicate
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname IN ('attendance_sessions', 'attendance_events', 'attendance_selfie_policies')
      ORDER BY t.relname, i.relname
    `)
  ]);
  return { enums, columns, constraints, indexes };
}

function valuesByType(enums) {
  const values = {};
  for (const row of enums) (values[row.type_name] ||= []).push(row.enum_label);
  return values;
}

function columnMap(columns) {
  return new Map(columns.map((column) => [`${column.table_name}.${column.column_name}`, column]));
}

function constraintMap(constraints) {
  return new Map(constraints.map((constraint) => [constraint.constraint_name, constraint]));
}

function indexMap(indexes) {
  return new Map(indexes.map((index) => [index.index_name, index]));
}

async function rowCounts(prisma) {
  const result = {};
  for (const table of TABLES) result[table] = await scalarCount(prisma, `SELECT count(*)::bigint AS count FROM public."${table}"`);
  return result;
}

async function legacyIntegrity(prisma, postApply = false) {
  const sessionStates = postApply ? "('OPEN', 'CLOSED', 'VOIDED')" : "('OPEN', 'CLOSED')";
  const voidMetadata = postApply
    ? `OR ("state"::text <> 'VOIDED' AND ("voided_at" IS NOT NULL OR "voided_by_user_id" IS NOT NULL OR "void_reason" IS NOT NULL))
       OR ("state"::text = 'VOIDED' AND ("voided_at" IS NULL OR "voided_by_user_id" IS NULL OR char_length("void_reason") NOT BETWEEN 5 AND 1000))`
    : '';
  const sessionInvalid = await scalarCount(prisma, `
    SELECT count(*)::bigint AS count FROM public."attendance_sessions"
    WHERE "employee_id" IS NULL OR "shift_assignment_id" IS NULL
       OR "expected_shift_type_id" IS NULL OR "expected_site_id" IS NULL
       OR "work_date" IS NULL OR "expectation_snapshot" IS NULL
       OR "expectation_digest" IS NULL OR char_length("expectation_digest") <> 64
       OR "opened_at" IS NULL
       OR ("state"::text = 'OPEN' AND "closed_at" IS NOT NULL)
       OR ("state"::text = 'CLOSED' AND "closed_at" IS NULL)
       OR "state"::text NOT IN ${sessionStates}
       ${voidMetadata}
  `);
  const eventStateChecks = postApply
    ? `OR e."state"::text NOT IN ('ACTIVE', 'VOIDED')
       OR (e."state"::text <> 'VOIDED' AND (e."voided_at" IS NOT NULL OR e."voided_by_user_id" IS NOT NULL OR e."void_reason" IS NOT NULL))
       OR (e."state"::text = 'VOIDED' AND (e."voided_at" IS NULL OR e."voided_by_user_id" IS NULL OR char_length(e."void_reason") NOT BETWEEN 5 AND 1000))`
    : '';
  const eventInvalid = await scalarCount(prisma, `
    SELECT count(*)::bigint AS count FROM public."attendance_events" e
    LEFT JOIN public."attendance_sessions" s ON s."id" = e."session_id"
    WHERE e."session_id" IS NULL OR s."id" IS NULL
       OR e."capture_id" IS NULL OR e."received_at" IS NULL
       OR e."effective_event_at" IS NULL
       OR e."context_digest" IS NULL OR char_length(e."context_digest") <> 64
       OR e."location_evidence" IS NULL OR e."verification_snapshot" IS NULL
       ${eventStateChecks}
  `);
  return { invalid_session_metadata_count: sessionInvalid, invalid_event_metadata_count: eventInvalid };
}

async function duplicateLiveSessions(prisma, postApply) {
  const predicate = postApply ? '"state"::text <> \'VOIDED\'' : 'TRUE';
  return scalarCount(prisma, `
    SELECT count(*)::bigint AS count FROM (
      SELECT "shift_assignment_id" FROM public."attendance_sessions"
      WHERE ${predicate}
      GROUP BY "shift_assignment_id" HAVING count(*) > 1
    ) duplicates
  `);
}

async function closedStateViolations(prisma, postApply) {
  const predicate = postApply
    ? `NOT (("state"::text = 'OPEN' AND "closed_at" IS NULL)
        OR ("state"::text = 'CLOSED' AND "closed_at" IS NOT NULL)
        OR ("state"::text = 'VOIDED'))`
    : `NOT (("state"::text = 'OPEN' AND "closed_at" IS NULL)
        OR ("state"::text = 'CLOSED' AND "closed_at" IS NOT NULL))`;
  return scalarCount(prisma, `SELECT count(*)::bigint AS count FROM public."attendance_sessions" WHERE ${predicate}`);
}

async function selfiePolicyState(prisma) {
  const [roles, tableState, privileges] = await Promise.all([
    queryRows(prisma, `SELECT "role"::text AS role, "clock_in_required", "clock_out_required" FROM public."attendance_selfie_policies" ORDER BY "role"`),
    queryRows(prisma, `
      SELECT c.relrowsecurity AS rls_enabled,
             (SELECT count(*)::bigint FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='attendance_selfie_policies') AS policy_count
      FROM pg_class c WHERE c.oid='public.attendance_selfie_policies'::regclass
    `),
    queryRows(prisma, `
      SELECT has_table_privilege('anon', 'public.attendance_selfie_policies', 'SELECT') AS anon_select,
             has_table_privilege('anon', 'public.attendance_selfie_policies', 'INSERT') AS anon_insert,
             has_table_privilege('authenticated', 'public.attendance_selfie_policies', 'SELECT') AS authenticated_select,
             has_table_privilege('authenticated', 'public.attendance_selfie_policies', 'INSERT') AS authenticated_insert
    `)
  ]);
  return {
    roles,
    rowCount: roles.length,
    exactRoleSet: roles.length === REQUIRED_ROLES.length && REQUIRED_ROLES.every((role) => roles.some((row) => row.role === role && row.clock_in_required === false && row.clock_out_required === false)),
    rlsEnabled: tableState[0]?.rls_enabled === true,
    policyCount: Number(tableState[0]?.policy_count ?? -1),
    privileges: privileges[0] || {}
  };
}

async function lockAndSizeState(prisma) {
  const locks = await scalarCount(prisma, `
    SELECT count(*)::bigint AS count
    FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('attendance_sessions','attendance_events')
      AND NOT l.granted
  `);
  const waiters = await scalarCount(prisma, `
    SELECT count(*)::bigint AS count FROM pg_stat_activity a
    WHERE a.datname=current_database() AND a.pid <> pg_backend_pid()
      AND a.wait_event_type='Lock'
  `);
  const sizes = await queryRows(prisma, `
    SELECT c.relname AS table_name, pg_total_relation_size(c.oid)::bigint AS total_bytes,
           c.reltuples::bigint AS estimated_rows
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('attendance_sessions','attendance_events')
    ORDER BY c.relname
  `);
  return { ungranted_relation_lock_count: locks, waiting_backend_count: waiters, relations: sizes };
}

async function voidRowCounts(prisma) {
  const sessions = await scalarCount(prisma, `SELECT count(*)::bigint AS count FROM public."attendance_sessions" WHERE "state"::text='VOIDED'`);
  const events = await scalarCount(prisma, `SELECT count(*)::bigint AS count FROM public."attendance_events" WHERE "state"::text='VOIDED'`);
  return { attendance_sessions_voided: sessions, attendance_events_voided: events };
}

function evaluateRollbackGuard(counts) {
  assert(counts?.attendance_sessions_voided != null && counts?.attendance_events_voided != null, 'VOIDED counts are missing');
  const sessionCount = Number(counts.attendance_sessions_voided);
  const eventCount = Number(counts.attendance_events_voided);
  assert(Number.isSafeInteger(sessionCount) && sessionCount >= 0, 'session VOIDED count is invalid');
  assert(Number.isSafeInteger(eventCount) && eventCount >= 0, 'event VOIDED count is invalid');
  if (sessionCount === 0 && eventCount === 0) {
    return Object.freeze({ status: 'APP_ROLLBACK_ALLOWED_ZERO_VOIDED_ROWS', migration_rollback: 'NOT_PERFORMED' });
  }
  return Object.freeze({ status: 'FIX_FORWARD_REQUIRED', migration_rollback: 'NOT_PERFORMED' });
}

function preflightShapeOk(shapes) {
  const enums = valuesByType(shapes.enums);
  const columns = columnMap(shapes.columns);
  const constraints = constraintMap(shapes.constraints);
  const indexes = indexMap(shapes.indexes);
  const required = [
    'attendance_sessions_shift_assignment_id_key',
    'attendance_sessions_closed_state_check'
  ];
  return enums.AttendanceSessionState?.join(',') === 'OPEN,CLOSED'
    && enums.AttendanceEventState === undefined
    && !columns.has('attendance_sessions.voided_at')
    && !columns.has('attendance_sessions.voided_by_user_id')
    && !columns.has('attendance_sessions.void_reason')
    && !columns.has('attendance_events.state')
    && required.every((name) => constraints.has(name) || indexes.has(name));
}

function postflightShapeOk(shapes) {
  const enums = valuesByType(shapes.enums);
  const columns = columnMap(shapes.columns);
  const constraints = constraintMap(shapes.constraints);
  const indexes = indexMap(shapes.indexes);
  const requiredColumns = [
    ['attendance_sessions.voided_at', 'timestamp without time zone', 'timestamp'],
    ['attendance_sessions.voided_by_user_id', 'uuid', 'uuid'],
    ['attendance_sessions.void_reason', 'character varying', 'varchar'],
    ['attendance_events.state', 'USER-DEFINED', 'AttendanceEventState'],
    ['attendance_events.voided_at', 'timestamp without time zone', 'timestamp'],
    ['attendance_events.voided_by_user_id', 'uuid', 'uuid'],
    ['attendance_events.void_reason', 'character varying', 'varchar']
  ];
  if (enums.AttendanceSessionState?.join(',') !== 'OPEN,CLOSED,VOIDED') return false;
  if (enums.AttendanceEventState?.join(',') !== 'ACTIVE,VOIDED') return false;
  if (!requiredColumns.every(([key, dataType, udt]) => columns.get(key)?.data_type === dataType && columns.get(key)?.udt_name === udt)) return false;
  for (const name of ['attendance_sessions_voided_state_check', 'attendance_events_voided_state_check', 'attendance_sessions_voided_by_user_id_fkey', 'attendance_events_voided_by_user_id_fkey', 'attendance_sessions_closed_state_check']) {
    if (!constraints.has(name) || !constraints.get(name).validated) return false;
  }
  if (constraints.get('attendance_sessions_closed_state_check').definition.indexOf('VOIDED') < 0) return false;
  if (constraints.get('attendance_sessions_voided_state_check').definition.indexOf('voided_by_user_id') < 0) return false;
  if (constraints.get('attendance_events_voided_state_check').definition.indexOf('voided_by_user_id') < 0) return false;
  if (indexes.has('attendance_sessions_shift_assignment_id_key')) return false;
  const partial = indexes.get('attendance_sessions_one_live_per_assignment_key');
  if (!/CREATE UNIQUE INDEX/.test(partial?.definition || '') || !/state.*<>.*VOIDED/i.test(partial?.predicate || '')) return false;
  return indexes.has('attendance_sessions_state_work_date_idx')
    && indexes.has('attendance_events_state_effective_event_at_idx')
    && indexes.has('attendance_sessions_shift_assignment_id_idx');
}

function assertSelfiePolicy(state) {
  assert(state.exactRoleSet, 'SELFIE-POLICY exact default role seeds or values mismatch');
  assert(state.rlsEnabled, 'SELFIE-POLICY RLS is not enabled');
  assert(state.policyCount === 0, 'SELFIE-POLICY unexpectedly exposes browser RLS policies');
  for (const [privilege, allowed] of Object.entries(state.privileges)) assert(allowed === false, `SELFIE-POLICY browser privilege is enabled: ${privilege}`);
}

async function collectPreflight(prisma, env = process.env, root = ROOT, baseline = null, checks = createCheckCollector()) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8'));
  const source = sourceMetadata(root);
  validateAttendanceVoidManifest(manifest, { root, verifySql: true, verifySource: true });
  checks.pass('preflight', 'P1_SOURCE_IDENTITY', source);

  const dbTarget = assertDisposableUrl(env.DIRECT_URL, 'sms_v3_test', env);
  const dbFingerprint = await databaseFingerprint(prisma);
  assert(dbFingerprint.databaseName === dbTarget.databaseName && dbFingerprint.roleName === dbTarget.roleName, 'connected database does not match the disposable target');
  const shadowTarget = assertDisposableUrl(env.SHADOW_DATABASE_URL, 'sms_v3_shadow', env);
  checks.pass('preflight', 'P2_DISPOSABLE_DATABASE_IDENTITY', {
    database_environment: 'DISPOSABLE_CI_POSTGRESQL',
    database_name: dbFingerprint.databaseName,
    database_role: dbFingerprint.roleName,
    redacted_database_fingerprint_sha256: dbFingerprint.sha256,
    shadow_database_name: shadowTarget.databaseName
  });

  const ledger = await migrationLedger(prisma);
  const directories = migrationDirectories(root);
  const status = migrationStatus(ledger, directories);
  const m1 = status.applied.get(PREREQUISITE.name);
  const expectedPending = MIGRATIONS.map(({ name }) => name);
  assert(m1 === PREREQUISITE.sha256, 'M1 is not applied with the exact approved checksum');
  assert(JSON.stringify(status.pending) === JSON.stringify(expectedPending), 'pending migration set is not exactly M2-M5 in order');
  assert(status.failed.length === 0, 'failed or unfinished migration rows exist');
  checks.pass('preflight', 'P3_MIGRATION_LEDGER_AND_PENDING_SET', { prerequisite_m1_applied_with_checksum: true, pending_migrations: status.pending, failed_migration_count: 0 });

  const shapes = await relationShapes(prisma);
  assert(preflightShapeOk(shapes), 'pre-M2 schema/enum/index baseline does not match the approved M1 checkpoint');
  checks.pass('preflight', 'P4_BASELINE_SCHEMA_AND_ENUMS', { session_state_enum: valuesByType(shapes.enums).AttendanceSessionState, event_state_enum_present: false, void_columns_present: false, prior_unique_index_and_closed_check_present: true });

  const legacy = await legacyIntegrity(prisma);
  assert(legacy.invalid_session_metadata_count === 0 && legacy.invalid_event_metadata_count === 0, 'pre-existing required attendance metadata is invalid');
  checks.pass('preflight', 'P5_LEGACY_METADATA_INTEGRITY', legacy);

  const beforeCounts = await rowCounts(prisma);
  const duplicateCount = await duplicateLiveSessions(prisma, false);
  assert(duplicateCount === 0, 'duplicate live AttendanceSession rows exist before migration');
  checks.pass('preflight', 'P6_DUPLICATE_LIVE_SESSIONS_ZERO', { duplicate_live_sessions: duplicateCount });

  const closedViolations = await closedStateViolations(prisma, false);
  assert(closedViolations === 0, 'AttendanceSession OPEN/CLOSED invariant violations exist before migration');
  checks.pass('preflight', 'P7_CLOSED_STATE_VIOLATIONS_ZERO', { closed_state_violations: closedViolations });

  const selfie = await selfiePolicyState(prisma);
  assertSelfiePolicy(selfie);
  checks.pass('preflight', 'P8_SELFIE_POLICY_RLS_AND_PRIVILEGES', {
    role_count: selfie.rowCount,
    role_defaults_match: selfie.exactRoleSet,
    rls_enabled: selfie.rlsEnabled,
    rls_policy_count: selfie.policyCount,
    browser_privileges: selfie.privileges
  });

  const locks = await lockAndSizeState(prisma);
  assert(locks.ungranted_relation_lock_count === 0 && locks.waiting_backend_count === 0, 'blocked database locks exist during preflight');
  checks.pass('preflight', 'P9_LOCK_AND_RELATION_SIZE_EVIDENCE', locks);
  let m1BaselineDiffs;
  try {
    m1BaselineDiffs = runM1BaselineSchemaDiffs(baseline, env, root);
  } catch (error) {
    checks.fail('preflight', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', { failure: error.details || safeError(error) });
    throw error;
  }
  const oldCompatibility = await oldApplicationCompatibilitySmoke(env.DIRECT_URL, env.RUNNER_TEMP || env.TMPDIR, env);
  checks.partial('preflight', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', m1BaselineDiffs);
  checks.pass('preflight', 'P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS', { row_counts_before: beforeCounts, source_migration_checksums_verified: true, no_data_backfill_or_DML_in_approved_SQL: true });
  checks.partial('preflight', 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY', { ...oldCompatibility, new_application_schema_read: 'NOT_RUN', database_migrations_not_applied: true });
  return { checks, dbFingerprint, beforeCounts, beforeShapes: shapes, beforeLedger: ledger, source, legacy, selfie, locks, baseline };
}

function cliPath(root = ROOT) {
  return path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
}

function runPrisma(args, env, label, root = ROOT) {
  assert(fs.existsSync(cliPath(root)), 'local Prisma CLI is not installed');
  const result = spawnSync(process.execPath, [cliPath(root), ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`${label} failed (exit=${result.status ?? 1})`);
    error.code = label;
    if (args[0] === 'migrate' && args[1] === 'diff') {
      error.status = result.status;
      error.stdout = result.stdout || '';
      error.stderr = result.stderr || '';
      error.details = schemaDiffFailureDetails(error, label);
    }
    throw error;
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

function addGeneratorOutput(schemaText, outputPath) {
  const block = schemaText.match(/generator\s+client\s*\{[\s\S]*?\}/);
  assert(block, 'Prisma client generator block is missing');
  assert(!/\boutput\s*=/.test(block[0]), 'source schema already overrides Prisma generator output');
  const escaped = outputPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return schemaText.replace(block[0], block[0].replace(/\}\s*$/, `  output = "${escaped}"\n}`));
}

function generateClient(schemaPath, env, label) {
  runPrisma(['generate', '--schema', schemaPath], env, label);
}

async function oldApplicationCompatibilitySmoke(databaseUrl, tempRoot, env = process.env) {
  assert(tempRoot && path.isAbsolute(tempRoot), 'RUNNER_TEMP or TMPDIR is required for isolated compatibility clients');
  const scratch = fs.mkdtempSync(path.join(tempRoot, 'smsv3-attendance-void-old-compat-'));
  const smokeEnv = { ...env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
  const oldSchemaText = gitBytes(['show', `${OLD_SCHEMA_SOURCE_SHA}:prisma/schema.prisma`]).toString('utf8');
  const oldOutput = path.join(scratch, 'old-app-client');
  const oldSchema = path.join(scratch, 'old-app-schema.prisma');
  fs.writeFileSync(oldSchema, addGeneratorOutput(oldSchemaText, oldOutput));
  generateClient(oldSchema, smokeEnv, 'old application Prisma client preflight generation');
  const OldPrismaClient = require(oldOutput).PrismaClient;
  const oldClient = new OldPrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const sessionCount = await oldClient.attendanceSession.count();
    const eventCount = await oldClient.attendanceEvent.count();
    const sessions = await oldClient.attendanceSession.findMany({ take: 1, select: { id: true } });
    const events = await oldClient.attendanceEvent.findMany({ take: 1, select: { id: true } });
    assert(Number.isInteger(sessionCount) && Number.isInteger(eventCount) && Array.isArray(sessions) && Array.isArray(events), 'old application Prisma schema preflight read failed');
  } finally {
    await oldClient.$disconnect();
  }
  return { old_application_schema_read: 'PASS', old_application_schema_source_sha: OLD_SCHEMA_SOURCE_SHA, database_writes: false };
}

async function compatibilitySmoke(databaseUrl, tempRoot, env = process.env) {
  assert(tempRoot && path.isAbsolute(tempRoot), 'RUNNER_TEMP or TMPDIR is required for isolated compatibility clients');
  const scratch = fs.mkdtempSync(path.join(tempRoot, 'smsv3-attendance-void-compat-'));
  const smokeEnv = { ...env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl };
  const oldSchemaText = gitBytes(['show', `${OLD_SCHEMA_SOURCE_SHA}:prisma/schema.prisma`]).toString('utf8');
  const newSchemaText = gitBytes(['show', `${SOURCE_COMMIT_SHA}:prisma/schema.prisma`]).toString('utf8');
  const oldOutput = path.join(scratch, 'old-app-client');
  const newOutput = path.join(scratch, 'new-app-client');
  const oldSchema = path.join(scratch, 'old-app-schema.prisma');
  const newSchema = path.join(scratch, 'new-app-schema.prisma');
  fs.writeFileSync(oldSchema, addGeneratorOutput(oldSchemaText, oldOutput));
  fs.writeFileSync(newSchema, addGeneratorOutput(newSchemaText, newOutput));
  generateClient(oldSchema, smokeEnv, 'old application Prisma client generation');
  const OldPrismaClient = require(oldOutput).PrismaClient;
  const oldClient = new OldPrismaClient({ datasources: { db: { url: databaseUrl } } });
  let oldRead = false;
  try {
    const sessionCount = await oldClient.attendanceSession.count();
    const eventCount = await oldClient.attendanceEvent.count();
    const sessions = await oldClient.attendanceSession.findMany({ take: 1, select: { id: true } });
    const events = await oldClient.attendanceEvent.findMany({ take: 1, select: { id: true } });
    oldRead = Number.isInteger(sessionCount) && Number.isInteger(eventCount) && Array.isArray(sessions) && Array.isArray(events);
  } finally {
    await oldClient.$disconnect();
  }
  assert(oldRead, 'old application Prisma schema read smoke failed');
  generateClient(newSchema, smokeEnv, 'new application Prisma client generation');
  const NewPrismaClient = require(newOutput).PrismaClient;
  const newClient = new NewPrismaClient({ datasources: { db: { url: databaseUrl } } });
  let newRead = false;
  try {
    const sessions = await newClient.attendanceSession.findMany({
      take: 1,
      select: { id: true, state: true, voidedAt: true, voidedByUserId: true, voidReason: true }
    });
    const events = await newClient.attendanceEvent.findMany({
      take: 1,
      select: { id: true, state: true, voidedAt: true, voidedByUserId: true, voidReason: true }
    });
    newRead = Array.isArray(sessions) && Array.isArray(events);
  } finally {
    await newClient.$disconnect();
  }
  assert(newRead, 'new application Prisma schema read smoke failed');
  return { old_application_schema_read: 'PASS', new_application_schema_read: 'PASS', database_writes: false };
}

function migrationChecksumPostconditions(ledger) {
  const checksums = new Map(ledger.filter((row) => row.finished && !row.rolled_back).map((row) => [row.migration_name, row.checksum]));
  return MIGRATIONS.map(({ name, sha256: expected }) => ({ migration_name: name, checksum_match: checksums.get(name) === expected }));
}

async function collectPostflight(prisma, env, root, preflight, deployEvidence, compatibility) {
  const checks = preflight.checks;
  const dbTarget = assertDisposableUrl(env.DIRECT_URL, 'sms_v3_test', env);
  const postFingerprint = await databaseFingerprint(prisma);
  assert(postFingerprint.databaseName === dbTarget.databaseName && postFingerprint.sha256 === preflight.dbFingerprint.sha256, 'database identity/fingerprint changed during test');

  let postApplyDiffs;
  try {
    verifyIdempotentDeploy(preflight.baseline.fullSchemaPath, env, root);
    postApplyDiffs = runPostApplySchemaDiffs(preflight.baseline, env, root);
  } catch (error) {
    checks.fail('post_apply', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', { first_deploy_migrations: deployEvidence.applied_migrations, failure: error.details || safeError(error) });
    throw error;
  }
  checks.pass('post_apply', 'P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', {
    first_deploy_migrations: deployEvidence.applied_migrations,
    second_deploy_idempotent: true,
    ...postApplyDiffs
  });

  const ledger = await migrationLedger(prisma);
  const directories = migrationDirectories(root);
  const status = migrationStatus(ledger, directories);
  assert(status.pending.length === 0 && status.failed.length === 0, 'migration status is not fully applied and clean after migrate deploy');
  const checksumResults = migrationChecksumPostconditions(ledger);
  assert(checksumResults.every(({ checksum_match: match }) => match), 'M2-M5 migration ledger checksum postcondition mismatch');
  const afterCounts = await rowCounts(prisma);
  assert(JSON.stringify(afterCounts) === JSON.stringify(preflight.beforeCounts), 'row counts changed during migration application');
  const shapes = await relationShapes(prisma);
  assert(postflightShapeOk(shapes), 'post-apply schema, enum, constraint, FK or index postcondition mismatch');
  const duplicateCount = await duplicateLiveSessions(prisma, true);
  assert(duplicateCount === 0, 'duplicate live AttendanceSession rows exist after migration');
  const closedViolations = await closedStateViolations(prisma, true);
  assert(closedViolations === 0, 'post-apply OPEN/CLOSED/VOIDED invariant violations exist');
  const legacy = await legacyIntegrity(prisma, true);
  assert(legacy.invalid_session_metadata_count === 0 && legacy.invalid_event_metadata_count === 0, 'post-apply attendance metadata integrity failed');
  const selfie = await selfiePolicyState(prisma);
  assertSelfiePolicy(selfie);
  const locks = await lockAndSizeState(prisma);
  assert(locks.ungranted_relation_lock_count === 0 && locks.waiting_backend_count === 0, 'blocked locks remain after migrations');
  const voidCounts = await voidRowCounts(prisma);
  const rollback = evaluateRollbackGuard(voidCounts);
  assert(rollback.status === 'APP_ROLLBACK_ALLOWED_ZERO_VOIDED_ROWS', 'disposable DB contains VOIDED rows; application rollback requires fix-forward');
  checks.pass('post_apply', 'P11_SCHEMA_COUNTS_AND_CHECKSUM_POSTCONDITIONS', {
    post_schema_verified: true,
    row_counts_before: preflight.beforeCounts,
    row_counts_after: afterCounts,
    row_counts_unchanged: true,
    migration_checksums: checksumResults,
    duplicate_live_sessions: duplicateCount,
    closed_state_violations: closedViolations,
    invalid_metadata: legacy,
    void_row_counts: voidCounts,
    rollback_guard: rollback.status,
    lock_and_size: locks
  });

  const compatibilityResult = compatibility || await compatibilitySmoke(env.DIRECT_URL, env.RUNNER_TEMP || env.TMPDIR, env);
  assert(compatibilityResult.old_application_schema_read === 'PASS' && compatibilityResult.new_application_schema_read === 'PASS', 'old/new application compatibility smoke failed');
  checks.pass('post_apply', 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY', compatibilityResult);
  checks.pass('post_apply', 'P1_SOURCE_IDENTITY', sourceMetadata(root));
  checks.pass('post_apply', 'P2_DISPOSABLE_DATABASE_IDENTITY', {
    database_environment: 'DISPOSABLE_CI_POSTGRESQL',
    database_name: postFingerprint.databaseName,
    database_role: postFingerprint.roleName,
    redacted_database_fingerprint_sha256: postFingerprint.sha256
  });
  checks.pass('post_apply', 'P3_MIGRATION_LEDGER_AND_PENDING_SET', {
    prerequisite_m1_applied_with_checksum: true,
    pending_migrations: [],
    applied_m2_m5: MIGRATIONS.map(({ name }) => name),
    failed_migration_count: 0
  });
  checks.pass('post_apply', 'P4_BASELINE_SCHEMA_AND_ENUMS', {
    session_state_enum: valuesByType(shapes.enums).AttendanceSessionState,
    event_state_enum: valuesByType(shapes.enums).AttendanceEventState,
    post_migration_schema_verified: true
  });
  checks.pass('post_apply', 'P5_LEGACY_METADATA_INTEGRITY', legacy);
  checks.pass('post_apply', 'P6_DUPLICATE_LIVE_SESSIONS_ZERO', { duplicate_live_sessions: duplicateCount });
  checks.pass('post_apply', 'P7_CLOSED_STATE_VIOLATIONS_ZERO', { closed_state_violations: closedViolations });
  checks.pass('post_apply', 'P8_SELFIE_POLICY_RLS_AND_PRIVILEGES', {
    role_count: selfie.rowCount,
    role_defaults_match: selfie.exactRoleSet,
    rls_enabled: selfie.rlsEnabled,
    rls_policy_count: selfie.policyCount,
    browser_privileges: selfie.privileges
  });
  checks.pass('post_apply', 'P9_LOCK_AND_RELATION_SIZE_EVIDENCE', locks);
  checks.assertComplete();
  return { checks, ledger, afterCounts, shapes, duplicateCount, closedViolations, selfie, locks, voidCounts, rollback, compatibility: compatibilityResult, postFingerprint };
}

function evidenceDocument({ status, metadata, preflight, postflight, env = process.env, startedAt, completedAt, failureCode = null }) {
  const checks = postflight?.checks.complete() || preflight?.checks.complete() || Object.fromEntries(EXPECTED_CHECK_NAMES.map((name) => [name, { preflight: { status: 'NOT_RUN' }, post_apply: { status: 'NOT_RUN' } }]));
  for (const name of EXPECTED_CHECK_NAMES) {
    checks[name] ||= { preflight: { status: 'NOT_RUN' }, post_apply: { status: 'NOT_RUN' } };
  }
  if (status === 'PASS') {
    for (const name of EXPECTED_CHECK_NAMES) {
      assert(checks[name].post_apply.status === 'PASS', `${name} post-apply evidence must be PASS`);
      const expectedPreflight = ['P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF', 'P12_OLD_AND_NEW_APP_SCHEMA_COMPATIBILITY'].includes(name) ? 'PARTIAL' : 'PASS';
      assert(checks[name].preflight.status === expectedPreflight, `${name} preflight evidence must be ${expectedPreflight}`);
    }
  }
  return {
    schema_version: 1,
    task_id: 'SMSV3-ATTENDANCE-VOID-CONTROL-PLANE',
    evidence_status: status,
    failure_code: failureCode,
    source_commit_sha: SOURCE_COMMIT_SHA,
    source_tree_sha: SOURCE_TREE_SHA,
    current_production_source_sha: PRODUCTION_SOURCE_SHA,
    database_environment: 'DISPOSABLE_CI_POSTGRESQL',
    database_fingerprint_sha256: postflight?.postFingerprint?.sha256 || preflight?.dbFingerprint?.sha256 || null,
    migration_policy: MIGRATION_POLICY,
    migration_checksums: Object.fromEntries(MIGRATIONS.map(({ name, sha256: digest }) => [name, digest])),
    prerequisite_migration: { name: PREREQUISITE.name, sha256: PREREQUISITE.sha256 },
    migration_names: MIGRATIONS.map(({ name }) => name),
    run_metadata: {
      workflow: env.GITHUB_WORKFLOW || 'local',
      run_id: env.GITHUB_RUN_ID || null,
      run_number: env.GITHUB_RUN_NUMBER || null,
      run_attempt: env.GITHUB_RUN_ATTEMPT || null,
      ref: env.GITHUB_REF || null,
      workflow_sha: env.GITHUB_SHA || null,
      started_at: startedAt,
      completed_at: completedAt
    },
    checks,
    production_accessed: false,
    uat_accessed: false,
    data_mutation_performed: false,
    application_deployed: false,
    migration_rollback_performed: false,
    secrets_or_connection_strings_recorded: false,
    rollback_guard_status: postflight?.rollback?.status || 'NOT_VERIFIED'
  };
}

function writeEvidence(document, env = process.env) {
  const outputPath = env.ATTENDANCE_VOID_EVIDENCE_OUTPUT || path.join(env.RUNNER_TEMP || env.TMPDIR || ROOT, 'attendance-void-evidence.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  return outputPath;
}

function safeError(error) {
  return String(error?.message || error || 'unknown failure')
    .replace(/(?:postgres(?:ql)?:\/\/)[^\s"']+/gi, '[redacted database URL]')
    .replace(/(?:password|passwd|pwd|token|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]');
}

async function runEvidence({ root = ROOT, env = process.env } = {}) {
  const startedAt = new Date().toISOString();
  let preflight;
  let postflight;
  let prisma;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8'));
    validateAttendanceVoidManifest(manifest, { root, verifySql: true, verifySource: true });
    assertDisposableUrl(env.DATABASE_URL, 'sms_v3_test', env);
    assertDisposableUrl(env.DIRECT_URL, 'sms_v3_test', env);
    assertDisposableUrl(env.SHADOW_DATABASE_URL, 'sms_v3_shadow', env);
    const PrismaClient = require('@prisma/client').PrismaClient;
    prisma = new PrismaClient({ datasources: { db: { url: env.DIRECT_URL } } });
    assert(env.ATTENDANCE_VOID_CREATE_TEST_ROLES === 'true', 'disposable test-role bootstrap authorization is missing');
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$`);
    const base = prepareBaseline({ root, tempRoot: env.RUNNER_TEMP || env.TMPDIR });
    const baselineEnv = { ...env, DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL };
    runPrisma(['migrate', 'deploy', '--schema', base.schemaPath], baselineEnv, 'disposable historical baseline through M1');
    const checks = createCheckCollector();
    preflight = { checks, baseline: base };
    preflight = await collectPreflight(prisma, env, root, base, checks);
    const deployOutput = runPrisma(['migrate', 'deploy', '--schema', base.fullSchemaPath], env, 'approved M2-M5 Prisma migrate deploy');
    const applied = deployOutput.match(/\bApplying migration\s+([^\r\n]+)/g) || [];
    const appliedNames = applied.map((line) => line.replace(/^.*\bApplying migration\s+/, '').trim().replace(/^[`'"\s]+|[`'"\s]+$/g, ''));
    assert(appliedNames.length === MIGRATIONS.length && MIGRATIONS.every(({ name }, index) => appliedNames[index] === name), 'initial deploy did not apply exactly M2-M5 in approved order');
    const compatibility = await compatibilitySmoke(env.DIRECT_URL, env.RUNNER_TEMP || env.TMPDIR, env);
    postflight = await collectPostflight(prisma, env, root, preflight, { applied_migrations: appliedNames }, compatibility);
    const metadata = sourceMetadata(root);
    const completedAt = new Date().toISOString();
    const document = evidenceDocument({ status: 'PASS', metadata, preflight, postflight, env, startedAt, completedAt });
    const evidencePath = writeEvidence(document, env);
    for (const [name, check] of Object.entries(document.checks)) console.log(formatCheckStatus(name, check));
    console.log('ATTENDANCE_VOID_DISPOSABLE_EVIDENCE=PASS');
    console.log(`SOURCE_COMMIT_SHA=${SOURCE_COMMIT_SHA}`);
    console.log(`SOURCE_TREE_SHA=${SOURCE_TREE_SHA}`);
    console.log(`DATABASE_FINGERPRINT_SHA256=${document.database_fingerprint_sha256}`);
    console.log(`ROLLBACK_GUARD=${document.rollback_guard_status}`);
    console.log(`EVIDENCE_ARTIFACT_PATH=${evidencePath}`);
    return document;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const document = evidenceDocument({ status: 'FAIL', metadata: null, preflight, postflight, env, startedAt, completedAt, failureCode: error.code || safeError(error) });
    const evidencePath = writeEvidence(document, env);
    for (const [name, check] of Object.entries(document.checks)) console.log(formatCheckStatus(name, check));
    for (const phase of ['preflight', 'post_apply']) {
      const failure = document.checks.P10_IDEMPOTENT_DEPLOY_AND_EMPTY_SCHEMA_DIFF?.[phase]?.failure;
      if (failure && typeof failure === 'object') console.error(`P10_SCHEMA_DIFF_DIAGNOSTICS=${JSON.stringify(failure)}`);
    }
    console.error(`ATTENDANCE_VOID_DISPOSABLE_EVIDENCE=FAIL failure=${safeError(error)}`);
    console.log(`EVIDENCE_ARTIFACT_PATH=${evidencePath}`);
    throw error;
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

function main() {
  const command = process.argv[2];
  assert(command === 'run', 'usage: node scripts/ci/attendance-void-evidence.js run');
  runEvidence().catch((error) => {
    console.error(`ATTENDANCE_VOID_EVIDENCE_PROCESS=FAIL ${safeError(error)}`);
    process.exitCode = 1;
  });
}

if (require.main === module) main();

module.exports = {
  EXPECTED_CHECK_NAMES,
  assertDisposableUrl,
  closedStateViolations,
  collectPostflight,
  collectPreflight,
  compatibilitySmoke,
  createCheckCollector,
  duplicateLiveSessions,
  evaluateRollbackGuard,
  evidenceDocument,
  formatCheckStatus,
  legacyIntegrity,
  migrationChecksumPostconditions,
  migrationDirectories,
  migrationStatus,
  normalizeStatements,
  redactedSchemaDiffOutput,
  schemaDiffFailureDetails,
  runEmptySchemaDiff,
  runPrisma,
  postflightShapeOk,
  preflightShapeOk,
  prepareBaseline,
  runM1BaselineSchemaDiffs,
  runPostApplySchemaDiffs,
  verifyIdempotentDeploy,
  runEvidence,
  selfiePolicyState,
  validateAttendanceVoidSql
};
