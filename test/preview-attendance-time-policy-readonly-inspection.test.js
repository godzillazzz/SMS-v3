'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  EXPECTED_MIGRATION,
  MIGRATION_LEDGER_SQL,
  PRISMA_COLUMN_FIELDS,
  REQUIRED_CONSTRAINTS,
  REQUIRED_INDEXES,
  SCHEMA_COLUMNS_SQL,
  inspectPrismaMigrationShape,
  inspectPreviewMigrationState,
  inspectSchema,
  finalizeStatus,
  migrationSchemaClass,
  prismaCliState,
  readPrismaColumnExpectations,
  safeFailureCategory,
  targetRecordFacts,
  writeOutputs,
} = require('../scripts/ci/inspect-approved-pr-preview-attendance-time-policy-migration');
const {
  approvedPreviewOrigin,
  summarizePolicyBody,
  verifyReadonlyRuntime,
  POLICY_PATH,
} = require('../scripts/ci/verify-preview-attendance-time-policy-readonly-runtime');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/inspect-approved-pr-preview-attendance-time-policy.yml'), 'utf8').replaceAll('\r\n', '\n');

const PRISMA_SCHEMA = [
  'model AttendanceTimePolicy {',
  '  id              String   @id @db.Uuid',
  '  scopeType       String   @map("scope_type") @db.VarChar(20)',
  '  siteId          String?  @map("site_id") @db.Uuid',
  '  shiftTypeId     String?  @map("shift_type_id") @db.Uuid',
  '  policy          Json     @db.JsonB',
  '  effectiveFrom   DateTime @map("effective_from")',
  '  createdByUserId String   @map("created_by_user_id") @db.Uuid',
  '  createdAt       DateTime @map("created_at")',
  '  @@map("attendance_time_policies")',
  '}',
  'model AttendanceEvent {',
  '  punctuality       String? @db.VarChar(16)',
  '  checkoutCondition String? @map("checkout_condition") @db.VarChar(24)',
  '  timePolicySnapshot Json?  @map("time_policy_snapshot")',
  '}',
  'model AttendancePendingEvent {',
  '  timePolicySnapshot Json? @map("time_policy_snapshot")',
  '}',
].join('\n');

function migrationFixture(overrides = {}) {
  const types = {
    id: 'UUID',
    scope_type: 'VARCHAR(20)',
    site_id: 'UUID',
    shift_type_id: 'UUID',
    policy: 'JSONB',
    effective_from: 'TIMESTAMP(3)',
    created_by_user_id: 'UUID',
    created_at: 'TIMESTAMP(3)',
    punctuality: 'VARCHAR(16)',
    checkout_condition: 'VARCHAR(24)',
    time_policy_snapshot: 'JSONB',
    ...overrides,
  };
  return Object.entries(types).map(([name, type]) => '"' + name + '" ' + type + ' NULL,').join('\n');
}

function validSchemaOptions(overrides = {}) {
  const model = readPrismaColumnExpectations(PRISMA_SCHEMA);
  const columns = PRISMA_COLUMN_FIELDS.map((field) => {
    const shape = model[field.column];
    const split = field.column.split('.');
    return {
      table_name: split[0],
      column_name: split[1],
      udt_name: shape.udtName,
      is_nullable: shape.nullable,
      character_maximum_length: shape.maxLength,
    };
  });
  return {
    tablePresent: true,
    columns,
    indexes: REQUIRED_INDEXES.map((indexname) => ({ indexname, valid: true })),
    constraints: REQUIRED_CONSTRAINTS.map((conname) => ({ conname, convalidated: true })),
    rls: true,
    privileges: { anon_has_any_privilege: false, authenticated_has_any_privilege: false },
    ...overrides,
  };
}

function schemaClient(options = validSchemaOptions(), ledgerRows = []) {
  const queries = [];
  return {
    queries,
    async $queryRawUnsafe(sql) {
      queries.push(sql);
      if (sql === MIGRATION_LEDGER_SQL) return ledgerRows;
      if (sql.includes('pg_constraint')) return options.constraints;
      if (sql.includes('to_regclass')) return options.tablePresent ? [{ name: 'attendance_time_policies' }] : [{ name: null }];
      if (sql === SCHEMA_COLUMNS_SQL) return options.columns;
      if (sql.includes('pg_index')) return options.indexes;
      if (sql.includes('relrowsecurity')) return options.rls ? [{ enabled: true }] : [];
      if (sql.includes('has_table_privilege')) return [options.privileges];
      throw new Error('unexpected read-only query');
    },
  };
}

