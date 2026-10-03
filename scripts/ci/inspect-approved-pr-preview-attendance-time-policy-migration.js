'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPECTED_MIGRATION = '202610020002_attendance_time_policy_v1';
const EXPECTED_SCHEMA_SHA256 = 'e4143928cfa88d4bad053aff022ad5a7f4ec15c9feb22c864b797317ebdf154b';
const EXPECTED_MIGRATION_SHA256 = '5822719590321945832adf87647ca448773f5eff8cb40b7d35ccdd8cf5f443ee';

const PRISMA_COLUMN_FIELDS = Object.freeze([
  ['attendance_time_policies.id', 'AttendanceTimePolicy', 'id'],
  ['attendance_time_policies.scope_type', 'AttendanceTimePolicy', 'scopeType'],
  ['attendance_time_policies.site_id', 'AttendanceTimePolicy', 'siteId'],
  ['attendance_time_policies.shift_type_id', 'AttendanceTimePolicy', 'shiftTypeId'],
  ['attendance_time_policies.policy', 'AttendanceTimePolicy', 'policy'],
  ['attendance_time_policies.effective_from', 'AttendanceTimePolicy', 'effectiveFrom'],
  ['attendance_time_policies.created_by_user_id', 'AttendanceTimePolicy', 'createdByUserId'],
  ['attendance_time_policies.created_at', 'AttendanceTimePolicy', 'createdAt'],
  ['attendance_events.punctuality', 'AttendanceEvent', 'punctuality'],
  ['attendance_events.checkout_condition', 'AttendanceEvent', 'checkoutCondition'],
  ['attendance_events.time_policy_snapshot', 'AttendanceEvent', 'timePolicySnapshot'],
  ['attendance_pending_events.time_policy_snapshot', 'AttendancePendingEvent', 'timePolicySnapshot'],
].map(([column, model, field]) => Object.freeze({ column, model, field })));

const REQUIRED_INDEXES = Object.freeze([
  'attendance_time_policies_company_effective_idx', 'attendance_time_policies_company_effective_key',
  'attendance_time_policies_site_effective_idx', 'attendance_time_policies_site_effective_key',
  'attendance_time_policies_shift_effective_idx', 'attendance_time_policies_shift_effective_key',
  'attendance_time_policies_created_by_created_idx',
]);
const REQUIRED_CONSTRAINTS = Object.freeze([
  'attendance_time_policies_pkey', 'attendance_time_policies_scope_check',
  'attendance_time_policies_values_check', 'attendance_time_policies_site_fkey',
  'attendance_time_policies_shift_type_fkey', 'attendance_time_policies_created_by_fkey',
  'attendance_events_punctuality_check', 'attendance_events_checkout_condition_check',
]);

