'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DUPLICATE_GROUPS,
  EXPECTED,
  EXPECTED_COLUMNS,
  EXPECTED_CONSTRAINTS,
  EXPECTED_FOREIGN_KEYS,
  EXPECTED_INDEXES,
  SQL,
  canonicalHistoryFacts,
  classifyDuplicateRows,
  classifyHistorical,
  classifyHistoricalConstraint,
  classifyHistoricalVariant,
  classifyMigrationPlan,
  classifyPredecessorSchema,
  reconcilePreviewG06,
  safeFailureCategory,
} = require('../scripts/ci/reconcile-preview-g06-migrations-readonly');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/reconcile-preview-g06-migrations-readonly.yml'), 'utf8').replaceAll('\r\n', '\n');
const ef96Checksum = EXPECTED.ef96MigrationSha256;
const f212OneChecksum = EXPECTED.f212Migration1Sha256;
const f212TwoChecksum = EXPECTED.f212Migration2Sha256;

function oldThenNew(name, checksum) {
  return [
    { migration_name: name, checksum, started_at: new Date('2026-08-24T01:00:00Z'), finished_at: new Date('2026-08-24T01:01:00Z'), rolled_back_at: new Date('2026-08-24T02:00:00Z') },
    { migration_name: name, checksum, started_at: new Date('2026-08-24T03:00:00Z'), finished_at: new Date('2026-08-24T03:01:00Z'), rolled_back_at: null },
  ];
}

function expectedCatalog({ predecessor = false, target = false } = {}) {
  if (!predecessor) return {
    columns: [], indexes: [], constraints: [], tables: [], pendingPrivileges: [],
    enums: [], legacy: [{ gps_only_uat: true, provenance_check: true, face_nullable: true }],
  };
  return {
    columns: EXPECTED_COLUMNS.map(([table_name, column_name]) => ({ table_name, column_name })),
    indexes: EXPECTED_INDEXES.map((name) => ({
      name,
      valid: true,
      unique_index: name.endsWith('_key'),
      definition: `CREATE ${name.endsWith('_key') ? 'UNIQUE ' : ''}INDEX ${name} ON public.table (${({
        attendance_events_device_enrollment_id_received_at_idx: 'device_enrollment_id, received_at',
        attendance_events_review_required_received_at_idx: 'review_required, received_at',
        attendance_pending_events_capture_id_key: 'capture_id',
        attendance_pending_events_attendance_event_id_key: 'attendance_event_id',
        attendance_pending_events_employee_id_captured_at_idx: 'employee_id, captured_at',
        attendance_pending_events_status_received_at_idx: 'status, received_at',
        attendance_pending_events_shift_assignment_id_event_type_idx: 'shift_assignment_id, event_type',
      })[name]})`,
    })),
    constraints: [
      ...EXPECTED_CONSTRAINTS.map((name) => ({
        name,
        kind: name.endsWith('_pkey') ? 'p' : 'c',
        valid: true,
        definition: name === 'attendance_events_source_mode_check'
          ? "CHECK ((source_mode = 'ONLINE' AND device_captured_at IS NULL AND effective_event_at = received_at) OR (source_mode = 'OFFLINE' AND device_captured_at IS NOT NULL AND effective_event_at = device_captured_at AND device_captured_at <= received_at))"
          : name === 'attendance_pending_events_payload_digest_format' ? "CHECK (payload_digest ~ '^[0-9a-f]{64}$')"
            : name === 'attendance_pending_events_offline_only' ? "CHECK (source_mode = 'OFFLINE')"
              : name === 'attendance_pending_events_capture_before_receive' ? 'CHECK (captured_at <= received_at)' : 'PRIMARY KEY (id)',
      })),
      ...EXPECTED_FOREIGN_KEYS.map((name) => {
        const mapping = {
          attendance_events_device_enrollment_id_fkey: ['device_enrollment_id', 'attendance_device_enrollments'],
          attendance_pending_events_employee_id_fkey: ['employee_id', 'employees'],
          attendance_pending_events_shift_assignment_id_fkey: ['shift_assignment_id', 'shift_assignments'],
          attendance_pending_events_reviewed_by_user_id_fkey: ['reviewed_by_user_id', 'users'],
          attendance_pending_events_attendance_event_id_fkey: ['attendance_event_id', 'attendance_events'],
        }[name];
        return { name, kind: 'f', valid: true, definition: `FOREIGN KEY (${mapping[0]}) REFERENCES ${mapping[1]}(id)` };
      }),
    ],
    tables: [{ name: 'attendance_pending_events', relation_kind: 'r', rls_enabled: true, rls_forced: false }, ...(target ? [{ name: 'attendance_time_policies', relation_kind: 'r', rls_enabled: true, rls_forced: false }] : [])],
    pendingPrivileges: [{ role_name: 'anon', has_any_privilege: false }, { role_name: 'authenticated', has_any_privilege: false }],
    enums: ['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'].map((label) => ({ type_name: 'AttendancePendingEventStatus', label })),
    legacy: [{ gps_only_uat: true, provenance_check: true, face_nullable: true }],
  };
}

