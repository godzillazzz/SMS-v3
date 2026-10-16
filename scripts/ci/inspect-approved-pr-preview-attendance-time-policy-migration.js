'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXPECTED_MIGRATION = '202610020002_attendance_time_policy_v1';
const EXPECTED_SCHEMA_SHA256 = '4f0c0b129b8b52826ddca8ddb03ddbd678ef25ea96fa22aa1928e406e4112d03';
const EXPECTED_MIGRATION_SHA256 = '5822719590321945832adf87647ca448773f5eff8cb40b7d35ccdd8cf5f443ee';
const SAFE_MIGRATION_NAME = /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/;

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
  'SELECT c.relname AS table_name, a.attname AS column_name, t.typname AS udt_name,',
  "  CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,",
  '  CASE WHEN t.typname = \'varchar\' AND a.atttypmod >= 4 THEN (a.atttypmod - 4)::integer ELSE NULL::integer END AS character_maximum_length',
  'FROM pg_catalog.pg_class c',
  'JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace',
  'JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid',
  'JOIN pg_catalog.pg_type t ON t.oid = a.atttypid',
  "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')",
  '  AND a.attnum > 0 AND NOT a.attisdropped',
  "  AND ((c.relname = 'attendance_time_policies' AND a.attname IN ('id', 'scope_type', 'site_id', 'shift_type_id', 'policy', 'effective_from', 'created_by_user_id', 'created_at'))",
  "    OR (c.relname = 'attendance_events' AND a.attname IN ('punctuality', 'checkout_condition', 'time_policy_snapshot'))",
  "    OR (c.relname = 'attendance_pending_events' AND a.attname = 'time_policy_snapshot'))",
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

function safeSchemaReadCategory(error) {
  if (error?.schemaReadCategory === 'SCHEMA_RESULT_MALFORMED') return 'SCHEMA_RESULT_MALFORMED';
  const codes = [error?.code, error?.meta?.code, error?.cause?.code]
    .filter((value) => value != null)
    .map((value) => String(value).toUpperCase());
  const messages = [error?.message, error?.meta?.message, error?.cause?.message]
    .filter((value) => value != null)
    .map((value) => String(value).toLowerCase())
    .join(' ');
  if (codes.some((code) => ['42501', 'P1010'].includes(code)) || /permission denied|insufficient privilege|not authorized/.test(messages)) {
    return 'SCHEMA_READ_PERMISSION_DENIED';
  }
  if (codes.some((code) => ['P1001', 'P1000', 'P1017', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code)
    || /^08[A-Z0-9]{3}$/.test(code)) || /can't reach database|connection refused|connection reset|could not connect|server closed the connection/.test(messages)) {
    return 'SCHEMA_CONNECTION_FAILED';
  }
  if (codes.some((code) => ['P1002', 'P1008', '57014', 'ETIMEDOUT'].includes(code))
    || /timed out|timeout|query canceled|statement timeout/.test(messages)) {
    return 'SCHEMA_QUERY_TIMEOUT';
  }
  if (codes.some((code) => ['P2021', 'P2022', '42P01', '42703', '3F000'].includes(code))
    || /does not exist|undefined table|undefined column|relation .* missing/.test(messages)) {
    return 'SCHEMA_OBJECT_NOT_FOUND';
  }
  if (codes.some((code) => ['P2010', '42601'].includes(code)) || /raw query failed|syntax error|error at or near/.test(messages)) {
    return 'SCHEMA_CATALOG_QUERY_FAILED';
  }
  return 'SCHEMA_READ_UNKNOWN';
}

function schemaReadFailure(error, stage) {
  const failure = new Error('Schema inspection failed');
  failure.schemaReadCategory = safeSchemaReadCategory(error);
  failure.schemaReadStage = stage;
  return failure;
}