function sourceMigrations(names = [EXPECTED_MIGRATION]) {
  return names.map((name, index) => ({ name, checksum: 'checksum-' + index }));
}

function ledgerRow(overrides = {}) {
  return {
    migration_name: EXPECTED_MIGRATION,
    checksum: 'checksum-0',
    finished_at: new Date('2026-10-01T00:00:00Z'),
    rolled_back_at: null,
    logs: null,
    applied_steps_count: 1,
    ...overrides,
  };
}

function schemaState(overrides = {}) {
  return { readable: true, present: false, verified: false, ...overrides };
}

function inspectorFiles() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-preview-readonly-'));
  const applicationRoot = path.join(tempRoot, 'application');
  const migrationDir = path.join(applicationRoot, 'prisma', 'migrations', EXPECTED_MIGRATION);
  fs.mkdirSync(migrationDir, { recursive: true });
  const schemaPath = path.join(applicationRoot, 'prisma', 'schema.prisma');
  const migrationPath = path.join(migrationDir, 'migration.sql');
  fs.writeFileSync(schemaPath, PRISMA_SCHEMA);
  fs.writeFileSync(migrationPath, migrationFixture());
  const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return {
    tempRoot,
    applicationRoot,
    schemaPath,
    migrationPath,
    expectedSchemaSha256: digest(schemaPath),
    expectedMigrationSha256: digest(migrationPath),
  };
}

test('migration ledger inspection is read-only and limits log access to the target migration', () => {
  assert.match(MIGRATION_LEDGER_SQL.trim(), /^SELECT\b/i);
  assert.match(MIGRATION_LEDGER_SQL, /FROM "_prisma_migrations"/);
  assert.match(MIGRATION_LEDGER_SQL, /finished_at, rolled_back_at, applied_steps_count/);
  assert.match(MIGRATION_LEDGER_SQL, /CASE WHEN migration_name = '202610020002_attendance_time_policy_v1' THEN logs ELSE NULL END AS target_logs/);
  assert.doesNotMatch(MIGRATION_LEDGER_SQL, /SELECT\s+[^\n]*\blogs\b/i);
  assert.doesNotMatch(MIGRATION_LEDGER_SQL, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REVOKE|GRANT)\b/i);
  assert.doesNotMatch(MIGRATION_LEDGER_SQL, /attendance_events|attendance_time_policies/);
});

test('classifies applied migration with verified schema', () => {
  const history = targetRecordFacts([ledgerRow()], sourceMigrations());
  assert.equal(migrationSchemaClass(history, schemaState({ present: true, verified: true })), 'APPLIED_AND_SCHEMA_VALID');
  assert.equal(history.targetRecord, 'PRESENT');
  assert.equal(history.targetFinishedAt, 'PRESENT');
  assert.equal(history.targetRolledBackAt, 'ABSENT');
});

test('classifies absent target history and schema as exactly pending', () => {
  const history = targetRecordFacts([], sourceMigrations());
  assert.equal(migrationSchemaClass(history, schemaState()), 'EXACTLY_PENDING_SCHEMA_ABSENT');
  assert.equal(history.targetRecord, 'ABSENT');
});

test('classifies completed history with missing schema as drift', () => {
  const history = targetRecordFacts([ledgerRow()], sourceMigrations());
  assert.equal(migrationSchemaClass(history, schemaState()), 'HISTORY_APPLIED_SCHEMA_MISSING');
});

test('classifies incomplete migration with absent schema', () => {
  const history = targetRecordFacts([ledgerRow({ finished_at: null, logs: 'password=never-print' })], sourceMigrations());
  assert.equal(migrationSchemaClass(history, schemaState()), 'FAILED_MIGRATION_SCHEMA_ABSENT');
  assert.equal(history.targetLogsPresent, 'YES');
  assert.equal(history.targetFailureCategory, 'UNCLASSIFIED_FAILURE');
});