function ledgerFixture() {
  return [
    ...oldThenNew('202608240003_g06_security_site_qr_gps_v1', 'a'.repeat(64)),
    ...oldThenNew('202608240004_g06_attendance_event_workflow_v1', 'b'.repeat(64)),
    { migration_name: EXPECTED.historical28001, checksum: f212OneChecksum, started_at: new Date('2026-09-28T01:00:00Z'), finished_at: new Date('2026-09-28T01:01:00Z'), rolled_back_at: null },
    { migration_name: EXPECTED.historical28002, checksum: f212TwoChecksum, started_at: new Date('2026-09-28T02:00:00Z'), finished_at: new Date('2026-09-28T02:01:00Z'), rolled_back_at: null },
  ];
}

function fakeClient({ schema = expectedCatalog(), ledger = ledgerFixture(), failQuery = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (failQuery && sql === failQuery.sql) throw failQuery.error;
      if (sql === 'BEGIN READ ONLY' || sql.startsWith('SET LOCAL') || sql === 'ROLLBACK') return { rows: [] };
      if (sql === SQL.ledger) return { rows: ledger };
      if (sql === SQL.columns) return { rows: schema.columns };
      if (sql === SQL.indexes) return { rows: schema.indexes };
      if (sql === SQL.constraints) return { rows: schema.constraints };
      if (sql === SQL.tables) return { rows: schema.tables };
      if (sql === SQL.pendingPrivileges) return { rows: schema.pendingPrivileges };
      if (sql === SQL.enums) return { rows: schema.enums };
      if (sql === SQL.legacy) return { rows: schema.legacy };
      throw new Error('unexpected query');
    },
  };
}

const source = [
  { name: '202608240003_g06_security_site_qr_gps_v1', checksum: 'a'.repeat(64) },
  { name: '202608240004_g06_attendance_event_workflow_v1', checksum: 'b'.repeat(64) },
  { name: EXPECTED.predecessor, checksum: EXPECTED.predecessorSha256 },
  { name: EXPECTED.target, checksum: EXPECTED.targetSha256 },
];