const MIGRATION_LEDGER_SQL = [
  'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count,',
  `  CASE WHEN migration_name = '${EXPECTED_MIGRATION}' THEN logs ELSE NULL END AS target_logs`,
  'FROM "_prisma_migrations"',
  'ORDER BY started_at, migration_name',
].join('\n');
const SCHEMA_COLUMNS_SQL = [
  'SELECT table_name, column_name, udt_name, is_nullable, character_maximum_length',
  'FROM information_schema.columns',
  "WHERE table_schema = 'public'",
  "  AND ((table_name = 'attendance_time_policies' AND column_name IN ('id', 'scope_type', 'site_id', 'shift_type_id', 'policy', 'effective_from', 'created_by_user_id', 'created_at'))",
  "    OR (table_name = 'attendance_events' AND column_name IN ('punctuality', 'checkout_condition', 'time_policy_snapshot'))",
  "    OR (table_name = 'attendance_pending_events' AND column_name = 'time_policy_snapshot'))",
].join('\n');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listMigrations(migrationsRoot) {
  if (!migrationsRoot || !fs.existsSync(migrationsRoot)) throw new Error('Pinned migrations unavailable');
  return fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.name))
    .map((entry) => {
      const file = path.join(migrationsRoot, entry.name, 'migration.sql');
      if (!fs.existsSync(file)) throw new Error('Pinned migration file unavailable');
      return { name: entry.name, checksum: sha256File(file) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function safeErrorCode(error) {
  return String(error && (error.code || (error.meta && error.meta.code)) || '').match(/^P\d{4}$/)?.[0] || 'NOT_EXPOSED';
}

function safeFailureCategory(logs) {
  const value = String(logs || '').toLowerCase();
  if (!value.trim()) return 'NO_FAILURE_LOG';
  if (/deadlock|lock timeout|could not obtain lock|statement timeout/.test(value)) return 'TRANSIENT_LOCK_OR_TIMEOUT';
  if (/permission denied|insufficient privilege|not authorized/.test(value)) return 'DATABASE_PRIVILEGE';
  if (/does not exist|undefined table|undefined column|relation .* missing/.test(value)) return 'MISSING_SCHEMA_OBJECT';
  if (/duplicate key|unique constraint|foreign key constraint|check constraint/.test(value)) return 'CONSTRAINT_VIOLATION';
  if (/syntax error|error at or near/.test(value)) return 'MIGRATION_SQL_ERROR';
  return 'UNCLASSIFIED_FAILURE';
}

function prismaCliState(args = {}) {
  const output = String(args.stdout || '') + '\n' + String(args.stderr || '');
  const lower = output.toLowerCase();
  const exitCode = Number.isInteger(args.exitCode) ? args.exitCode : 1;
  const errorCode = output.match(/\bP\d{4}\b/i)?.[0]?.toUpperCase() || 'NONE';
  const names = Array.from(new Set(output.match(/\b\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*\b/g) || []));
  let category = 'UNCLASSIFIED';
  if (/\bP(?:3009|3018)\b/i.test(output) || /failed migration|migration .* failed|failed to apply migration/i.test(lower)) category = 'FAILED_MIGRATION';
  else if (/\bP(?:3005|3008|3011|3015|3017|3019)\b/i.test(output)
    || /applied migration.*missing|migration history.*(?:diverg|differ|mismatch)|database migrations? are out of sync/i.test(lower)) category = 'HISTORY_DIVERGED';
  else if (/following migration(?:\(s\)|s)? have not yet been applied|pending migration/i.test(lower)) {
    category = names.length === 1 && names[0] === EXPECTED_MIGRATION ? 'EXACT_TARGET_PENDING' : 'OTHER_PENDING';
  } else if (exitCode === 0 && /database schema is up to date|no pending migrations|all migrations have been applied/i.test(lower)) category = 'UP_TO_DATE';
  else if (exitCode === 0) category = 'SUCCESS_UNCLASSIFIED';
  return {
    exitCode, errorCode, category,
    pendingNameCount: category === 'EXACT_TARGET_PENDING' || category === 'OTHER_PENDING' ? names.length : 0,
  };
}

function runPrismaMigrateStatus(args = {}) {
  if (!args.schemaPath || !path.isAbsolute(args.schemaPath)) {
    return { exitCode: null, errorCode: 'NOT_EXPOSED', category: 'NOT_RUN', pendingNameCount: 0 };
  }
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = (args.run || spawnSync)(command, ['--no-install', 'prisma', 'migrate', 'status', '--schema', args.schemaPath], {
    env: args.env || process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result && result.error) return { exitCode: null, errorCode: safeErrorCode(result.error), category: 'EXECUTION_FAILED', pendingNameCount: 0 };
  return prismaCliState({ stdout: result && result.stdout, stderr: result && result.stderr, exitCode: result && result.status });
}

function prismaScalarShape(schemaText, modelName, fieldName) {
  const block = String(schemaText || '').match(new RegExp('^model\\s+' + modelName + '\\s*\\{([\\s\\S]*?)^\\}', 'm'));
  if (!block) return null;
  const line = block[1].split(/\r?\n/).find((entry) => new RegExp('^\\s*' + fieldName + '\\s+\\S+').test(entry));
  const match = line && line.match(/^\s*(\w+)\s+(\w+\??)\s+(.*)$/);
  if (!match) return null;
  const native = match[3].match(/@db\.(Uuid|VarChar|JsonB|Timestamptz|Timestamp)(?:\((\d+)\))?/);
  const nativeName = native ? native[1] : '';
  const maxLength = nativeName === 'VarChar' && native[2] ? Number(native[2]) : null;
  const scalar = match[2].replace(/\?$/, '');
  let udtName;
  if (scalar === 'String') udtName = nativeName === 'Uuid' ? 'uuid' : nativeName === 'VarChar' ? 'varchar' : 'text';
  else if (scalar === 'DateTime') udtName = nativeName === 'Timestamptz' ? 'timestamptz' : 'timestamp';
  else if (scalar === 'Json') udtName = nativeName === 'JsonB' || !nativeName ? 'jsonb' : null;
  else return null;
  const mapped = match[3].match(/@map\("([A-Za-z0-9_]+)"\)/);
  return {
    column: mapped ? mapped[1] : match[1],
    udtName,
    nullable: match[2].endsWith('?') ? 'YES' : 'NO',
    maxLength,
  };
}

function readPrismaColumnExpectations(schemaText) {
  const expectations = {};
  for (const field of PRISMA_COLUMN_FIELDS) {
    const parsed = prismaScalarShape(schemaText, field.model, field.field);
    if (!parsed || parsed.column !== field.column.split('.')[1]) return null;
    expectations[field.column] = parsed;
  }
  return expectations;
}

function normalizeSqlType(sqlType) {
  const value = String(sqlType || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (value === 'uuid') return { udtName: 'uuid', maxLength: null };
  if (value === 'jsonb') return { udtName: 'jsonb', maxLength: null };
  if (/^timestamptz(?:\(\d+\))?$/.test(value) || /^timestamp(?:\(\d+\))? with time zone$/.test(value)) return { udtName: 'timestamptz', maxLength: null };
  if (/^timestamp(?:\(\d+\))?$/.test(value) || /^timestamp(?:\(\d+\))? without time zone$/.test(value)) return { udtName: 'timestamp', maxLength: null };
  const varchar = value.match(/^varchar\((\d+)\)$/);
  return varchar ? { udtName: 'varchar', maxLength: Number(varchar[1]) } : null;
}

function migrationColumnType(migrationText, columnName) {
  const pattern = new RegExp('"' + columnName + '"\\s+(UUID|JSONB|TIMESTAMPTZ|TIMESTAMP(?:\\(\\d+\\))?(?:\\s+WITH\\s+TIME\\s+ZONE)?|VARCHAR\\(\\d+\\))(?=\\s|,|$)', 'i');
  const match = String(migrationText || '').match(pattern);
  return match ? match[1].replace(/\s+/g, ' ').toLowerCase() : null;
}

function inspectPrismaMigrationShape(schemaText, migrationText) {
  const modelColumns = readPrismaColumnExpectations(schemaText);
  if (!modelColumns) return { prismaModelParsed: false, migrationMatchesPrisma: false, mismatchCount: null, mismatchColumns: [] };
  const mismatchColumns = [];
  for (const field of PRISMA_COLUMN_FIELDS) {
    const model = modelColumns[field.column];
    const sql = normalizeSqlType(migrationColumnType(migrationText, field.column.split('.')[1]));
    if (!model || !sql || model.udtName !== sql.udtName || model.maxLength !== sql.maxLength) {
      mismatchColumns.push(field.column.split('.')[1]);
    }
  }
  return {
    prismaModelParsed: true,
    migrationMatchesPrisma: mismatchColumns.length === 0,
    mismatchCount: mismatchColumns.length,
    mismatchColumns,
  };
}

async function inspectSchema(prisma, schemaText, migrationText) {
  const tableRows = await prisma.$queryRawUnsafe("SELECT to_regclass('public.attendance_time_policies')::text AS name");
  const tablePresent = (Array.isArray(tableRows) ? tableRows : []).some((row) => ['attendance_time_policies', 'public.attendance_time_policies'].includes(String(row?.name || '')));
  const columnRows = await prisma.$queryRawUnsafe(SCHEMA_COLUMNS_SQL);
  const actual = new Map((Array.isArray(columnRows) ? columnRows : []).map((row) => [
    String(row.table_name) + '.' + String(row.column_name),
    { udtName: String(row?.udt_name || ''), nullable: String(row?.is_nullable || ''), maxLength: row?.character_maximum_length == null ? null : Number(row.character_maximum_length) },
  ]));
  const model = readPrismaColumnExpectations(schemaText);
  const columnsPresent = Boolean(model) && PRISMA_COLUMN_FIELDS.every((field) => actual.has(field.column));
  const modelShapeMismatchCount = model
    ? PRISMA_COLUMN_FIELDS.filter((field) => {
      const observed = actual.get(field.column);
      const expected = model[field.column];
      return !observed || observed.udtName !== expected.udtName || observed.nullable !== expected.nullable || observed.maxLength !== expected.maxLength;
    }).length
    : null;
  const modelShapeMismatchColumns = model
    ? PRISMA_COLUMN_FIELDS.filter((field) => {
      const observed = actual.get(field.column);
      const expected = model[field.column];
      return !observed || observed.udtName !== expected.udtName || observed.nullable !== expected.nullable || observed.maxLength !== expected.maxLength;
    }).map((field) => field.column.split('.')[1])
    : [];
  const modelShapeMatches = modelShapeMismatchCount === 0;

  const indexRows = await prisma.$queryRawUnsafe([
    'SELECT ic.relname AS indexname, ix.indisvalid AS valid',
    'FROM pg_index ix JOIN pg_class tc ON tc.oid = ix.indrelid',
    'JOIN pg_namespace tn ON tn.oid = tc.relnamespace JOIN pg_class ic ON ic.oid = ix.indexrelid',
    "WHERE tn.nspname = 'public' AND tc.relname = 'attendance_time_policies'",
  ].join('\n'));
  const indexes = new Map((Array.isArray(indexRows) ? indexRows : []).map((row) => [String(row?.indexname || ''), row?.valid === true]));
  const indexesPresent = REQUIRED_INDEXES.every((name) => indexes.get(name) === true);

  const constraintRows = await prisma.$queryRawUnsafe([
    'SELECT conname, convalidated FROM pg_constraint',
    "WHERE conrelid IN (to_regclass('public.attendance_time_policies'), to_regclass('public.attendance_events'))",
  ].join('\n'));
  const constraints = new Map((Array.isArray(constraintRows) ? constraintRows : []).map((row) => [String(row?.conname || ''), row?.convalidated === true]));
  const constraintsPresent = REQUIRED_CONSTRAINTS.every((name) => constraints.get(name) === true);

  const rlsRows = await prisma.$queryRawUnsafe([
    'SELECT c.relrowsecurity AS enabled FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace',
    "WHERE n.nspname = 'public' AND c.relname = 'attendance_time_policies'",
  ].join('\n'));
  const rlsEnabled = rlsRows?.length === 1 && rlsRows[0]?.enabled === true;
  const revokeRows = await prisma.$queryRawUnsafe([
    'SELECT',
    "  EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'anon' AND (has_table_privilege(r.oid, 'public.attendance_time_policies', 'SELECT') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'INSERT') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'UPDATE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'DELETE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRUNCATE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'REFERENCES') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRIGGER'))) AS anon_has_any_privilege,",
    "  EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'authenticated' AND (has_table_privilege(r.oid, 'public.attendance_time_policies', 'SELECT') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'INSERT') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'UPDATE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'DELETE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRUNCATE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'REFERENCES') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRIGGER'))) AS authenticated_has_any_privilege",
  ].join('\n'));
  const revokesApplied = revokeRows?.[0]?.anon_has_any_privilege === false && revokeRows?.[0]?.authenticated_has_any_privilege === false;
  const anyExpectedColumn = PRISMA_COLUMN_FIELDS.some((field) => actual.has(field.column));
  const anyExpectedIndex = [...indexes.keys()].some((name) => REQUIRED_INDEXES.includes(name));
  const anyExpectedConstraint = [...constraints.keys()].some((name) => REQUIRED_CONSTRAINTS.includes(name));
  const present = tablePresent || anyExpectedColumn || anyExpectedIndex || anyExpectedConstraint;
  const migrationShape = inspectPrismaMigrationShape(schemaText, migrationText);
  const physicalVerified = tablePresent && columnsPresent && modelShapeMatches && indexesPresent && constraintsPresent
    && rlsEnabled && revokesApplied;
  return {
    readable: true, present, verified: physicalVerified, physicalVerified, tablePresent, columnsPresent, indexesPresent, constraintsPresent,
    rlsEnabled, revokesApplied, modelShapeMatches, modelShapeMismatchCount,
    modelShapeMismatchColumns,
    migrationMatchesPrisma: migrationShape.migrationMatchesPrisma,
    migrationModelMismatchCount: migrationShape.mismatchCount,
    migrationModelMismatchColumns: migrationShape.mismatchColumns,
    missingColumnCount: PRISMA_COLUMN_FIELDS.filter((field) => !actual.has(field.column)).length,
    invalidIndexCount: REQUIRED_INDEXES.filter((name) => indexes.get(name) !== true).length,
    invalidConstraintCount: REQUIRED_CONSTRAINTS.filter((name) => constraints.get(name) !== true).length,
  };
}

function targetRecordFacts(rows, sourceMigrations) {
  const source = new Map((sourceMigrations || []).map((entry) => [entry.name, String(entry.checksum || '').toLowerCase()]));
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => ({
    name: String(row?.migration_name || ''),
    checksum: String(row?.checksum || '').toLowerCase(),
    finished: row?.finished_at != null || row?.finished === true,
    rolledBack: row?.rolled_back_at != null || row?.rolled_back === true,
    logs: String(row?.target_logs ?? row?.logs ?? ''),
    steps: Number.isSafeInteger(Number(row?.applied_steps_count)) && Number(row?.applied_steps_count) >= 0 ? Number(row.applied_steps_count) : null,
  }));
  const targetRows = normalized.filter((row) => row.name === EXPECTED_MIGRATION);
  const target = targetRows.length === 1 ? targetRows[0] : null;
  const unknownCount = normalized.filter((row) => !source.has(row.name)).length;
  const checksumMismatchCount = normalized.filter((row) => source.has(row.name) && row.checksum !== source.get(row.name)).length;
  const duplicateCount = Array.from(new Set(normalized.map((row) => row.name)))
    .reduce((sum, name) => sum + Math.max(0, normalized.filter((row) => row.name === name).length - 1), 0);
  const completed = new Set(normalized.filter((row) => row.finished && !row.rolledBack).map((row) => row.name));
  const otherPendingCount = (sourceMigrations || []).filter((row) => row.name !== EXPECTED_MIGRATION && !completed.has(row.name)).length;
  const otherIncompleteCount = normalized.filter((row) => row.name !== EXPECTED_MIGRATION && !row.finished && !row.rolledBack).length;
  const checksumMatches = target && source.has(target.name) ? target.checksum === source.get(target.name) : null;
  const targetState = !target
    ? targetRows.length ? 'AMBIGUOUS' : 'ABSENT'
    : target.finished && !target.rolledBack ? 'APPLIED'
      : !target.finished && !target.rolledBack ? 'FAILED_OR_INCOMPLETE'
        : target.rolledBack && !target.finished ? 'ROLLED_BACK' : 'INCONSISTENT';
  return {
    readable: true,
    integrityOk: unknownCount === 0 && checksumMismatchCount === 0 && duplicateCount === 0,
    unknownMigrationCount: unknownCount,
    checksumMismatchCount,
    duplicateRecordCount: duplicateCount,
    otherPendingCount,
    otherIncompleteCount,
    targetRecord: targetRows.length === 0 ? 'ABSENT' : targetRows.length === 1 ? 'PRESENT' : 'AMBIGUOUS',
    targetFinishedAt: target ? target.finished ? 'PRESENT' : 'ABSENT' : 'UNKNOWN',
    targetRolledBackAt: target ? target.rolledBack ? 'PRESENT' : 'ABSENT' : 'UNKNOWN',
    targetLogsPresent: target ? target.logs.trim() ? 'YES' : 'NO' : 'UNKNOWN',
    targetAppliedStepsCount: target?.steps ?? 'UNKNOWN',
    targetChecksumMatches: checksumMatches === null ? 'UNKNOWN' : checksumMatches ? 'YES' : 'NO',
    targetFailureCategory: target && target.logs.trim() ? safeFailureCategory(target.logs) : target && !target.finished && !target.rolledBack ? 'NO_FAILURE_LOG' : 'NOT_FAILED',
    targetState,
  };
}

function migrationSchemaClass(history, schema) {
  if (!history?.readable || !schema?.readable) return 'STATUS_READ_FAILED';
  if (!history.integrityOk || history.targetRecord === 'AMBIGUOUS' || history.targetState === 'INCONSISTENT') return 'MIGRATION_HISTORY_INCONSISTENT';
  if (history.otherPendingCount > 0 || history.otherIncompleteCount > 0) return 'OTHER_PENDING_MIGRATIONS';
  if (history.targetState === 'ROLLED_BACK') return 'MIGRATION_ROLLED_BACK';
  if (history.targetState === 'FAILED_OR_INCOMPLETE') return schema.present ? 'FAILED_MIGRATION_SCHEMA_PARTIAL' : 'FAILED_MIGRATION_SCHEMA_ABSENT';
  if (history.targetState === 'ABSENT') {
    if (schema.present) return 'SCHEMA_PRESENT_HISTORY_ABSENT';
    if (schema.migrationMatchesPrisma === false) return 'PRISMA_MIGRATION_SOURCE_MISMATCH';
    return 'EXACTLY_PENDING_SCHEMA_ABSENT';
  }
  if (history.targetState === 'APPLIED') {
    if (!(schema.physicalVerified ?? schema.verified)) return 'HISTORY_APPLIED_SCHEMA_MISSING';
    if (schema.migrationMatchesPrisma === false) return 'PRISMA_MIGRATION_SOURCE_MISMATCH';
    return 'APPLIED_AND_SCHEMA_VALID';
  }
  return 'STATUS_READ_FAILED';
}

function finalizeStatus(historyClass) {
  if (historyClass === 'STATUS_READ_FAILED') return { state: 'STATUS_READ_FAILED', reason: 'READ_FAILURE' };
  if (historyClass === 'MIGRATION_HISTORY_INCONSISTENT') return { state: historyClass, reason: 'LEDGER_INCONSISTENT' };
  const reasonByState = {
    PRISMA_MIGRATION_SOURCE_MISMATCH: 'SOURCE_SHAPE_MISMATCH',
    HISTORY_APPLIED_SCHEMA_MISSING: 'PHYSICAL_SCHEMA_INCOMPLETE',
    FAILED_MIGRATION_SCHEMA_ABSENT: 'FAILED_RECORD_SCHEMA_ABSENT',
    FAILED_MIGRATION_SCHEMA_PARTIAL: 'FAILED_RECORD_SCHEMA_PARTIAL',
    SCHEMA_PRESENT_HISTORY_ABSENT: 'SCHEMA_WITHOUT_LEDGER_RECORD',
    OTHER_PENDING_MIGRATIONS: 'UNEXPECTED_PENDING_MIGRATIONS',
    MIGRATION_ROLLED_BACK: 'TARGET_MIGRATION_ROLLED_BACK',
  };
  return { state: historyClass, reason: reasonByState[historyClass] || 'NONE' };
}

async function inspectPreviewMigrationState(args = {}) {
  const env = args.env || process.env;
  const log = args.log || console.log;
  const applicationRoot = args.applicationRoot || process.env.APPLICATION_SOURCE_ROOT;
  const releaseControlRoot = args.releaseControlRoot || process.env.RELEASE_CONTROL_ROOT;
  let client;
  let ownedClient = false;
  let history = { readable: false, targetRecord: 'UNKNOWN' };
  let schema = { readable: false, present: false, verified: false };
  let sourceShape = { prismaModelParsed: false, migrationMatchesPrisma: false, mismatchCount: null, mismatchColumns: [] };
  let prismaStatus = { exitCode: null, errorCode: 'NOT_EXPOSED', category: 'NOT_RUN', pendingNameCount: 0 };
  let result = { state: 'STATUS_READ_FAILED', history, schema, sourceShape, prismaStatus, reason: 'READ_FAILURE' };
  try {
    if (typeof args.targetGuard === 'function') args.targetGuard({ env, log });
    else {
      const guardPath = path.join(releaseControlRoot || '', 'scripts', 'ci', 'verify-preview-migration-target.js');
      require(guardPath).verifyPreviewMigrationTarget({ env, log });
    }
    if (String(env.VERCEL_ENV || '').toLowerCase() !== 'preview' || !env.DATABASE_URL || !env.DIRECT_URL) throw new Error('Preview inspection unavailable');
    const schemaPath = path.join(applicationRoot || '', 'prisma', 'schema.prisma');
    const migrationsRoot = path.join(applicationRoot || '', 'prisma', 'migrations');
    const migrationPath = path.join(migrationsRoot, EXPECTED_MIGRATION, 'migration.sql');
    if (!path.isAbsolute(schemaPath) || !fs.existsSync(schemaPath) || !fs.existsSync(migrationPath)) throw new Error('Pinned source unavailable');
    if (sha256File(schemaPath) !== (args.expectedSchemaSha256 || EXPECTED_SCHEMA_SHA256)
      || sha256File(migrationPath) !== (args.expectedMigrationSha256 || EXPECTED_MIGRATION_SHA256)) throw new Error('Pinned source checksum mismatch');
    const sourceMigrations = listMigrations(migrationsRoot);
    if (sourceMigrations.filter((entry) => entry.name === EXPECTED_MIGRATION).length !== 1) throw new Error('Pinned migration identity ambiguous');
    const schemaText = fs.readFileSync(schemaPath, 'utf8');
    const migrationText = fs.readFileSync(migrationPath, 'utf8');
    sourceShape = inspectPrismaMigrationShape(schemaText, migrationText);
    if (args.prisma) client = args.prisma;
    else {
      const { PrismaClient } = require('@prisma/client');
      client = new PrismaClient();
      ownedClient = true;
    }
    try {
      history = targetRecordFacts(await client.$queryRawUnsafe(MIGRATION_LEDGER_SQL), sourceMigrations);
    } catch (error) {
      history = { readable: false, targetRecord: 'UNKNOWN', ledgerErrorCode: safeErrorCode(error) };
    }
    try {
      schema = await inspectSchema(client, schemaText, migrationText);
    } catch (error) {
      schema = { readable: false, present: false, verified: false, schemaErrorCode: safeErrorCode(error) };
    }
    prismaStatus = runPrismaMigrateStatus({ schemaPath, env, run: args.run || spawnSync });
    schema.migrationMatchesPrisma = sourceShape.migrationMatchesPrisma;
    schema.migrationModelMismatchCount = sourceShape.mismatchCount;
    schema.migrationModelMismatchColumns = sourceShape.mismatchColumns;
    const historyClass = migrationSchemaClass(history, schema);
    const final = finalizeStatus(historyClass);
    result = { state: final.state, reason: final.reason, historyClass, history, schema, sourceShape, prismaStatus };
    const outputRows = [
      ['MIGRATION_HISTORY_CLASS', historyClass],
      ['MIGRATION_STATUS_CLASS', result.state],
      ['MIGRATION_STATUS_REASON', result.reason],
      ['TARGET_MIGRATION_RECORD', history.targetRecord || 'UNKNOWN'],
      ['TARGET_MIGRATION_FINISHED_AT', history.targetFinishedAt || 'UNKNOWN'],
      ['TARGET_MIGRATION_ROLLED_BACK_AT', history.targetRolledBackAt || 'UNKNOWN'],
      ['TARGET_MIGRATION_LOGS_PRESENT', history.targetLogsPresent || 'UNKNOWN'],
      ['TARGET_MIGRATION_APPLIED_STEPS_COUNT', Number.isSafeInteger(history.targetAppliedStepsCount) ? history.targetAppliedStepsCount : 'UNKNOWN'],
      ['TARGET_MIGRATION_CHECKSUM_MATCHES', history.targetChecksumMatches || 'UNKNOWN'],
      ['TARGET_MIGRATION_FAILURE_CATEGORY', history.targetFailureCategory || 'UNKNOWN'],
      ['OTHER_PENDING_MIGRATIONS_COUNT', Number.isInteger(history.otherPendingCount) ? history.otherPendingCount : 'UNKNOWN'],
      ['OTHER_INCOMPLETE_MIGRATIONS_COUNT', Number.isInteger(history.otherIncompleteCount) ? history.otherIncompleteCount : 'UNKNOWN'],
      ['UNKNOWN_MIGRATION_RECORD_COUNT', Number.isInteger(history.unknownMigrationCount) ? history.unknownMigrationCount : 'UNKNOWN'],
      ['CHECKSUM_MISMATCH_COUNT', Number.isInteger(history.checksumMismatchCount) ? history.checksumMismatchCount : 'UNKNOWN'],
      ['DUPLICATE_MIGRATION_RECORD_COUNT', Number.isInteger(history.duplicateRecordCount) ? history.duplicateRecordCount : 'UNKNOWN'],
      ['EXPECTED_POLICY_TABLE', schema.readable ? schema.tablePresent ? 'PRESENT' : 'ABSENT' : 'UNKNOWN'],
      ['EXPECTED_REQUIRED_COLUMNS', schema.readable ? schema.columnsPresent ? 'PRESENT' : 'ABSENT' : 'UNKNOWN'],
      ['EXPECTED_INDEXES', schema.readable ? schema.indexesPresent ? 'PRESENT' : 'ABSENT' : 'UNKNOWN'],
      ['EXPECTED_CONSTRAINTS', schema.readable ? schema.constraintsPresent ? 'PRESENT' : 'ABSENT' : 'UNKNOWN'],
      ['PRISMA_MODEL_DATABASE_SHAPE_MATCH', schema.readable ? schema.modelShapeMatches ? 'YES' : 'NO' : 'UNKNOWN'],
      ['PRISMA_MODEL_MIGRATION_SHAPE_MATCH', sourceShape.migrationMatchesPrisma ? 'YES' : 'NO'],
      ['PRISMA_MIGRATION_SOURCE_MISMATCH_COLUMNS', sourceShape.mismatchColumns.length ? sourceShape.mismatchColumns.join(',') : 'NONE'],
      ['PHYSICAL_SCHEMA_INVARIANTS', schema.physicalVerified ? 'PASS' : schema.readable ? 'FAIL' : 'UNKNOWN'],
      ['SCHEMA_INVARIANTS', schema.verified ? 'PASS' : schema.readable ? 'FAIL' : 'UNKNOWN'],
      ['MISSING_COLUMN_COUNT', Number.isInteger(schema.missingColumnCount) ? schema.missingColumnCount : 'UNKNOWN'],
      ['MODEL_SHAPE_MISMATCH_COUNT', Number.isInteger(schema.modelShapeMismatchCount) ? schema.modelShapeMismatchCount : 'UNKNOWN'],
      ['MISSING_OR_INVALID_INDEX_COUNT', Number.isInteger(schema.invalidIndexCount) ? schema.invalidIndexCount : 'UNKNOWN'],
      ['MISSING_OR_INVALID_CONSTRAINT_COUNT', Number.isInteger(schema.invalidConstraintCount) ? schema.invalidConstraintCount : 'UNKNOWN'],
      ['RLS_ENABLED', schema.readable ? schema.rlsEnabled ? 'YES' : 'NO' : 'UNKNOWN'],
      ['ANON_AUTHENTICATED_REVOKES', schema.readable ? schema.revokesApplied ? 'PASS' : 'FAIL' : 'UNKNOWN'],
      ['PRISMA_MIGRATE_EXIT_CODE', Number.isInteger(prismaStatus.exitCode) ? prismaStatus.exitCode : 'UNKNOWN'],
      ['PRISMA_MIGRATE_ERROR_CODE', prismaStatus.errorCode || 'NOT_EXPOSED'],
      ['PRISMA_MIGRATE_CATEGORY', prismaStatus.category || 'UNKNOWN'],
      ['RAW_DATABASE_OUTPUT_EMITTED', 'false'],
      ['RAW_MIGRATION_LOGS_EMITTED', 'false'],
      ['RAW_CONNECTION_VALUES_EMITTED', 'false'],
    ];
    for (const row of outputRows) log(row[0] + '=' + row[1]);
  } catch (error) {
    result = {
      state: 'STATUS_READ_FAILED',
      reason: 'INSPECTION_SETUP_FAILED',
      history,
      schema,
      sourceShape,
      prismaStatus,
      inspectionErrorCode: safeErrorCode(error),
    };
    log('MIGRATION_STATUS_CLASS=STATUS_READ_FAILED');
    log('MIGRATION_STATUS_REASON=' + result.reason);
    log('INSPECTION_ERROR_CODE=' + result.inspectionErrorCode);
    log('RAW_DATABASE_OUTPUT_EMITTED=false');
    log('RAW_MIGRATION_LOGS_EMITTED=false');
    log('RAW_CONNECTION_VALUES_EMITTED=false');
  } finally {
    if (ownedClient && client) await client.$disconnect().catch(() => {});
  }
  return result;
}

function writeOutputs(result, outputPath) {
  const applied = result.history?.targetFinishedAt === 'PRESENT' && result.history?.targetRolledBackAt === 'ABSENT'
    ? 'YES' : result.history?.targetRecord === 'ABSENT' ? 'NO' : 'UNKNOWN';
  const rows = [
    'migration_class=' + result.state,
    'migration_reason=' + (result.reason || 'UNKNOWN'),
    'history_class=' + (result.historyClass || 'UNKNOWN'),
    'migration_applied=' + applied,
    'target_record=' + (result.history?.targetRecord || 'UNKNOWN'),
    'target_finished_at=' + (result.history?.targetFinishedAt || 'UNKNOWN'),
    'target_rolled_back_at=' + (result.history?.targetRolledBackAt || 'UNKNOWN'),
    'target_failure_category=' + (result.history?.targetFailureCategory || 'UNKNOWN'),
    'other_pending_count=' + (Number.isInteger(result.history?.otherPendingCount) ? result.history.otherPendingCount : 'UNKNOWN'),
    'schema_objects=' + (result.schema?.readable
      ? ['table=' + (result.schema.tablePresent ? 'PRESENT' : 'ABSENT'),
        'columns=' + (result.schema.columnsPresent ? 'PRESENT' : 'ABSENT'),
        'indexes=' + (result.schema.indexesPresent ? 'PRESENT' : 'ABSENT'),
        'constraints=' + (result.schema.constraintsPresent ? 'PRESENT' : 'ABSENT')].join('; ')
      : 'UNKNOWN'),
    'model_database_shape=' + (result.schema?.readable ? result.schema.modelShapeMatches ? 'YES' : 'NO' : 'UNKNOWN'),
    'model_migration_shape=' + (result.schema?.readable ? result.schema.migrationMatchesPrisma ? 'YES' : 'NO' : 'UNKNOWN'),
    'migration_source_mismatch_columns=' + (result.sourceShape?.mismatchColumns?.length ? result.sourceShape.mismatchColumns.join(',') : 'NONE'),
    'physical_schema_verified=' + (result.schema?.physicalVerified ? 'YES' : result.schema?.readable ? 'NO' : 'UNKNOWN'),
    'schema_verified=' + (result.schema?.verified ? 'YES' : result.schema?.readable ? 'NO' : 'UNKNOWN'),
    'preview_get_allowed=' + (result.state === 'APPLIED_AND_SCHEMA_VALID' && result.schema?.physicalVerified && result.sourceShape?.migrationMatchesPrisma ? 'YES' : 'NO'),
  ];
  if (outputPath) fs.appendFileSync(outputPath, rows.join('\n') + '\n', { encoding: 'utf8' });
  return rows;
}

async function main() {
  const result = await inspectPreviewMigrationState();
  writeOutputs(result, process.env.GITHUB_OUTPUT);
  return result.state === 'STATUS_READ_FAILED' ? 1 : 0;
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  EXPECTED_MIGRATION,
  EXPECTED_MIGRATION_SHA256,
  EXPECTED_SCHEMA_SHA256,
  MIGRATION_LEDGER_SQL,
  PRISMA_COLUMN_FIELDS,
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
  SCHEMA_COLUMNS_SQL,
  finalizeStatus,
  inspectPrismaMigrationShape,
  inspectPreviewMigrationState,
  inspectSchema,
  listMigrations,
  migrationSchemaClass,
  prismaCliState,
  prismaScalarShape,
  readPrismaColumnExpectations,
  runPrismaMigrateStatus,
  safeErrorCode,
  safeFailureCategory,
  targetRecordFacts,
  writeOutputs,
};