test('classifies incomplete migration with partial schema', () => {
  const history = targetRecordFacts([ledgerRow({ finished_at: null })], sourceMigrations());
  assert.equal(migrationSchemaClass(history, schemaState({ present: true, verified: false })), 'FAILED_MIGRATION_SCHEMA_PARTIAL');
});

test('classifies target schema without a target history row', () => {
  const history = targetRecordFacts([], sourceMigrations());
  assert.equal(migrationSchemaClass(history, schemaState({ present: true, verified: false })), 'SCHEMA_PRESENT_HISTORY_ABSENT');
});

test('classifies any other source migration pending separately', () => {
  const migrations = sourceMigrations(['202609010001_baseline', EXPECTED_MIGRATION]);
  const history = targetRecordFacts([ledgerRow({ checksum: 'checksum-1' })], migrations);
  assert.equal(history.otherPendingCount, 1);
  assert.equal(migrationSchemaClass(history, schemaState({ present: true, verified: true })), 'OTHER_PENDING_MIGRATIONS');
});

test('fails closed when migration history cannot be read', () => {
  assert.equal(migrationSchemaClass({ readable: false }, schemaState()), 'STATUS_READ_FAILED');
});

test('detects migration and Prisma model timestamp shape mismatch without revealing values', () => {
  const timezoneMigration = migrationFixture({
    effective_from: 'TIMESTAMPTZ',
    created_at: 'TIMESTAMPTZ',
  });
  const result = inspectPrismaMigrationShape(PRISMA_SCHEMA, timezoneMigration);
  assert.equal(result.prismaModelParsed, true);
  assert.equal(result.migrationMatchesPrisma, false);
  assert.equal(result.mismatchCount, 2);
  assert.deepEqual(result.mismatchColumns, ['effective_from', 'created_at']);
});

test('keeps physical schema evidence separate from migration-source compatibility', async () => {
  const prisma = schemaClient();
  const result = await inspectSchema(prisma, PRISMA_SCHEMA, migrationFixture({
    effective_from: 'TIMESTAMPTZ',
    created_at: 'TIMESTAMPTZ',
  }));
  assert.equal(result.physicalVerified, true);
  assert.equal(result.verified, true);
  assert.equal(result.migrationMatchesPrisma, false);
  assert.deepEqual(result.migrationModelMismatchColumns, ['effective_from', 'created_at']);
});

test('does not call an exact-pending migration safe when its SQL differs from the pinned Prisma schema', () => {
  const history = targetRecordFacts([], sourceMigrations());
  const schema = schemaState({ present: false, verified: false, physicalVerified: false, migrationMatchesPrisma: false });
  assert.equal(migrationSchemaClass(history, schema), 'PRISMA_MIGRATION_SOURCE_MISMATCH');
  assert.equal(finalizeStatus('PRISMA_MIGRATION_SOURCE_MISMATCH').reason, 'SOURCE_SHAPE_MISMATCH');
});

test('distinguishes an applied physical schema from a source mismatch', () => {
  const history = targetRecordFacts([ledgerRow()], sourceMigrations());
  const schema = schemaState({ present: true, verified: true, physicalVerified: true, migrationMatchesPrisma: false });
  assert.equal(migrationSchemaClass(history, schema), 'PRISMA_MIGRATION_SOURCE_MISMATCH');
});

test('Prisma field parsing maps DateTime default to timestamp and reads explicit native types', () => {
  const fields = readPrismaColumnExpectations(PRISMA_SCHEMA);
  assert.equal(fields['attendance_time_policies.effective_from'].udtName, 'timestamp');
  assert.equal(fields['attendance_time_policies.scope_type'].udtName, 'varchar');
  assert.equal(fields['attendance_time_policies.scope_type'].maxLength, 20);
  assert.equal(fields['attendance_time_policies.site_id'].udtName, 'uuid');
});