test('historical checksum comparison distinguishes both first-migration variants and second migration', () => {
  assert.equal(classifyHistorical([{ checksum: ef96Checksum }], { ef96: ef96Checksum, f212: f212OneChecksum }), 'MATCH_EF96AF5');
  assert.equal(classifyHistorical([{ checksum: f212OneChecksum }], { ef96: ef96Checksum, f212: f212OneChecksum }), 'MATCH_F2121BB');
  assert.equal(classifyHistorical([{ checksum: '0'.repeat(64) }], { ef96: ef96Checksum, f212: f212OneChecksum }), 'NO_MATCH');
  assert.equal(classifyHistorical([], { ef96: ef96Checksum, f212: f212OneChecksum }), 'UNKNOWN');
  assert.equal(classifyHistoricalConstraint([{ checksum: f212TwoChecksum }], f212TwoChecksum), 'MATCH_F2121BB');
  assert.equal(classifyHistoricalConstraint([{ checksum: '0'.repeat(64) }], f212TwoChecksum), 'NO_MATCH');
  assert.equal(classifyHistoricalVariant('MATCH_F2121BB', 'MATCH_F2121BB'), 'SPLIT_HISTORY_MATCH');
  assert.equal(classifyHistoricalVariant('MATCH_EF96AF5', 'UNKNOWN'), 'COMBINED_HISTORY_MATCH');
  assert.equal(classifyHistoricalVariant('MATCH_EF96AF5', 'MATCH_F2121BB'), 'INCOMPATIBLE_HISTORY_VARIANTS');
});

test('duplicate history requires same checksum, earlier rollback and later completed record', () => {
  const valid = oldThenNew(DUPLICATE_GROUPS[0], 'c');
  assert.equal(classifyDuplicateRows(valid), 'VALID_ROLLBACK_REAPPLY_HISTORY');
  assert.equal(classifyDuplicateRows([valid[0], { ...valid[1], checksum: 'd' }]), 'AMBIGUOUS_DUPLICATE_HISTORY');
  assert.equal(classifyDuplicateRows([valid[0]]), 'AMBIGUOUS_DUPLICATE_HISTORY');
});

test('canonical order identifies the predecessor as the exact next missing migration', () => {
  const groups = new Map([
    [source[0].name, oldThenNew(source[0].name, 'a'.repeat(64))],
    [source[1].name, oldThenNew(source[1].name, 'b'.repeat(64))],
    [EXPECTED.historical28001, [{ checksum: ef96Checksum, finished_at: new Date(), rolled_back_at: null }]],
    [EXPECTED.historical28002, [{ checksum: f212TwoChecksum, finished_at: new Date(), rolled_back_at: null }]],
  ]);
  const dups = new Map(DUPLICATE_GROUPS.map((name) => [name, classifyDuplicateRows(groups.get(name))]));
  const history = canonicalHistoryFacts(source, groups, new Map([
    [EXPECTED.historical28001, 'MATCH_EF96AF5'], [EXPECTED.historical28002, 'MATCH_F2121BB'],
  ]), dups);
  assert.equal(history.canonicalNext, 'CANONICAL_NEXT_001');
  assert.equal(history.predecessorLedger, 'ABSENT');
  assert.equal(history.targetLedger, 'ABSENT');
  assert.equal(history.historyExplained, true);
  assert.deepEqual(history.otherPendingNames, []);
});

test('any pending canonical migration before the predecessor is reported, not hidden', () => {
  const extra = { name: '202610010001_unexpected', checksum: 'x' };
  const history = canonicalHistoryFacts([extra, ...source], new Map(), new Map(), new Map());
  assert.equal(history.canonicalNext, 'OTHER_CANONICAL_PENDING');
  assert.ok(history.otherPendingNames.includes(extra.name));
});

test('predecessor schema states distinguish none, complete, partial and unreadable', () => {
  assert.equal(classifyPredecessorSchema({ readable: false }), 'PREDECESSOR_SCHEMA_UNKNOWN');
  assert.equal(classifyPredecessorSchema(expectedCatalogFacts(false)), 'PREDECESSOR_SCHEMA_ABSENT');
  assert.equal(classifyPredecessorSchema(expectedCatalogFacts(true)), 'PREDECESSOR_SCHEMA_PRESENT');
  const partial = expectedCatalogFacts(false);
  partial.columns.add('attendance_device_enrollments.observation_only');
  assert.equal(classifyPredecessorSchema(partial), 'PREDECESSOR_SCHEMA_PARTIAL');
});

