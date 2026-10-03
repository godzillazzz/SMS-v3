'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
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
  prismaCliState,
  reconcileStatus,
} = require('../scripts/ci/inspect-approved-pr-preview-attendance-time-policy-migration');
const { approvedPreviewOrigin, summarizePolicyBody, verifyReadonlyRuntime, POLICY_PATH } = require('../scripts/ci/verify-preview-attendance-time-policy-readonly-runtime');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/inspect-approved-pr-preview-attendance-time-policy.yml'), 'utf8').replaceAll('\r\n', '\n');

function policySchemaPrisma(rowsByQuery = {}) {
  const queries = [];
  return {
    queries,
    async $queryRawUnsafe(sql) {
    queries.push(sql);
    if (sql.includes('information_schema.columns')) return REQUIRED_COLUMNS.map((value) => {
      const [table_name, column_name] = value.split('.');
      return { table_name, column_name };
    });
    if (sql.includes('relrowsecurity')) return [{ enabled: true }];
    if (sql.includes('pg_indexes')) return REQUIRED_INDEXES.map((indexname) => ({ indexname }));
    if (sql.includes('pg_constraint')) return REQUIRED_CONSTRAINTS.map((conname) => ({ conname }));
    if (sql.includes('has_table_privilege')) return [{ anon_has_any_privilege: false, authenticated_has_any_privilege: false }];
    if (sql.includes('to_regclass')) return [{ name: 'attendance_time_policies' }];
      return rowsByQuery[sql] || [];
    },
  };
}

test('pinned source checksums and migration identity are fixed', () => {
  assert.equal(EXPECTED_MIGRATION, '202610020002_attendance_time_policy_v1');
  assert.match(EXPECTED_SCHEMA_SHA256, /^[0-9a-f]{64}$/);
  assert.match(EXPECTED_MIGRATION_SHA256, /^[0-9a-f]{64}$/);
});

test('migration ledger query is a single read-only SELECT without business row values', () => {
  assert.match(MIGRATION_LEDGER_SQL.trim(), /^SELECT\b/i);
  assert.match(MIGRATION_LEDGER_SQL, /FROM "_prisma_migrations"/);
  assert.doesNotMatch(MIGRATION_LEDGER_SQL, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REVOKE|GRANT)\b/i);
  assert.doesNotMatch(MIGRATION_LEDGER_SQL, /\blogs\b|attendance_events|attendance_time_policies/i);
});

test('classifies an applied target only when complete history and schema invariants agree', () => {
  const migrations = [{ name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256 }];
  const rows = [{ migration_name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256, finished: true, rolled_back: false }];
  const result = classifyLedger({ migrations, rows, schema: { present: true, verified: true } });
  assert.equal(result.state, 'APPLIED_UP_TO_DATE');
  assert.equal(result.targetApplied, 'YES');
});

test('classifies only the exact target migration as pending', () => {
  const result = classifyLedger({
    migrations: [{ name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256 }],
    rows: [],
    schema: { present: false, verified: false },
  });
  assert.equal(result.state, 'EXACTLY_PENDING');
  assert.equal(result.targetApplied, 'NO');
});

test('fails closed for an unfinished migration record', () => {
  const result = classifyLedger({
    migrations: [{ name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256 }],
    rows: [{ migration_name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256, finished: false, rolled_back: false }],
    schema: { present: true, verified: false },
  });
  assert.equal(result.state, 'FAILED_OR_PARTIAL');
  assert.equal(result.targetApplied, 'UNKNOWN');
});