test('schema inspection queries catalog metadata only and validates shape, indexes, constraints, RLS and revokes', async () => {
  const prisma = schemaClient();
  const result = await inspectSchema(prisma, PRISMA_SCHEMA, migrationFixture());
  assert.equal(result.present, true);
  assert.equal(result.verified, true, JSON.stringify({ result, queries: prisma.queries }));
  assert.equal(result.modelShapeMatches, true);
  assert.ok(prisma.queries.every((sql) => /^\s*SELECT\b/i.test(sql)));
  assert.ok(prisma.queries.every((sql) => !/^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REVOKE|GRANT)\b/i.test(sql)));
  assert.ok(prisma.queries.every((sql) => !/SELECT\s+\*/i.test(sql)));
});

test('inspector query failure is classified as STATUS_READ_FAILED and leaks no error text', async () => {
  const files = inspectorFiles();
  const logs = [];
  const secretError = Object.assign(new Error('postgres://user:password@host/private'), { code: 'P1000' });
  try {
    const result = await inspectPreviewMigrationState({
      env: { VERCEL_ENV: 'preview', DATABASE_URL: 'postgres://secret', DIRECT_URL: 'postgres://secret2' },
      applicationRoot: files.applicationRoot,
      prisma: { async $queryRawUnsafe() { throw secretError; } },
      targetGuard() {},
      run() { return { status: 1, stdout: 'P1000 connection refused postgres://secret', stderr: '' }; },
      expectedSchemaSha256: files.expectedSchemaSha256,
      expectedMigrationSha256: files.expectedMigrationSha256,
      log: (line) => logs.push(String(line)),
    });
    assert.equal(result.state, 'STATUS_READ_FAILED');
    const output = logs.join('\n');
    assert.doesNotMatch(output, /postgres:\/\/|password|secret|connection refused/i);
    assert.match(output, /PRISMA_MIGRATE_ERROR_CODE=P1000/);
    assert.match(output, /RAW_CONNECTION_VALUES_EMITTED=false/);
  } finally {
    fs.rmSync(files.tempRoot, { recursive: true, force: true });
  }
});

test('Preview target mismatch stops before any database query or Prisma status command', async () => {
  let databaseCalled = false;
  let prismaStatusCalled = false;
  const result = await inspectPreviewMigrationState({
    env: { VERCEL_ENV: 'preview', DATABASE_URL: 'opaque', DIRECT_URL: 'opaque' },
    targetGuard() { throw new Error('target mismatch'); },
    prisma: { async $queryRawUnsafe() { databaseCalled = true; return []; } },
    run() { prismaStatusCalled = true; return { status: 0, stdout: 'up to date' }; },
    log() {},
  });
  assert.equal(result.state, 'STATUS_READ_FAILED');
  assert.equal(databaseCalled, false);
  assert.equal(prismaStatusCalled, false);
});

test('failed migration log is mapped to a category and never returned verbatim', () => {
  const rawLog = 'ERROR: password=very-secret permission denied for database';
  assert.equal(safeFailureCategory(rawLog), 'DATABASE_PRIVILEGE');
  assert.equal(safeFailureCategory(rawLog).includes('very-secret'), false);
});

test('Prisma CLI status is only reduced to exit code, known code, and category', () => {
  assert.deepEqual(prismaCliState({ stdout: 'Database schema is up to date!', exitCode: 0 }), {
    exitCode: 0, errorCode: 'NONE', category: 'UP_TO_DATE', pendingNameCount: 0,
  });
  const result = prismaCliState({ stdout: 'Migration failed P3009 postgres://secret/path', exitCode: 1 });
  assert.equal(result.category, 'FAILED_MIGRATION');
  assert.equal(result.errorCode, 'P3009');
  assert.equal('stdout' in result, false);
  assert.equal('stderr' in result, false);
});

test('writeOutputs returns only sanitized status values', () => {
  const rows = writeOutputs({
    state: 'FAILED_MIGRATION_SCHEMA_ABSENT',
    historyClass: 'FAILED_MIGRATION_SCHEMA_ABSENT',
    history: { targetRecord: 'PRESENT', targetFinishedAt: 'ABSENT', targetRolledBackAt: 'ABSENT' },
    sourceShape: { migrationMatchesPrisma: false, mismatchColumns: ['effective_from', 'created_at'] },
    schema: { readable: true, verified: false, physicalVerified: false, tablePresent: false, columnsPresent: false, indexesPresent: false, constraintsPresent: false, modelShapeMatches: false, migrationMatchesPrisma: false },
  });
  const output = rows.join('\n');
  assert.match(output, /migration_applied=UNKNOWN/);
  assert.match(output, /preview_get_allowed=NO/);
  assert.match(output, /physical_schema_verified=NO/);
  assert.match(output, /migration_source_mismatch_columns=effective_from,created_at/);
  assert.doesNotMatch(output, /postgres:\/\/|password|logs/);
});