function expectedCatalogFacts(complete) {
  const catalog = expectedCatalog({ predecessor: complete });
  const columns = new Set(catalog.columns.map((row) => `${row.table_name}.${row.column_name}`));
  const indexes = new Map(catalog.indexes.map((row) => [row.name, row.valid && (!row.name.endsWith('_key') || row.unique_index)]));
  const constraints = new Map(catalog.constraints.filter((row) => row.kind === 'c' || row.name.endsWith('_pkey')).map((row) => [row.name, row.valid]));
  const foreignKeys = new Map(catalog.constraints.filter((row) => row.kind === 'f').map((row) => [row.name, row.valid]));
  return {
    readable: true, columns, indexes, constraints, foreignKeys,
    pendingTable: complete, pendingObjectConflict: false, pendingRls: complete, pendingRevokeSafe: complete,
    pendingEnum: complete,
    sourceModeSemantics: complete,
  };
}

test('migration plan applies 001 then 002 only when history, physical state and ordering all prove safe', () => {
  const args = {
    predecessorSchema: 'PREDECESSOR_SCHEMA_ABSENT', targetPolicySchema: 'ABSENT',
    canonical: { targetLedger: 'ABSENT', predecessorLedger: 'ABSENT', canonicalNext: 'CANONICAL_NEXT_001', historyExplained: true },
    historical28001: 'MATCH_F2121BB', historical28002: 'MATCH_F2121BB', historicalVariant: 'SPLIT_HISTORY_MATCH',
    duplicateClassifications: new Map(DUPLICATE_GROUPS.map((name) => [name, 'VALID_ROLLBACK_REAPPLY_HISTORY'])),
    legacy: { gpsOnlyUat: 'YES', provenanceCheck: 'YES', faceNullability: 'NULLABLE' },
  };
  assert.equal(classifyMigrationPlan(args), 'APPLY_001_THEN_002');
  assert.equal(classifyMigrationPlan({ ...args, predecessorSchema: 'PREDECESSOR_SCHEMA_PARTIAL' }), 'PREDECESSOR_SCHEMA_PARTIAL_RECOVERY_REQUIRED');
  assert.equal(classifyMigrationPlan({ ...args, targetPolicySchema: 'PRESENT' }), 'MIGRATION_HISTORY_RECOVERY_REQUIRED');
  assert.equal(classifyMigrationPlan({ ...args, canonical: { ...args.canonical, historyExplained: false } }), 'MIGRATION_HISTORY_RECOVERY_REQUIRED');
  assert.equal(classifyMigrationPlan({ ...args, legacy: { ...args.legacy, gpsOnlyUat: 'UNKNOWN' } }), 'FAIL_CLOSED_UNKNOWN');
});