test('does not call a partially present schema cleanly pending', () => {
  const result = classifyLedger({
    migrations: [{ name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256 }],
    rows: [],
    schema: { present: true, verified: false },
  });
  assert.equal(result.state, 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS');
});

test('classifies additional pending source migrations separately', () => {
  const result = classifyLedger({
    migrations: [
      { name: '202609010001_baseline', checksum: 'a'.repeat(64) },
      { name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256 },
    ],
    rows: [],
    schema: { present: false, verified: false },
  });
  assert.equal(result.state, 'OTHER_PENDING_MIGRATIONS');
  assert.equal(result.pendingCount, 2);
});

test('fails closed if Preview migration history cannot be read', () => {
  assert.equal(classifyLedger({
    migrations: [{ name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256 }],
    ledgerReadable: false,
    schema: { present: false, verified: false },
  }).state, 'UNKNOWN_FAIL_CLOSED');
  assert.equal(classifyLedger({
    migrations: [{ name: EXPECTED_MIGRATION, checksum: EXPECTED_MIGRATION_SHA256 }],
    ledgerReadable: false,
    schema: { present: true, verified: false },
  }).state, 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS');
});

test('Prisma CLI status is reduced to sanitized known classes', () => {
  assert.equal(prismaCliState({ stdout: 'Database schema is up to date!', exitCode: 0 }).state, 'APPLIED_UP_TO_DATE');
  assert.equal(prismaCliState({ stdout: `Following migration(s) have not yet been applied:\n${EXPECTED_MIGRATION}`, exitCode: 1 }).state, 'EXACTLY_PENDING');
  assert.equal(prismaCliState({ stdout: 'Migration 202610020002_attendance_time_policy_v1 failed to apply', exitCode: 1 }).state, 'FAILED_OR_PARTIAL');
  assert.equal(prismaCliState({ stdout: 'Applied migration is missing from the local migrations directory', exitCode: 1 }).state, 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS');
  assert.equal(prismaCliState({ stdout: 'database at postgres://sensitive.invalid/path', exitCode: 1 }).state, 'UNKNOWN_FAIL_CLOSED');
});

test('status cross-check rejects disagreement between Prisma CLI and ledger', () => {
  const ledger = { state: 'EXACTLY_PENDING', targetApplied: 'NO' };
  assert.equal(reconcileStatus(ledger, { state: 'APPLIED_UP_TO_DATE' }).state, 'SCHEMA_PRESENT_BUT_HISTORY_AMBIGUOUS');
});

test('schema verification reads only catalog metadata and validates expected safeguards', async () => {
  const prisma = policySchemaPrisma();
  const result = await inspectSchema(prisma);
  assert.equal(result.present, true);
  assert.equal(result.verified, true);
  assert.ok(prisma.queries.every((sql) => /^\s*SELECT\b/i.test(sql)));
  assert.ok(prisma.queries.every((sql) => !/^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REVOKE|GRANT)\b/i.test(sql)));
  assert.ok(prisma.queries.every((sql) => !/SELECT\s+\*|FROM\s+"?attendance_events"?\s*(?:;|$)|FROM\s+"?attendance_time_policies"?\s*(?:;|$)/i.test(sql)));
});

test('Preview fingerprint guard runs before Prisma status or any database query', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-preview-readonly-'));
  const applicationRoot = path.join(root, 'application');
  const migrationsRoot = path.join(applicationRoot, 'prisma', 'migrations');
  const migrationDir = path.join(migrationsRoot, EXPECTED_MIGRATION);
  fs.mkdirSync(migrationDir, { recursive: true });
  const schemaPath = path.join(applicationRoot, 'prisma', 'schema.prisma');
  const migrationPath = path.join(migrationDir, 'migration.sql');
  fs.writeFileSync(schemaPath, 'schema fixture');
  fs.writeFileSync(migrationPath, 'migration fixture');
  const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  let guardRan = false;
  const prisma = {
    async $queryRawUnsafe(sql) {
      assert.equal(guardRan, true);
      if (sql === MIGRATION_LEDGER_SQL) return [{
        migration_name: EXPECTED_MIGRATION,
        checksum: digest(migrationPath),
        finished: true,
        rolled_back: false,
      }];
      if (sql.includes('information_schema.columns')) return REQUIRED_COLUMNS.map((value) => {
        const [table_name, column_name] = value.split('.');
        return { table_name, column_name };
      });
      if (sql.includes('relrowsecurity')) return [{ enabled: true }];
      if (sql.includes('pg_indexes')) return REQUIRED_INDEXES.map((indexname) => ({ indexname }));
      if (sql.includes('pg_constraint')) return REQUIRED_CONSTRAINTS.map((conname) => ({ conname }));
      if (sql.includes('has_table_privilege')) return [{ anon_has_any_privilege: false, authenticated_has_any_privilege: false }];
      if (sql.includes('to_regclass')) return [{ name: 'attendance_time_policies' }];
      throw new Error('unexpected query');
    },
  };
  try {
    const result = await inspectPreviewMigrationState({
      env: { VERCEL_ENV: 'preview', DATABASE_URL: 'not-logged', DIRECT_URL: 'not-logged' },
      applicationRoot,
      releaseControlRoot: root,
      prisma,
      targetGuard() { guardRan = true; },
      run(_command, args) {
        assert.equal(guardRan, true);
        assert.ok(args.includes('status'));
        assert.ok(!args.includes('deploy') && !args.includes('push') && !args.includes('resolve'));
        return { status: 0, stdout: 'Database schema is up to date!', stderr: '' };
      },
      expectedSchemaSha256: digest(schemaPath),
      expectedMigrationSha256: digest(migrationPath),
      log() {},
    });
    assert.equal(result.state, 'APPLIED_UP_TO_DATE');
    assert.equal(guardRan, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Preview target guard failure prevents Prisma status and ledger queries', async () => {
  let statusCalled = false;
  const result = await inspectPreviewMigrationState({
    targetGuard() { throw new Error('guard blocked'); },
    run() { statusCalled = true; throw new Error('must not run'); },
    log() {},
  });
  assert.equal(result.state, 'UNKNOWN_FAIL_CLOSED');
  assert.equal(statusCalled, false);
});

test('Preview origin is pinned to the exact HTTPS PR deployment alias', () => {
  assert.equal(approvedPreviewOrigin(`https://${require('../scripts/ci/verify-preview-attendance-time-policy-readonly-runtime').EXPECTED_HOST}`), `https://${require('../scripts/ci/verify-preview-attendance-time-policy-readonly-runtime').EXPECTED_HOST}`);
  assert.throws(() => approvedPreviewOrigin('https://untrusted.invalid'));
  assert.throws(() => approvedPreviewOrigin('http://sms-v3-staging-git-codex-g06-time-policy-20261002-godzillazz.vercel.app'));
});

test('unauthenticated policy GET reports only status/category and does not send credentials', async () => {
  const origin = `https://${require('../scripts/ci/verify-preview-attendance-time-policy-readonly-runtime').EXPECTED_HOST}`;
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
  const outputs = [];
  const result = await verifyReadonlyRuntime({ env: { PREVIEW_ORIGIN: origin }, fetchImpl, log: (line) => logs.push(line), outputPath: null });
  assert.equal(result.runtimeChecks, 'PASS');
  assert.equal(result.policyGetResult, 'HTTP_401_AUTH_REQUIRED; CODE_AUTH_REQUIRED');
  assert.ok(calls.every((call) => !call.options.headers?.Authorization && !call.options.headers?.Cookie));
  assert.ok(logs.includes('RAW_RESPONSE_BODY_EMITTED=false'));
  assert.equal(calls.find((call) => call.url.endsWith(POLICY_PATH) && call.options.method !== 'OPTIONS').options.method, undefined);
  assert.equal(outputs.length, 0);
});

test('successful policy response is summarized without exposing returned values', () => {
  const summary = summarizePolicyBody({ data: {
    defaultPolicy: { lateGraceMinutes: 0 },
    sites: [{ id: 'site-1' }],
    shiftTypes: [{ id: 'shift-1' }],
  } });
  assert.deepEqual(summary, { companyLoaded: true, sites: 1, shiftTypes: 1 });
});

test('protected inspection workflow is manual, Preview-only, exact-source pinned, and read-only', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.match(workflow, /EXPECTED_RELEASE_CONTROL_SHA: 948fc05816e0947de921fb9a0aba3927390b74fa/);
  assert.match(workflow, /EXPECTED_APPLICATION_SHA: 074189b34c4696ce000c060f60d2ace1736a582c/);
  assert.match(workflow, /EXPECTED_SCHEMA_SHA256: e4143928cfa88d4bad053aff022ad5a7f4ec15c9feb22c864b797317ebdf154b/);
  assert.match(workflow, /EXPECTED_MIGRATION_SHA256: 5822719590321945832adf87647ca448773f5eff8cb40b7d35ccdd8cf5f443ee/);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /node scripts\/ci\/verify-preview-migration-target\.js/);
  assert.match(workflow, /node scripts\/ci\/inspect-approved-pr-preview-attendance-time-policy-migration\.js/);
  assert.ok(workflow.indexOf('node scripts/ci/verify-preview-migration-target.js') < workflow.indexOf('node scripts/ci/inspect-approved-pr-preview-attendance-time-policy-migration.js'));
  assert.doesNotMatch(workflow, /prisma\s+(?:migrate\s+deploy|db\s+push|migrate\s+resolve|migrate\s+repair|db\s+execute|db\s+seed|migrate\s+reset)/i);
  assert.doesNotMatch(workflow, /\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i);
  assert.doesNotMatch(workflow, /production-sms-v3-staging|vercel(?:@[^\s]+)?\s+(?:deploy|promote|rollback)/i);
});