async function runSchemaQuery(prisma, sql, stage, validateRow) {
  let rows;
  try {
    rows = await prisma.$queryRawUnsafe(sql);
  } catch (error) {
    throw schemaReadFailure(error, stage);
  }
  if (!Array.isArray(rows) || rows.some((row) => !validateRow(row))) {
    throw schemaReadFailure(Object.assign(new Error('Malformed catalog result'), { schemaReadCategory: 'SCHEMA_RESULT_MALFORMED' }), stage);
  }
  return rows;
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prismaModelShape(schemaText, modelName) {
  const block = String(schemaText || '').match(new RegExp('^model\\s+' + escapeRegExp(modelName) + '\\s*\\{([\\s\\S]*?)^\\}', 'm'));
  if (!block) return null;
  const tableMap = block[1].match(/^\s*@@map\s*\(\s*"([^"]+)"\s*\)/m);
  return {
    body: block[1],
    modelName,
    table: tableMap ? tableMap[1] : modelName,
    tableMapped: Boolean(tableMap),
  };
}

function prismaScalarShape(schemaText, modelName, fieldName) {
  const model = prismaModelShape(schemaText, modelName);
  if (!model) return null;
  const line = model.body.split(/\r?\n/).find((entry) => new RegExp('^\\s*' + escapeRegExp(fieldName) + '\\s+\\S+').test(entry));
  const match = line && line.match(/^\s*(\w+)\s+(\w+\??)(?:\s+(.*))?$/);
  if (!match) return null;
  const attributes = match[3] || '';
  const native = attributes.match(/@db\.(Uuid|VarChar|JsonB|Timestamptz|Timestamp)(?:\((\d+)\))?/);
  const nativeName = native ? native[1] : '';
  const maxLength = nativeName === 'VarChar' && native[2] ? Number(native[2]) : null;
  const scalar = match[2].replace(/\?$/, '');
  let udtName;
  if (scalar === 'String') udtName = nativeName === 'Uuid' ? 'uuid' : nativeName === 'VarChar' ? 'varchar' : 'text';
  else if (scalar === 'DateTime') udtName = nativeName === 'Timestamptz' ? 'timestamptz' : 'timestamp';
  else if (scalar === 'Json') udtName = nativeName === 'JsonB' || !nativeName ? 'jsonb' : null;
  else return null;
  const mapped = attributes.match(/@map\s*\(\s*"([^"]+)"\s*\)/);
  return {
    model: modelName,
    table: model.table,
    column: mapped ? mapped[1] : match[1],
    fieldMapped: Boolean(mapped),
    tableMapped: model.tableMapped,
    udtName,
    nullable: match[2].endsWith('?') ? 'YES' : 'NO',
    maxLength,
  };
}

function inspectPrismaMappings(schemaText) {
  const columns = {};
  const tableMappingMismatchModels = new Set();
  const fieldMappingMismatchColumns = [];
  for (const field of PRISMA_COLUMN_FIELDS) {
    const parsed = prismaScalarShape(schemaText, field.model, field.field);
    const [expectedTable, expectedColumn] = field.column.split('.');
    if (!parsed) return { prismaModelParsed: false, mappingMatches: false, columns: {}, tableMappingMismatchModels: [], fieldMappingMismatchColumns: [] };
    if (parsed.table !== expectedTable) tableMappingMismatchModels.add(field.model);
    if (parsed.column !== expectedColumn) fieldMappingMismatchColumns.push(field.column);
    columns[field.column] = parsed;
  }
  return {
    prismaModelParsed: true,
    mappingMatches: tableMappingMismatchModels.size === 0 && fieldMappingMismatchColumns.length === 0,
    columns,
    tableMappingMismatchModels: [...tableMappingMismatchModels].sort(),
    fieldMappingMismatchColumns,
  };
}

function readPrismaColumnExpectations(schemaText) {
  const mappings = inspectPrismaMappings(schemaText);
  return mappings.prismaModelParsed && mappings.mappingMatches ? mappings.columns : null;
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
  const mappings = inspectPrismaMappings(schemaText);
  if (!mappings.prismaModelParsed) {
    return {
      prismaModelParsed: false, mappingMatches: false, mappingMismatchCount: null,
      tableMappingMismatchModels: [], fieldMappingMismatchColumns: [], typeShapeMatches: false,
      typeMismatchCount: null, typeMismatchColumns: [], migrationMatchesPrisma: false, mismatchCount: null, mismatchColumns: [],
    };
  }
  const typeMismatchColumns = [];
  for (const field of PRISMA_COLUMN_FIELDS) {
    const model = mappings.columns[field.column];
    const expectedColumn = field.column.split('.')[1];
    const sql = normalizeSqlType(migrationColumnType(migrationText, expectedColumn));
    if (!model || !sql || model.udtName !== sql.udtName || model.maxLength !== sql.maxLength) {
      typeMismatchColumns.push(field.column);
    }
  }
  const mismatchColumns = [...mappings.fieldMappingMismatchColumns, ...typeMismatchColumns]
    .map((column) => column.split('.')[1]);
  return {
    prismaModelParsed: true,
    mappingMatches: mappings.mappingMatches,
    mappingMismatchCount: mappings.tableMappingMismatchModels.length + mappings.fieldMappingMismatchColumns.length,
    tableMappingMismatchModels: mappings.tableMappingMismatchModels,
    fieldMappingMismatchColumns: mappings.fieldMappingMismatchColumns,
    typeShapeMatches: typeMismatchColumns.length === 0,
    typeMismatchCount: typeMismatchColumns.length,
    typeMismatchColumns,
    migrationMatchesPrisma: mappings.mappingMatches && typeMismatchColumns.length === 0,
    mismatchCount: mismatchColumns.length,
    mismatchColumns,
  };
}

async function inspectSchema(prisma, schemaText, migrationText) {
  const tableRows = await runSchemaQuery(prisma, "SELECT to_regclass('public.attendance_time_policies')::text AS name", 'TABLE_LOOKUP',
    (row) => row && Object.prototype.hasOwnProperty.call(row, 'name') && (row.name === null || typeof row.name === 'string'));
  if (tableRows.length !== 1) throw schemaReadFailure(Object.assign(new Error(), { schemaReadCategory: 'SCHEMA_RESULT_MALFORMED' }), 'TABLE_LOOKUP');
  const tablePresent = ['attendance_time_policies', 'public.attendance_time_policies'].includes(String(tableRows[0]?.name || ''));
  const columnRows = await runSchemaQuery(prisma, SCHEMA_COLUMNS_SQL, 'COLUMNS',
    (row) => row && typeof row.table_name === 'string' && typeof row.column_name === 'string'
      && typeof row.udt_name === 'string' && ['YES', 'NO'].includes(String(row.is_nullable))
      && (row.character_maximum_length == null || Number.isSafeInteger(Number(row.character_maximum_length))));
  const actual = new Map(columnRows.map((row) => [
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

  const indexRows = await runSchemaQuery(prisma, [
    'SELECT ic.relname AS indexname, ix.indisvalid AS valid',
    'FROM pg_index ix JOIN pg_class tc ON tc.oid = ix.indrelid',
    'JOIN pg_namespace tn ON tn.oid = tc.relnamespace JOIN pg_class ic ON ic.oid = ix.indexrelid',
    "WHERE tn.nspname = 'public' AND tc.relname = 'attendance_time_policies'",
  ].join('\n'), 'INDEXES', (row) => row && typeof row.indexname === 'string' && typeof row.valid === 'boolean');
  const indexes = new Map(indexRows.map((row) => [String(row.indexname), row.valid]));
  const indexesPresent = REQUIRED_INDEXES.every((name) => indexes.get(name) === true);

  const constraintRows = await runSchemaQuery(prisma, [
    'SELECT conname, convalidated FROM pg_constraint',
    "WHERE conrelid IN (to_regclass('public.attendance_time_policies'), to_regclass('public.attendance_events'))",
  ].join('\n'), 'CONSTRAINTS', (row) => row && typeof row.conname === 'string' && typeof row.convalidated === 'boolean');
  const constraints = new Map(constraintRows.map((row) => [String(row.conname), row.convalidated]));
  const constraintsPresent = REQUIRED_CONSTRAINTS.every((name) => constraints.get(name) === true);

  const rlsRows = await runSchemaQuery(prisma, [
    'SELECT c.relrowsecurity AS enabled FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace',
    "WHERE n.nspname = 'public' AND c.relname = 'attendance_time_policies'",
  ].join('\n'), 'RLS', (row) => row && typeof row.enabled === 'boolean');
  if (rlsRows.length > 1) throw schemaReadFailure(Object.assign(new Error(), { schemaReadCategory: 'SCHEMA_RESULT_MALFORMED' }), 'RLS');
  const rlsEnabled = rlsRows.length === 1 && rlsRows[0].enabled === true;
  const revokeRows = await runSchemaQuery(prisma, [
    'SELECT',
    "  EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'anon') AS anon_role_exists,",
    "  EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'authenticated') AS authenticated_role_exists,",
    "  CASE WHEN to_regclass('public.attendance_time_policies') IS NULL THEN NULL::boolean ELSE EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'anon' AND (has_table_privilege(r.oid, 'public.attendance_time_policies', 'SELECT') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'INSERT') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'UPDATE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'DELETE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRUNCATE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'REFERENCES') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRIGGER'))) END AS anon_has_any_privilege,",
    "  CASE WHEN to_regclass('public.attendance_time_policies') IS NULL THEN NULL::boolean ELSE EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'authenticated' AND (has_table_privilege(r.oid, 'public.attendance_time_policies', 'SELECT') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'INSERT') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'UPDATE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'DELETE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRUNCATE') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'REFERENCES') OR has_table_privilege(r.oid, 'public.attendance_time_policies', 'TRIGGER'))) END AS authenticated_has_any_privilege",
  ].join('\n'), 'REVOKES', (row) => row && typeof row.anon_role_exists === 'boolean' && typeof row.authenticated_role_exists === 'boolean'
    && (row.anon_has_any_privilege === null || typeof row.anon_has_any_privilege === 'boolean')
    && (row.authenticated_has_any_privilege === null || typeof row.authenticated_has_any_privilege === 'boolean'));
  if (revokeRows.length !== 1) throw schemaReadFailure(Object.assign(new Error(), { schemaReadCategory: 'SCHEMA_RESULT_MALFORMED' }), 'REVOKES');
  const revokeFacts = revokeRows[0];
  const revokesApplied = tablePresent && revokeFacts.anon_role_exists === true && revokeFacts.authenticated_role_exists === true
    && revokeFacts.anon_has_any_privilege === false && revokeFacts.authenticated_has_any_privilege === false;
  const anyExpectedColumn = PRISMA_COLUMN_FIELDS.some((field) => actual.has(field.column));
  const anyExpectedIndex = [...indexes.keys()].some((name) => REQUIRED_INDEXES.includes(name));
  const anyExpectedConstraint = [...constraints.keys()].some((name) => REQUIRED_CONSTRAINTS.includes(name));
  const present = tablePresent || anyExpectedColumn || anyExpectedIndex || anyExpectedConstraint;
  const migrationShape = inspectPrismaMigrationShape(schemaText, migrationText);
  const mappings = inspectPrismaMappings(schemaText);
  const physicalVerified = tablePresent && columnsPresent && modelShapeMatches && indexesPresent && constraintsPresent
    && rlsEnabled && revokesApplied;
  return {
    readable: true, schemaReadCategory: 'SCHEMA_READ_OK', schemaReadStage: 'COMPLETE', present, verified: physicalVerified, physicalVerified, tablePresent, columnsPresent, indexesPresent, constraintsPresent,
    rlsEnabled, revokesApplied, modelShapeMatches, modelShapeMismatchCount,
    modelShapeMismatchColumns,
    mappingMatches: mappings.mappingMatches,
    mappingMismatchCount: migrationShape.mappingMismatchCount,
    tableMappingMismatchModels: mappings.tableMappingMismatchModels,
    fieldMappingMismatchColumns: mappings.fieldMappingMismatchColumns,
    migrationMatchesPrisma: migrationShape.migrationMatchesPrisma,
    migrationTypeShapeMatches: migrationShape.typeShapeMatches,
    migrationTypeMismatchCount: migrationShape.typeMismatchCount,
    migrationTypeMismatchColumns: migrationShape.typeMismatchColumns,
    migrationModelMismatchCount: migrationShape.mismatchCount,
    migrationModelMismatchColumns: migrationShape.mismatchColumns,
    missingColumnCount: PRISMA_COLUMN_FIELDS.filter((field) => !actual.has(field.column)).length,
    invalidIndexCount: REQUIRED_INDEXES.filter((name) => indexes.get(name) !== true).length,
    invalidConstraintCount: REQUIRED_CONSTRAINTS.filter((name) => constraints.get(name) !== true).length,
  };
}

function safeMigrationName(name) {
  const value = String(name || '');
  return value.length <= 128 && SAFE_MIGRATION_NAME.test(value) ? value : 'UNSAFE_NAME_REDACTED';
}

function migrationRecordState(row) {
  if (row.finished && !row.rolledBack) return 'COMPLETED';
  if (!row.finished && row.rolledBack) return 'ROLLED_BACK';
  if (!row.finished && !row.rolledBack) return 'FAILED_OR_INCOMPLETE';
  return 'INCONSISTENT';
}

function summarizeMigrationGroup(name, rows, sourceNames) {
  const states = rows.map(migrationRecordState);
  const checksums = rows.map((row) => row.checksum).filter(Boolean);
  const checksumState = checksums.length !== rows.length ? 'UNKNOWN'
    : new Set(checksums).size === 1 ? 'AGREE' : 'DISAGREE';
  const rolledBackCount = rows.filter((row) => row.rolledBack).length;
  const activeRows = rows.filter((row) => !row.rolledBack);
  let completionSummary;
  if (states.every((state) => state === 'ROLLED_BACK')) completionSummary = 'ALL_ROLLED_BACK';
  else if (activeRows.length > 1) completionSummary = 'MULTIPLE_ACTIVE_RECORDS';
  else if (states.some((state) => state === 'INCONSISTENT')) completionSummary = 'INCONSISTENT';
  else if (activeRows.length === 1 && migrationRecordState(activeRows[0]) === 'COMPLETED') {
    completionSummary = rolledBackCount ? 'ROLLED_BACK_THEN_COMPLETED' : 'COMPLETED';
  } else if (activeRows.length === 1) completionSummary = 'FAILED_OR_INCOMPLETE';
  else completionSummary = 'UNKNOWN';
  const classifications = [sourceNames.has(name) ? 'KNOWN_SOURCE_MIGRATION' : 'UNKNOWN_TO_SOURCE'];
  if (rows.length > 1) classifications.push('DUPLICATE_RECORD');
  if (states.includes('FAILED_OR_INCOMPLETE')) classifications.push('FAILED_OR_INCOMPLETE');
  if (states.includes('COMPLETED')) classifications.push('COMPLETED');
  if (states.includes('ROLLED_BACK')) classifications.push('ROLLED_BACK');
  if (states.includes('INCONSISTENT')) classifications.push('INCONSISTENT_RECORD_STATE');
  return {
    name: safeMigrationName(name),
    recordCount: rows.length,
    classifications,
    completionSummary,
    checksumState,
    activeRecordCount: activeRows.length,
    rolledBackRecordCount: rolledBackCount,
  };
}

function migrationInventories(normalized, sourceMigrations) {
  const sourceByName = new Map((sourceMigrations || []).map((entry) => [entry.name, String(entry.checksum || '').toLowerCase()]));
  const sourceNames = new Set(sourceByName.keys());
  const groups = new Map();
  for (const row of normalized) {
    if (!groups.has(row.name)) groups.set(row.name, []);
    groups.get(row.name).push(row);
  }
  const ledgerMigrations = [...groups.entries()]
    .map(([name, rows]) => summarizeMigrationGroup(name, rows, sourceNames))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sourceInventory = (sourceMigrations || []).map((entry) => {
    const rows = groups.get(entry.name) || [];
    let ledgerState;
    if (rows.length === 0) ledgerState = 'MISSING_FROM_LEDGER';
    else if (rows.length > 1) ledgerState = 'DUPLICATED_IN_LEDGER';
    else ledgerState = migrationRecordState(rows[0]);
    return {
      name: safeMigrationName(entry.name),
      sourceState: 'PRESENT_IN_SOURCE',
      ledgerState,
      recordCount: rows.length,
      completionSummary: rows.length ? summarizeMigrationGroup(entry.name, rows, sourceNames).completionSummary : 'NO_LEDGER_RECORD',
    };
  });
  return { groups, ledgerMigrations, sourceInventory, sourceByName, sourceNames };
}

function targetRecordFacts(rows, sourceMigrations) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => ({
    name: String(row?.migration_name || ''),
    checksum: String(row?.checksum || '').toLowerCase(),
    finished: row?.finished_at != null || row?.finished === true,
    rolledBack: row?.rolled_back_at != null || row?.rolled_back === true,
    logs: String(row?.target_logs ?? row?.logs ?? ''),
    steps: Number.isSafeInteger(Number(row?.applied_steps_count)) && Number(row?.applied_steps_count) >= 0 ? Number(row.applied_steps_count) : null,
  }));
  const inventory = migrationInventories(normalized, sourceMigrations);
  const targetRows = inventory.groups.get(EXPECTED_MIGRATION) || [];
  const targetSummary = targetRows.length ? summarizeMigrationGroup(EXPECTED_MIGRATION, targetRows, inventory.sourceNames) : null;
  const targetActiveRows = targetRows.filter((row) => !row.rolledBack);
  const target = targetActiveRows.length === 1 ? targetActiveRows[0] : null;
  const unknownCount = normalized.filter((row) => !inventory.sourceNames.has(row.name)).length;
  const checksumMismatchCount = normalized.filter((row) => inventory.sourceByName.has(row.name)
    && row.checksum !== inventory.sourceByName.get(row.name)).length;
  const duplicateCount = [...inventory.groups.values()].reduce((sum, migrationRows) => sum + Math.max(0, migrationRows.length - 1), 0);
  const duplicateDivergenceCount = inventory.ledgerMigrations.filter((entry) => entry.recordCount > 1
    && (entry.checksumState !== 'AGREE' || entry.completionSummary === 'MULTIPLE_ACTIVE_RECORDS' || entry.completionSummary === 'INCONSISTENT')).length;
  const completed = new Set([...inventory.groups.entries()]
    .filter(([, migrationRows]) => migrationRows.some((row) => row.finished && !row.rolledBack))
    .map(([name]) => name));
  const sourceNames = (sourceMigrations || []).map((row) => row.name);
  const otherPendingNames = (sourceMigrations || [])
    .filter((row) => row.name !== EXPECTED_MIGRATION && !completed.has(row.name))
    .map((row) => safeMigrationName(row.name));
  const otherIncompleteNames = (sourceMigrations || []).filter((row) => row.name !== EXPECTED_MIGRATION)
    .filter((row) => (inventory.groups.get(row.name) || []).some((entry) => !entry.finished && !entry.rolledBack))
    .map((row) => safeMigrationName(row.name));
  const targetIndex = sourceNames.indexOf(EXPECTED_MIGRATION);
  const earlierPendingNames = targetIndex < 0 ? [] : (sourceMigrations || []).slice(0, targetIndex)
    .filter((row) => !completed.has(row.name)).map((row) => safeMigrationName(row.name));
  const targetOrdering = {
    targetPresentInSource: targetIndex >= 0,
    targetSourceIndex: targetIndex >= 0 ? targetIndex : 'UNKNOWN',
    sourceMigrationCount: sourceNames.length,
    earlierPendingNames,
    valid: targetIndex >= 0 && earlierPendingNames.length === 0,
  };
  const targetChecksumMatches = target && inventory.sourceByName.has(target.name)
    ? target.checksum === inventory.sourceByName.get(target.name) : null;
  const targetState = targetRows.length === 0 ? 'ABSENT'
    : targetActiveRows.length > 1 ? 'INCONSISTENT'
      : targetActiveRows.length === 0 ? 'ROLLED_BACK'
        : target.finished && !target.rolledBack ? 'APPLIED'
          : !target.finished && !target.rolledBack ? 'FAILED_OR_INCOMPLETE' : 'INCONSISTENT';
  const integrityOk = unknownCount === 0 && checksumMismatchCount === 0 && duplicateDivergenceCount === 0
    && targetState !== 'INCONSISTENT';
  return {
    readable: true,
    integrityOk,
    unknownMigrationCount: unknownCount,
    unknownMigrationNames: inventory.ledgerMigrations.filter((entry) => entry.classifications.includes('UNKNOWN_TO_SOURCE')).map((entry) => entry.name),
    checksumMismatchCount,
    duplicateRecordCount: duplicateCount,
    duplicateDivergenceCount,
    duplicateMigrationGroups: inventory.ledgerMigrations.filter((entry) => entry.recordCount > 1),
    ledgerMigrations: inventory.ledgerMigrations,
    sourceInventory: inventory.sourceInventory,
    otherPendingCount: otherPendingNames.length,
    otherPendingNames,
    otherIncompleteCount: otherIncompleteNames.length,
    otherIncompleteNames,
    targetRecord: targetRows.length === 0 ? 'ABSENT' : 'PRESENT',
    targetRecordCount: targetRows.length,
    targetFinishedAt: target ? target.finished ? 'PRESENT' : 'ABSENT' : 'UNKNOWN',
    targetRolledBackAt: target ? target.rolledBack ? 'PRESENT' : 'ABSENT' : targetRows.length ? 'PRESENT_IN_HISTORY' : 'UNKNOWN',
    targetLogsPresent: target ? target.logs.trim() ? 'YES' : 'NO' : 'UNKNOWN',
    targetAppliedStepsCount: target?.steps ?? 'UNKNOWN',
    targetChecksumMatches: targetChecksumMatches === null ? 'UNKNOWN' : targetChecksumMatches ? 'YES' : 'NO',
    targetFailureCategory: target && target.logs.trim() ? safeFailureCategory(target.logs) : target && !target.finished && !target.rolledBack ? 'NO_FAILURE_LOG' : 'NOT_FAILED',
    targetState,
    targetOrdering,
  };
}

function validateMigrationLedgerRows(rows) {
  const validNullableTimestamp = (value) => value == null || value instanceof Date || typeof value === 'string';
  const validNullableSteps = (value) => value == null || typeof value === 'bigint'
    || (typeof value === 'number' && Number.isSafeInteger(value));
  const valid = Array.isArray(rows) && rows.every((row) => row && typeof row.migration_name === 'string'
    && typeof row.checksum === 'string'
    && validNullableTimestamp(row.finished_at)
    && validNullableTimestamp(row.rolled_back_at)
    && validNullableSteps(row.applied_steps_count)
    && (row.target_logs == null || typeof row.target_logs === 'string'));
  if (!valid) {
    const error = new Error('Migration ledger result malformed');
    error.ledgerReadCategory = 'LEDGER_RESULT_MALFORMED';
    throw error;
  }
  return rows;
}

function migrationSchemaClass(history, schema) {
  if (!history?.readable) return 'STATUS_READ_FAILED';
  if (!history.integrityOk) return 'HISTORY_DIVERGED';
  if (!schema?.readable) return 'SCHEMA_READ_FAILED';
  if (history.targetState === 'FAILED_OR_INCOMPLETE') return schema.present ? 'FAILED_MIGRATION_SCHEMA_PARTIAL' : 'FAILED_MIGRATION_SCHEMA_ABSENT';
  if (history.targetState === 'ROLLED_BACK') return 'MIGRATION_ROLLED_BACK';
  if (history.otherPendingCount > 0 || history.otherIncompleteCount > 0 || history.targetOrdering?.valid === false) return 'OTHER_PENDING_MIGRATIONS';
  if (history.targetState === 'ABSENT') {
    if (schema.present) return 'SCHEMA_PRESENT_HISTORY_ABSENT';
    if (schema.mappingMatches === false || schema.migrationTypeShapeMatches === false || schema.migrationMatchesPrisma === false) return 'STATUS_READ_FAILED';
    return 'EXACTLY_PENDING_SCHEMA_ABSENT';
  }
  if (history.targetState === 'APPLIED') {
    if (!(schema.physicalVerified ?? schema.verified)) return 'HISTORY_APPLIED_SCHEMA_MISSING';
    if (schema.mappingMatches === false || schema.migrationTypeShapeMatches === false || schema.migrationMatchesPrisma === false) return 'STATUS_READ_FAILED';
    return 'APPLIED_AND_SCHEMA_VALID';
  }
  return 'STATUS_READ_FAILED';
}

function finalizeStatus(historyClass) {
  if (historyClass === 'STATUS_READ_FAILED') return { state: 'STATUS_READ_FAILED', reason: 'READ_FAILURE' };
  if (historyClass === 'MIGRATION_HISTORY_INCONSISTENT') return { state: historyClass, reason: 'LEDGER_INCONSISTENT' };
  const reasonByState = {
    SCHEMA_READ_FAILED: 'SCHEMA_READ_FAILED',
    HISTORY_DIVERGED: 'LEDGER_DIVERGED',
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
  let schema = { readable: false, present: false, verified: false, schemaReadCategory: 'SCHEMA_READ_UNKNOWN', schemaReadStage: 'NOT_RUN' };
  let sourceShape = {
    prismaModelParsed: false, mappingMatches: false, mappingMismatchCount: null,
    tableMappingMismatchModels: [], fieldMappingMismatchColumns: [], typeShapeMatches: false,
    typeMismatchCount: null, typeMismatchColumns: [], migrationMatchesPrisma: false, mismatchCount: null, mismatchColumns: [],
  };
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
      history = targetRecordFacts(validateMigrationLedgerRows(await client.$queryRawUnsafe(MIGRATION_LEDGER_SQL)), sourceMigrations);
    } catch (error) {
      history = { readable: false, targetRecord: 'UNKNOWN', ledgerReadCategory: error?.ledgerReadCategory || safeSchemaReadCategory(error) };
    }
    try {
      schema = await inspectSchema(client, schemaText, migrationText);
    } catch (error) {
      schema = {
        readable: false, present: false, verified: false, physicalVerified: false,
        schemaReadCategory: error?.schemaReadCategory || safeSchemaReadCategory(error),
        schemaReadStage: error?.schemaReadStage || 'UNKNOWN_STAGE',
      };
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
      ['TARGET_MIGRATION_RECORD_COUNT', Number.isInteger(history.targetRecordCount) ? history.targetRecordCount : 'UNKNOWN'],
      ['TARGET_MIGRATION_FINISHED_AT', history.targetFinishedAt || 'UNKNOWN'],
      ['TARGET_MIGRATION_ROLLED_BACK_AT', history.targetRolledBackAt || 'UNKNOWN'],
      ['TARGET_MIGRATION_LOGS_PRESENT', history.targetLogsPresent || 'UNKNOWN'],
      ['TARGET_MIGRATION_APPLIED_STEPS_COUNT', Number.isSafeInteger(history.targetAppliedStepsCount) ? history.targetAppliedStepsCount : 'UNKNOWN'],
      ['TARGET_MIGRATION_CHECKSUM_MATCHES', history.targetChecksumMatches || 'UNKNOWN'],
      ['TARGET_MIGRATION_FAILURE_CATEGORY', history.targetFailureCategory || 'UNKNOWN'],
      ['OTHER_PENDING_MIGRATIONS_COUNT', Number.isInteger(history.otherPendingCount) ? history.otherPendingCount : 'UNKNOWN'],
      ['OTHER_PENDING_MIGRATION_NAMES_JSON', JSON.stringify(history.otherPendingNames || [])],
      ['OTHER_INCOMPLETE_MIGRATIONS_COUNT', Number.isInteger(history.otherIncompleteCount) ? history.otherIncompleteCount : 'UNKNOWN'],
      ['UNKNOWN_MIGRATION_RECORD_COUNT', Number.isInteger(history.unknownMigrationCount) ? history.unknownMigrationCount : 'UNKNOWN'],
      ['UNKNOWN_MIGRATION_NAMES_JSON', JSON.stringify(history.unknownMigrationNames || [])],
      ['CHECKSUM_MISMATCH_COUNT', Number.isInteger(history.checksumMismatchCount) ? history.checksumMismatchCount : 'UNKNOWN'],
      ['DUPLICATE_MIGRATION_RECORD_COUNT', Number.isInteger(history.duplicateRecordCount) ? history.duplicateRecordCount : 'UNKNOWN'],
      ['DUPLICATE_MIGRATION_GROUPS_JSON', JSON.stringify(history.duplicateMigrationGroups || [])],
      ['MIGRATION_LEDGER_INVENTORY_JSON', JSON.stringify(history.ledgerMigrations || [])],
      ['SOURCE_MIGRATION_INVENTORY_JSON', JSON.stringify(history.sourceInventory || [])],
      ['TARGET_MIGRATION_ORDERING_JSON', JSON.stringify(history.targetOrdering || { valid: false })],
      ['EXPECTED_POLICY_TABLE', schema.readable ? schema.tablePresent ? 'PRESENT' : 'ABSENT' : 'UNKNOWN'],
      ['EXPECTED_REQUIRED_COLUMNS', schema.readable ? schema.columnsPresent ? 'PRESENT' : 'ABSENT' : 'UNKNOWN'],
      ['EXPECTED_INDEXES', schema.readable ? schema.indexesPresent ? 'PRESENT' : 'ABSENT' : 'UNKNOWN'],
      ['EXPECTED_CONSTRAINTS', schema.readable ? schema.constraintsPresent ? 'PRESENT' : 'ABSENT' : 'UNKNOWN'],
      ['PRISMA_MODEL_DATABASE_SHAPE_MATCH', schema.readable ? schema.modelShapeMatches ? 'YES' : 'NO' : 'UNKNOWN'],
      ['PRISMA_MODEL_MIGRATION_MAPPING_MATCH', sourceShape.mappingMatches ? 'PASS' : 'FAIL'],
      ['PRISMA_TABLE_MAPPING_MISMATCH_MODELS', sourceShape.tableMappingMismatchModels.length ? sourceShape.tableMappingMismatchModels.join(',') : 'NONE'],
      ['PRISMA_FIELD_MAPPING_MISMATCH_COLUMNS', sourceShape.fieldMappingMismatchColumns.length ? sourceShape.fieldMappingMismatchColumns.join(',') : 'NONE'],
      ['PRISMA_MODEL_MIGRATION_TYPE_SHAPE_MATCH', sourceShape.typeShapeMatches ? 'PASS' : 'FAIL'],
      ['PRISMA_MODEL_MIGRATION_TYPE_MISMATCH_COLUMNS', sourceShape.typeMismatchColumns.length ? sourceShape.typeMismatchColumns.map((column) => column.split('.')[1]).join(',') : 'NONE'],
      ['PHYSICAL_SCHEMA_INVARIANTS', schema.physicalVerified ? 'PASS' : schema.readable ? 'FAIL' : 'UNKNOWN'],
      ['SCHEMA_INVARIANTS', schema.verified ? 'PASS' : schema.readable ? 'FAIL' : 'UNKNOWN'],
      ['SCHEMA_READ_CATEGORY', schema.schemaReadCategory || 'SCHEMA_READ_UNKNOWN'],
      ['SCHEMA_READ_STAGE', schema.schemaReadStage || 'UNKNOWN_STAGE'],
      ['MIGRATION_LEDGER_READ_CATEGORY', history.ledgerReadCategory || 'LEDGER_READ_OK'],
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
  const applied = result.history?.targetState === 'APPLIED' ? 'YES'
    : result.history?.targetRecord === 'ABSENT' && result.schema?.readable && result.schema.present === false
      && result.history?.integrityOk && result.history?.otherPendingCount === 0 ? 'NO' : 'UNKNOWN';
  const retryRequired = result.state === 'EXACTLY_PENDING_SCHEMA_ABSENT' ? 'YES'
    : result.state === 'APPLIED_AND_SCHEMA_VALID' ? 'NO' : 'UNKNOWN';
  const retrySafe = result.state === 'EXACTLY_PENDING_SCHEMA_ABSENT' ? 'YES' : 'NO';
  const rows = [
    'migration_class=' + result.state,
    'migration_reason=' + (result.reason || 'UNKNOWN'),
    'history_class=' + (result.historyClass || 'UNKNOWN'),
    'migration_applied=' + applied,
    'target_record=' + (result.history?.targetRecord || 'UNKNOWN'),
    'target_record_count=' + (Number.isInteger(result.history?.targetRecordCount) ? result.history.targetRecordCount : 'UNKNOWN'),
    'target_finished_at=' + (result.history?.targetFinishedAt || 'UNKNOWN'),
    'target_rolled_back_at=' + (result.history?.targetRolledBackAt || 'UNKNOWN'),
    'target_failure_category=' + (result.history?.targetFailureCategory || 'UNKNOWN'),
    'other_pending_count=' + (Number.isInteger(result.history?.otherPendingCount) ? result.history.otherPendingCount : 'UNKNOWN'),
    'other_pending_names=' + JSON.stringify(result.history?.otherPendingNames || []),
    'unknown_migration_count=' + (Number.isInteger(result.history?.unknownMigrationCount) ? result.history.unknownMigrationCount : 'UNKNOWN'),
    'unknown_migration_names=' + JSON.stringify(result.history?.unknownMigrationNames || []),
    'duplicate_record_count=' + (Number.isInteger(result.history?.duplicateRecordCount) ? result.history.duplicateRecordCount : 'UNKNOWN'),
    'duplicate_groups=' + JSON.stringify(result.history?.duplicateMigrationGroups || []),
    'migration_ledger_inventory=' + JSON.stringify(result.history?.ledgerMigrations || []),
    'source_migration_inventory=' + JSON.stringify(result.history?.sourceInventory || []),
    'target_ordering=' + JSON.stringify(result.history?.targetOrdering || { valid: false }),
    'schema_objects=' + (result.schema?.readable
      ? ['table=' + (result.schema.tablePresent ? 'PRESENT' : 'ABSENT'),
        'columns=' + (result.schema.columnsPresent ? 'PRESENT' : 'ABSENT'),
        'indexes=' + (result.schema.indexesPresent ? 'PRESENT' : 'ABSENT'),
        'constraints=' + (result.schema.constraintsPresent ? 'PRESENT' : 'ABSENT')].join('; ')
      : 'UNKNOWN'),
    'model_database_shape=' + (result.schema?.readable ? result.schema.modelShapeMatches ? 'YES' : 'NO' : 'UNKNOWN'),
    'schema_read_category=' + (result.schema?.schemaReadCategory || 'SCHEMA_READ_UNKNOWN'),
    'schema_read_stage=' + (result.schema?.schemaReadStage || 'UNKNOWN_STAGE'),
    'model_migration_mapping=' + (result.sourceShape?.mappingMatches ? 'PASS' : 'FAIL'),
    'table_mapping_mismatch_models=' + JSON.stringify(result.sourceShape?.tableMappingMismatchModels || []),
    'field_mapping_mismatch_columns=' + JSON.stringify(result.sourceShape?.fieldMappingMismatchColumns || []),
    'model_migration_type_shape=' + (result.sourceShape?.typeShapeMatches ? 'PASS' : 'FAIL'),
    'migration_type_mismatch_columns=' + JSON.stringify((result.sourceShape?.typeMismatchColumns || []).map((column) => column.split('.')[1])),
    'physical_schema_verified=' + (result.schema?.physicalVerified ? 'YES' : result.schema?.readable ? 'NO' : 'UNKNOWN'),
    'schema_verified=' + (result.schema?.verified ? 'YES' : result.schema?.readable ? 'NO' : 'UNKNOWN'),
    'migration_retry_required=' + retryRequired,
    'migration_retry_safe=' + retrySafe,
    'preview_get_allowed=' + (result.state === 'APPLIED_AND_SCHEMA_VALID' && result.schema?.physicalVerified && result.sourceShape?.mappingMatches && result.sourceShape?.typeShapeMatches ? 'YES' : 'NO'),
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
  safeSchemaReadCategory,
  inspectPrismaMappings,
  targetRecordFacts,
  validateMigrationLedgerRows,
  writeOutputs,
};