test('read-only reconciliation proves Preview target before connecting and emits only sanitized facts', async () => {
  const logs = [];
  const sequence = [];
  const client = fakeClient();
  client.connect = async () => sequence.push('connect');
  const result = await reconcilePreviewG06({
    env: { VERCEL_ENV: 'preview', DATABASE_URL: 'postgresql://user:secret@host/db', DIRECT_URL: 'postgresql://user:secret@host/db' },
    targetGuard: () => sequence.push('guard'),
    sourceVerifier: () => source,
    client,
    log: (line) => logs.push(line),
  });
  assert.deepEqual(sequence, ['guard', 'connect']);
  assert.equal(result.predecessorSchema, 'PREDECESSOR_SCHEMA_ABSENT');
  assert.equal(result.migrationPlan, 'APPLY_001_THEN_002');
  assert.ok(client.calls.some((call) => call.sql === 'BEGIN READ ONLY'));
  assert.ok(client.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(client.calls.every((call) => call.sql === 'BEGIN READ ONLY' || call.sql === 'ROLLBACK' || call.sql.startsWith('SET LOCAL') || /^\s*SELECT\b/i.test(call.sql)));
  assert.ok(logs.includes('DATABASE_MUTATIONS_PERFORMED=false'));
  assert.ok(logs.includes('BUSINESS_ROWS_READ=false'));
  assert.ok(logs.every((line) => !line.includes('postgresql://') && !line.includes('secret') && !line.includes(ef96Checksum) && !line.includes(f212TwoChecksum)));
});

test('a failed Preview target guard prevents any connection and does not leak its error', async () => {
  let connected = false;
  const logs = [];
  const client = { async connect() { connected = true; }, async query() { throw new Error('unexpected'); } };
  const result = await reconcilePreviewG06({
    env: { VERCEL_ENV: 'preview', DATABASE_URL: 'secret-db-url', DIRECT_URL: 'secret-direct-url' },
    targetGuard: () => { throw new Error('secret-db-url blocked'); },
    client,
    log: (line) => logs.push(line),
  });
  assert.equal(connected, false);
  assert.equal(result.status, 'STATUS_READ_FAILED');
  assert.equal(result.failureCategory, 'PREVIEW_TARGET_GUARD_FAILED');
  assert.ok(logs.includes('PREVIEW_TARGET_GUARD=FAIL'));
  assert.ok(logs.every((line) => !line.includes('secret')));
});

test('catalog read failures map to a safe category without raw database error output', async () => {
  assert.equal(safeFailureCategory(Object.assign(new Error('private host and URL'), { code: '42501' })), 'SCHEMA_READ_PERMISSION_DENIED');
  assert.equal(safeFailureCategory(Object.assign(new Error('private host and URL'), { code: '57014' })), 'SCHEMA_QUERY_TIMEOUT');
  const logs = [];
  const client = fakeClient({ failQuery: { sql: SQL.ledger, error: Object.assign(new Error('postgresql://secret'), { code: '42501' }) } });
  const result = await reconcilePreviewG06({
    env: { VERCEL_ENV: 'preview', DATABASE_URL: 'secret-url', DIRECT_URL: 'secret-direct-url' },
    targetGuard: () => {}, sourceVerifier: () => source, client, log: (line) => logs.push(line),
  });
  assert.equal(result.failureCategory, 'SCHEMA_READ_PERMISSION_DENIED');
  assert.ok(logs.includes('RECONCILIATION_RESULT=STATUS_READ_FAILED'));
  assert.ok(logs.every((line) => !line.includes('postgresql://') && !line.includes('secret')));
});

test('workflow is protected, source-pinned, and contains no migration or data-write command', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /EXPECTED_RELEASE_SHA: 9fc77d0490f6a49f8d637879f6395237ac34247a/);
  assert.match(workflow, /EXPECTED_APPLICATION_SHA: e12c28c339c6d420c6db13b02aa1ddffb2c3e5ba/);
  assert.match(workflow, /EXPECTED_EF96_SHA: ef96af501582553c14ff7c6eab9f21f6aec7167b/);
  assert.match(workflow, /EXPECTED_F212_SHA: f2121bb5e1a2c6cf12ec4ca34ea604a8893fded1/);
  assert.match(workflow, /node scripts\/ci\/reconcile-preview-g06-migrations-readonly\.js/);
  assert.doesNotMatch(workflow, /prisma\s+migrate\s+deploy|prisma\s+migrate\s+resolve|prisma\s+db\s+push|CREATE\s+(?:ROLE|TABLE|INDEX)|\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+INTO/i);
  assert.doesNotMatch(workflow, /DATABASE_URL[^\n]*(?:GITHUB_OUTPUT|GITHUB_STEP_SUMMARY)/i);
});

test('inspection catalog queries are SELECT-only', () => {
  for (const [name, sql] of Object.entries(SQL)) {
    assert.match(sql, /^\s*SELECT\b/i, `${name} query must begin with SELECT`);
    assert.doesNotMatch(sql, /;|^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO)\b/im, `${name} must contain one SELECT statement only`);
  }
});