test('Preview origin stays pinned to exact HTTPS PR deployment alias', () => {
  const origin = 'https://sms-v3-staging-git-codex-g06-time-policy-20261002-godzillazz.vercel.app';
  assert.equal(approvedPreviewOrigin(origin), origin);
  assert.throws(() => approvedPreviewOrigin('https://untrusted.invalid'));
  assert.throws(() => approvedPreviewOrigin('http://sms-v3-staging-git-codex-g06-time-policy-20261002-godzillazz.vercel.app'));
});

test('unauthenticated policy GET sends no credentials and emits only status/category', async () => {
  const origin = 'https://sms-v3-staging-git-codex-g06-time-policy-20261002-godzillazz.vercel.app';
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/v1/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    if (url.endsWith('/api/v1/ready')) return new Response(JSON.stringify({ status: 'ready', database: 'ok' }), { status: 200 });
    if (options.method === 'OPTIONS' && options.headers.Origin === 'https://untrusted.invalid') return new Response(null, { status: 403 });
    if (options.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin } });
    return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401 });
  };
  const logs = [];
  const result = await verifyReadonlyRuntime({ env: { PREVIEW_ORIGIN: origin }, fetchImpl, log: (line) => logs.push(line), outputPath: null });
  assert.equal(result.runtimeChecks, 'PASS');
  assert.equal(result.policyGetResult, 'HTTP_401_AUTH_REQUIRED; CODE_AUTH_REQUIRED');
  assert.ok(calls.every((call) => !call.options.headers?.Authorization && !call.options.headers?.Cookie));
  assert.ok(logs.includes('RAW_RESPONSE_BODY_EMITTED=false'));
  assert.equal(calls.find((call) => call.url.endsWith(POLICY_PATH) && call.options.method !== 'OPTIONS').options.method, undefined);
});

test('successful policy response is summarized without exposing returned values', () => {
  const summary = summarizePolicyBody({ data: {
    defaultPolicy: { lateGraceMinutes: 0 },
    sites: [{ id: 'site-1' }],
    shiftTypes: [{ id: 'shift-1' }],
  } });
  assert.deepEqual(summary, { companyLoaded: true, sites: 1, shiftTypes: 1 });
});

test('workflow masks target values before the guarded DB step and stays Preview-only/read-only', () => {
  const maskStep = workflow.indexOf('Mask Preview and Production target fingerprints before use');
  const guardStep = workflow.indexOf('Prove isolated non-Production Preview target before database inspection');
  const inspectStep = workflow.indexOf('Inspect migration status and schema using read-only queries only');
  const maskBlock = workflow.slice(maskStep, guardStep);
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.ok(maskStep >= 0 && maskStep < guardStep && guardStep < inspectStep);
  assert.match(maskBlock, /APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT:\s*\$\{\{\s*vars\.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT\s*\}\}/);
  assert.match(maskBlock, /APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT:\s*\$\{\{\s*vars\.APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT\s*\}\}/);
  assert.match(maskBlock, /process\.env\[name\]/);
  assert.doesNotMatch(maskBlock, /github\.request|GET \/repos\//);
  assert.match(workflow, /core\.setSecret\(value\)/);
  assert.match(workflow, /node scripts\/ci\/verify-preview-migration-target\.js/);
  assert.match(workflow, /node scripts\/ci\/inspect-approved-pr-preview-attendance-time-policy-migration\.js/);
  assert.doesNotMatch(workflow, /prisma\s+(?:migrate\s+deploy|db\s+push|migrate\s+resolve|migrate\s+repair|db\s+execute|db\s+seed|migrate\s+reset)/i);
  assert.doesNotMatch(workflow, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i);
  assert.doesNotMatch(workflow, /production-sms-v3-staging|vercel(?:@[^\s]+)?\s+(?:deploy|promote|rollback)/i);
});
