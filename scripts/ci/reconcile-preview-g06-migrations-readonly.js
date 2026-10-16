'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED = Object.freeze({
  releaseControlSha: '9fc77d0490f6a49f8d637879f6395237ac34247a',
  applicationSha: 'e12c28c339c6d420c6db13b02aa1ddffb2c3e5ba',
  applicationTree: 'a2cdfc2f2eea4ad52eeca07b41183d74e5fcfa74',
  schemaSha256: '4f0c0b129b8b52826ddca8ddb03ddbd678ef25ea96fa22aa1928e406e4112d03',
  predecessor: '202610020001_g06_simple_device_offline',
  predecessorSha256: '0cb317e8c243793321f3b3d5cad7f23b845d595f8373f9b62edab1c31c79c82f',
  target: '202610020002_attendance_time_policy_v1',
  targetSha256: '5822719590321945832adf87647ca448773f5eff8cb40b7d35ccdd8cf5f443ee',
  historical28001: '202609280001_g06_gps_only_uat_event_provenance',
  historical28002: '202609280002_g06_gps_only_uat_event_provenance_constraint',
  ef96Sha: 'ef96af501582553c14ff7c6eab9f21f6aec7167b',
  ef96MigrationSha256: '1ed9a78d4e4f9ef855d3f109e890a3b1e6b753590d57cbb2fb1b2ff7b0fc2d15',
  f212Sha: 'f2121bb5e1a2c6cf12ec4ca34ea604a8893fded1',
  f212Migration1Sha256: '725b385df3043b3c071872b3a89552c5439ab3a9930f5f763fc2733b6afb68c8',
  f212Migration2Sha256: '91465decd686c1d83d10ad22296d14da19c57ef0ae9ed11e8aeb875b80ded8d6',
});

const PENDING_COLUMNS = Object.freeze([
  'id', 'employee_id', 'shift_assignment_id', 'capture_id', 'event_type', 'source_mode',
  'captured_at', 'received_at', 'location_evidence', 'device_snapshot', 'risk_flags',
  'payload_digest', 'status', 'reviewed_by_user_id', 'reviewed_at', 'review_comment',
  'attendance_event_id', 'created_at', 'updated_at',
]);
const EXPECTED_COLUMNS = Object.freeze([
  ['attendance_device_enrollments', 'observation_only'],
  ...['device_enrollment_id', 'source_mode', 'device_captured_at', 'review_required', 'review_reasons']
    .map((column) => ['attendance_events', column]),
  ...PENDING_COLUMNS.map((column) => ['attendance_pending_events', column]),
]);
const EXPECTED_INDEXES = Object.freeze([
  'attendance_events_device_enrollment_id_received_at_idx',
  'attendance_events_review_required_received_at_idx',
  'attendance_pending_events_capture_id_key',
  'attendance_pending_events_attendance_event_id_key',
  'attendance_pending_events_employee_id_captured_at_idx',
  'attendance_pending_events_status_received_at_idx',
  'attendance_pending_events_shift_assignment_id_event_type_idx',
]);
const EXPECTED_INDEX_COLUMNS = Object.freeze({
  attendance_events_device_enrollment_id_received_at_idx: ['device_enrollment_id', 'received_at'],
  attendance_events_review_required_received_at_idx: ['review_required', 'received_at'],
  attendance_pending_events_capture_id_key: ['capture_id'],
  attendance_pending_events_attendance_event_id_key: ['attendance_event_id'],
  attendance_pending_events_employee_id_captured_at_idx: ['employee_id', 'captured_at'],
  attendance_pending_events_status_received_at_idx: ['status', 'received_at'],
  attendance_pending_events_shift_assignment_id_event_type_idx: ['shift_assignment_id', 'event_type'],
});
const EXPECTED_CONSTRAINTS = Object.freeze([
  'attendance_events_source_mode_check',
  'attendance_pending_events_pkey',
  'attendance_pending_events_payload_digest_format',
  'attendance_pending_events_offline_only',
  'attendance_pending_events_capture_before_receive',
]);
const EXPECTED_FOREIGN_KEYS = Object.freeze([
  'attendance_events_device_enrollment_id_fkey',
  'attendance_pending_events_employee_id_fkey',
  'attendance_pending_events_shift_assignment_id_fkey',
  'attendance_pending_events_reviewed_by_user_id_fkey',
  'attendance_pending_events_attendance_event_id_fkey',
]);
const DUPLICATE_GROUPS = Object.freeze([
  '202608240003_g06_security_site_qr_gps_v1',
  '202608240004_g06_attendance_event_workflow_v1',
]);
const SAFE_MIGRATION_NAME = /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/;

const SQL = Object.freeze({
  ledger: `SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
    FROM public."_prisma_migrations" ORDER BY started_at, migration_name`,
  columns: `SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND (
      (table_name = 'attendance_device_enrollments' AND column_name = 'observation_only') OR
      (table_name = 'attendance_events' AND column_name IN ('device_enrollment_id','source_mode','device_captured_at','review_required','review_reasons')) OR
      (table_name = 'attendance_pending_events' AND column_name = ANY($1::text[]))
    )`,
  indexes: `SELECT i.relname AS name, x.indisvalid AS valid, x.indisunique AS unique_index,
      pg_catalog.pg_get_indexdef(i.oid) AS definition
    FROM pg_catalog.pg_class t JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_catalog.pg_index x ON x.indrelid=t.oid JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
    WHERE n.nspname='public' AND i.relname = ANY($1::text[])`,
  constraints: `SELECT conname AS name, contype AS kind, convalidated AS valid,
      pg_catalog.pg_get_constraintdef(oid, true) AS definition
    FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace
      AND conname = ANY($1::text[])`,
  tables: `SELECT c.relname AS name, c.relkind AS relation_kind, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('attendance_pending_events','attendance_time_policies')`,
  pendingPrivileges: `SELECT r.rolname AS role_name,
      bool_or(has_table_privilege(r.oid, c.oid, p.privilege)) AS has_any_privilege
    FROM pg_catalog.pg_roles r
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS p(privilege)
    JOIN pg_catalog.pg_class c ON c.relname='attendance_pending_events'
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
    WHERE r.rolname IN ('anon','authenticated') GROUP BY r.rolname`,
  enums: `SELECT t.typname AS type_name, e.enumlabel AS label
    FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid
    WHERE n.nspname='public' AND t.typname IN ('AttendancePendingEventStatus','AttendanceEventProvenance')`,
  legacy: `SELECT
      EXISTS (SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
        JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid
        WHERE n.nspname='public' AND t.typname='AttendanceEventProvenance' AND e.enumlabel='GPS_ONLY_UAT') AS gps_only_uat,
      EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname='public' AND r.relname='attendance_events'
          AND c.conname='attendance_events_verification_provenance_check' AND c.convalidated) AS provenance_check,
      (SELECT CASE WHEN a.attnum IS NULL THEN NULL ELSE NOT a.attnotnull END
        FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class r ON r.oid=a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname='public' AND r.relname='attendance_events'
          AND a.attname='face_verification_session_id' AND a.attnum > 0 AND NOT a.attisdropped
        LIMIT 1) AS face_nullable`,
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function migrationInventory(migrationsRoot) {
  if (!path.isAbsolute(migrationsRoot) || !fs.existsSync(migrationsRoot)) throw new Error('Pinned migration source unavailable');
  return fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.name))
    .map((entry) => {
      const file = path.join(migrationsRoot, entry.name, 'migration.sql');
      if (!fs.existsSync(file)) throw new Error('Pinned migration source incomplete');
      return { name: entry.name, checksum: sha256(file) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function verifyPinnedSources({ applicationRoot, ef96Root, f212Root }) {
  const migrationRoot = path.join(applicationRoot, 'prisma', 'migrations');
  const schema = path.join(applicationRoot, 'prisma', 'schema.prisma');
  const ef96 = path.join(ef96Root, 'prisma', 'migrations', EXPECTED.historical28001, 'migration.sql');
  const f212one = path.join(f212Root, 'prisma', 'migrations', EXPECTED.historical28001, 'migration.sql');
  const f212two = path.join(f212Root, 'prisma', 'migrations', EXPECTED.historical28002, 'migration.sql');
  if (sha256(schema) !== EXPECTED.schemaSha256
      || sha256(path.join(migrationRoot, EXPECTED.predecessor, 'migration.sql')) !== EXPECTED.predecessorSha256
      || sha256(path.join(migrationRoot, EXPECTED.target, 'migration.sql')) !== EXPECTED.targetSha256
      || sha256(ef96) !== EXPECTED.ef96MigrationSha256
      || sha256(f212one) !== EXPECTED.f212Migration1Sha256
      || sha256(f212two) !== EXPECTED.f212Migration2Sha256) {
    throw new Error('Pinned source checksum mismatch');
  }
  return migrationInventory(migrationRoot);
}

function classifyHistorical(rows, sourceChecksums) {
  if (!rows?.length) return 'UNKNOWN';
  const checksums = rows.map((row) => String(row.checksum || '').toLowerCase());
  if (checksums.every((value) => value === sourceChecksums.ef96)) return 'MATCH_EF96AF5';
  if (checksums.every((value) => value === sourceChecksums.f212)) return 'MATCH_F2121BB';
  return 'NO_MATCH';
}

function classifyHistoricalConstraint(rows, expectedChecksum) {
  if (!rows?.length) return 'UNKNOWN';
  return rows.every((row) => String(row.checksum || '').toLowerCase() === expectedChecksum)
    ? 'MATCH_F2121BB' : 'NO_MATCH';
}

function classifyHistoricalVariant(first, second) {
  if (first === 'MATCH_F2121BB' && second === 'MATCH_F2121BB') return 'SPLIT_HISTORY_MATCH';
  if (first === 'MATCH_EF96AF5' && second === 'UNKNOWN') return 'COMBINED_HISTORY_MATCH';
  if (first === 'NO_MATCH' || second === 'NO_MATCH') return 'HISTORY_MISMATCH';
  if (first === 'MATCH_EF96AF5' && second === 'MATCH_F2121BB') return 'INCOMPATIBLE_HISTORY_VARIANTS';
  return 'UNKNOWN';
}

function classifyDuplicateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 2) return 'AMBIGUOUS_DUPLICATE_HISTORY';
  const ordered = [...rows].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  const [earlier, later] = ordered;
  const checksumSame = String(earlier.checksum || '').toLowerCase() === String(later.checksum || '').toLowerCase();
  const earlierRolledBack = Boolean(earlier.rolled_back_at);
  const laterCompleted = Boolean(later.finished_at) && !later.rolled_back_at;
  const noActiveFailure = [earlier, later].filter((row) => !row.rolled_back_at)
    .every((row) => Boolean(row.finished_at));
  return checksumSame && earlierRolledBack && laterCompleted && noActiveFailure
    ? 'VALID_ROLLBACK_REAPPLY_HISTORY' : 'AMBIGUOUS_DUPLICATE_HISTORY';
}

function groupLedger(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row || typeof row.migration_name !== 'string' || !SAFE_MIGRATION_NAME.test(row.migration_name)
      || typeof row.checksum !== 'string' || !/^[0-9a-f]{64}$/i.test(row.checksum)) throw new Error('Migration ledger result malformed');
    if (!groups.has(row.migration_name)) groups.set(row.migration_name, []);
    groups.get(row.migration_name).push(row);
  }
  return groups;
}

function classifyPredecessorSchema(facts) {
  if (!facts || facts.readable !== true) return 'PREDECESSOR_SCHEMA_UNKNOWN';
  const checks = [
    ...EXPECTED_COLUMNS.map(([table, column]) => facts.columns.has(`${table}.${column}`)),
    ...EXPECTED_INDEXES.map((name) => facts.indexes.get(name) === true),
    ...EXPECTED_CONSTRAINTS.map((name) => facts.constraints.get(name) === true),
    ...EXPECTED_FOREIGN_KEYS.map((name) => facts.foreignKeys.get(name) === true),
    facts.sourceModeSemantics === true,
    facts.pendingTable === true,
    facts.pendingRls === true,
    facts.pendingRevokeSafe === true,
    facts.pendingEnum === true,
  ];
  if (checks.every(Boolean) && facts.pendingObjectConflict === false) return 'PREDECESSOR_SCHEMA_PRESENT';
  if (checks.every((value) => value === false) && facts.pendingObjectConflict === false) return 'PREDECESSOR_SCHEMA_ABSENT';
  return 'PREDECESSOR_SCHEMA_PARTIAL';
}

function canonicalHistoryFacts(sourceMigrations, groups, historicalClassifications, duplicateClassifications) {
  const sourceByName = new Map(sourceMigrations.map((entry) => [entry.name, entry.checksum]));
  const pending = [];
  const incomplete = [];
  const mismatch = [];
  for (const migration of sourceMigrations) {
    const rows = groups.get(migration.name) || [];
    if (!rows.length) {
      pending.push(migration.name);
      continue;
    }
    if (rows.some((row) => String(row.checksum).toLowerCase() !== migration.checksum)) mismatch.push(migration.name);
    const active = rows.filter((row) => !row.rolled_back_at);
    if (active.length === 0) pending.push(migration.name);
    else if (active.length !== 1 || !active[0].finished_at) incomplete.push(migration.name);
  }

  const first = sourceMigrations.findIndex((entry) => entry.name === EXPECTED.predecessor);
  const target = sourceMigrations.findIndex((entry) => entry.name === EXPECTED.target);
  const sortedAdjacent = first >= 0 && target === first + 1;
  const allowedPending = new Set([EXPECTED.predecessor, EXPECTED.target]);
  const otherPending = pending.filter((name) => !allowedPending.has(name));
  const targetRows = groups.get(EXPECTED.target) || [];
  const predecessorRows = groups.get(EXPECTED.predecessor) || [];
  const unexplainedLedger = [];
  for (const [name] of groups) {
    if (sourceByName.has(name)) continue;
    const historical = historicalClassifications.get(name);
    if (!historical || historical === 'UNKNOWN' || historical === 'NO_MATCH') unexplainedLedger.push(name);
  }
  const duplicateState = [...duplicateClassifications.values()];
  const unexpectedDuplicateNames = [...groups.entries()]
    .filter(([name, rows]) => rows.length > 1 && !duplicateClassifications.has(name))
    .map(([name]) => name);
  const historyExplained = unexplainedLedger.length === 0 && unexpectedDuplicateNames.length === 0
    && duplicateState.every((state) => state === 'VALID_ROLLBACK_REAPPLY_HISTORY')
    && mismatch.length === 0 && incomplete.length === 0;
  const canonicalNext = sortedAdjacent
    && pending[0] === EXPECTED.predecessor
    && pending.filter((name) => allowedPending.has(name)).join('|') === `${EXPECTED.predecessor}|${EXPECTED.target}`
    && otherPending.length === 0 && incomplete.length === 0 && mismatch.length === 0
    ? 'CANONICAL_NEXT_001'
    : otherPending.length ? 'OTHER_CANONICAL_PENDING' : 'ORDER_UNKNOWN';
  return {
    canonicalNext,
    pendingNames: pending,
    otherPendingNames: otherPending,
    incompleteNames: incomplete,
    checksumMismatchNames: mismatch,
    unexplainedLedgerNames: unexplainedLedger,
    unexpectedDuplicateNames,
    historyExplained,
    predecessorLedger: predecessorRows.length === 0 ? 'ABSENT' : predecessorRows.some((row) => !row.rolled_back_at && row.finished_at) ? 'COMPLETED' : 'PENDING_OR_INCOMPLETE',
    targetLedger: targetRows.length === 0 ? 'ABSENT' : targetRows.some((row) => !row.rolled_back_at && row.finished_at) ? 'COMPLETED' : 'PENDING_OR_INCOMPLETE',
  };
}

function classifyMigrationPlan({ predecessorSchema, targetPolicySchema, canonical, historical28001, historical28002, historicalVariant, duplicateClassifications, legacy }) {
  if (predecessorSchema === 'PREDECESSOR_SCHEMA_PARTIAL') return 'PREDECESSOR_SCHEMA_PARTIAL_RECOVERY_REQUIRED';
  if (predecessorSchema === 'PREDECESSOR_SCHEMA_UNKNOWN') return 'FAIL_CLOSED_UNKNOWN';
  if (canonical?.targetLedger !== 'ABSENT') return canonical?.targetLedger === 'COMPLETED' ? 'MIGRATION_HISTORY_RECOVERY_REQUIRED' : 'FAIL_CLOSED_UNKNOWN';
  if (targetPolicySchema !== 'ABSENT') return targetPolicySchema === 'PRESENT' ? 'MIGRATION_HISTORY_RECOVERY_REQUIRED' : 'FAIL_CLOSED_UNKNOWN';
  if (predecessorSchema === 'PREDECESSOR_SCHEMA_PRESENT') return 'MIGRATION_HISTORY_RECOVERY_REQUIRED';
  if (historicalVariant === 'HISTORY_MISMATCH' || historicalVariant === 'INCOMPATIBLE_HISTORY_VARIANTS' || !canonical?.historyExplained) return 'MIGRATION_HISTORY_RECOVERY_REQUIRED';
  if (historicalVariant === 'UNKNOWN'
      || legacy?.gpsOnlyUat !== 'YES' || legacy?.provenanceCheck !== 'YES' || legacy?.faceNullability !== 'NULLABLE') return 'FAIL_CLOSED_UNKNOWN';
  if (!duplicateClassifications || [...duplicateClassifications.values()].some((state) => state !== 'VALID_ROLLBACK_REAPPLY_HISTORY')) return 'MIGRATION_HISTORY_RECOVERY_REQUIRED';
  if (canonical?.predecessorLedger !== 'ABSENT') return 'MIGRATION_HISTORY_RECOVERY_REQUIRED';
  if (canonical?.canonicalNext !== 'CANONICAL_NEXT_001') return canonical?.canonicalNext === 'OTHER_CANONICAL_PENDING' ? 'MIGRATION_HISTORY_RECOVERY_REQUIRED' : 'FAIL_CLOSED_UNKNOWN';
  if (predecessorSchema === 'PREDECESSOR_SCHEMA_ABSENT') return 'APPLY_001_THEN_002';
  return 'FAIL_CLOSED_UNKNOWN';
}

function tri(value) { return value === true ? 'YES' : value === false ? 'NO' : 'UNKNOWN'; }

function catalogFacts(rows, sources) {
  const columns = new Set(rows.columns.map((row) => `${row.table_name}.${row.column_name}`));
  const indexes = new Map(rows.indexes.map((row) => {
    const definition = String(row.definition || '').toLowerCase().replaceAll('"', '').replaceAll(' ', '');
    const exactColumns = definition.includes(`(${EXPECTED_INDEX_COLUMNS[row.name]?.join(',')})`);
    const exactUnique = row.name.endsWith('_key') ? row.unique_index === true : row.unique_index === false;
    return [row.name, row.valid === true && exactColumns && exactUnique];
  }));
  const enumLabels = new Map();
  for (const row of rows.enums) {
    if (!enumLabels.has(row.type_name)) enumLabels.set(row.type_name, new Set());
    enumLabels.get(row.type_name).add(row.label);
  }
  const pendingRelation = rows.tables.find((row) => row.name === 'attendance_pending_events');
  const table = pendingRelation && ['r', 'p'].includes(pendingRelation.relation_kind) ? pendingRelation : null;
  const privilegeRows = rows.pendingPrivileges;
  const pendingRevokeSafe = privilegeRows.every((row) => row.has_any_privilege === false);
  const pendingEnumLabels = enumLabels.get('AttendancePendingEventStatus') || new Set();
  const legacy = rows.legacy?.[0] || {};
  const sourceModeConstraint = rows.constraints.find((row) => row.name === 'attendance_events_source_mode_check');
  const normalizeDefinition = (value) => String(value || '').toLowerCase().replaceAll('"', '').replaceAll(' ', '').replaceAll('::text', '').replaceAll('(', '').replaceAll(')', '');
  const sourceModeDefinition = normalizeDefinition(sourceModeConstraint?.definition);
  const sourceModeSemantics = sourceModeConstraint?.valid === true
    && ['source_mode=\'online\'', 'source_mode=\'offline\'', 'device_captured_atisnull',
      'device_captured_atisnotnull', 'effective_event_at=received_at',
      'effective_event_at=device_captured_at', 'device_captured_at<=received_at'].every((part) => sourceModeDefinition.includes(part));
  const constraintDefinitions = new Map(rows.constraints.filter((row) => row.kind === 'c' || row.name.endsWith('_pkey'))
    .map((row) => [row.name, normalizeDefinition(row.definition)]));
  const constraints = new Map(EXPECTED_CONSTRAINTS.map((name) => {
    const row = rows.constraints.find((entry) => entry.name === name);
    const definition = constraintDefinitions.get(name) || '';
    const semanticMatch = name === 'attendance_events_source_mode_check' ? sourceModeSemantics
      : name === 'attendance_pending_events_pkey' ? row?.kind === 'p'
        : name === 'attendance_pending_events_payload_digest_format'
          ? definition.includes('payload_digest') && definition.includes('64') && definition.includes('0-9a-f')
          : name === 'attendance_pending_events_offline_only'
            ? definition.includes('source_mode') && definition.includes('offline')
            : name === 'attendance_pending_events_capture_before_receive'
              ? definition.includes('captured_at') && definition.includes('received_at') && definition.includes('<=')
              : false;
    return [name, row?.valid === true && semanticMatch];
  }));
  const fkDefinitions = new Map(rows.constraints.filter((row) => row.kind === 'f').map((row) => [row.name, String(row.definition || '').toLowerCase().replaceAll('"', '').replaceAll(' ', '')]));
  const fkTargets = new Map([
    ['attendance_events_device_enrollment_id_fkey', ['device_enrollment_id', 'attendance_device_enrollments']],
    ['attendance_pending_events_employee_id_fkey', ['employee_id', 'employees']],
    ['attendance_pending_events_shift_assignment_id_fkey', ['shift_assignment_id', 'shift_assignments']],
    ['attendance_pending_events_reviewed_by_user_id_fkey', ['reviewed_by_user_id', 'users']],
    ['attendance_pending_events_attendance_event_id_fkey', ['attendance_event_id', 'attendance_events']],
  ]);
  const foreignKeys = new Map([...fkTargets].map(([name, [column, tableName]]) => {
    const definition = (fkDefinitions.get(name) || '').replaceAll('(', '').replaceAll(')', '');
    return [name, rows.constraints.some((row) => row.name === name && row.valid === true)
      && definition.includes(`foreignkey${column}references`)
      && definition.includes(`${tableName}id`)];
  }));
  const priorServerTimeConstraint = rows.constraints.some((row) => row.name === 'attendance_events_server_time_check');
  return {
    readable: true,
    columns,
    indexes,
    constraints,
    foreignKeys,
    pendingTable: Boolean(table),
    pendingObjectConflict: Boolean(pendingRelation && !table),
    pendingRls: table?.rls_enabled === true,
    pendingRevokeSafe: table ? pendingRevokeSafe : false,
    pendingEnum: ['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'].every((label) => pendingEnumLabels.has(label)),
    sourceModeSemantics,
    priorServerTimeConstraint,
    targetPolicyTable: rows.tables.some((row) => row.name === 'attendance_time_policies' && ['r', 'p'].includes(row.relation_kind)),
    targetPolicyObjectConflict: rows.tables.some((row) => row.name === 'attendance_time_policies' && !['r', 'p'].includes(row.relation_kind)),
    legacy: {
      gpsOnlyUat: tri(legacy.gps_only_uat),
      provenanceCheck: tri(legacy.provenance_check),
      faceNullability: legacy.face_nullable === true ? 'NULLABLE' : legacy.face_nullable === false ? 'NOT_NULL' : 'UNKNOWN',
    },
    sources,
  };
}

function safeFailureCategory(error) {
  const code = String(error?.code || '').toUpperCase();
  if (['42501', 'P1010'].includes(code)) return 'SCHEMA_READ_PERMISSION_DENIED';
  if (['57014', 'P1002', 'ETIMEDOUT'].includes(code)) return 'SCHEMA_QUERY_TIMEOUT';
  if (/^08[A-Z0-9]{3}$/.test(code) || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code)) return 'SCHEMA_CONNECTION_FAILED';
  if (['42P01', '42703', '3F000'].includes(code)) return 'SCHEMA_OBJECT_NOT_FOUND';
  if (['42601', '42883', '42804'].includes(code)) return 'SCHEMA_CATALOG_QUERY_FAILED';
  return 'SCHEMA_READ_UNKNOWN';
}

function writeGithubOutputs(report, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath || !report) return;
  const rows = [
    `preview_target_guard=${report.previewTargetGuard || 'FAIL'}`,
    `migration_plan=${report.migrationPlan || 'FAIL_CLOSED_UNKNOWN'}`,
    `predecessor_schema=${report.predecessorSchema || 'PREDECESSOR_SCHEMA_UNKNOWN'}`,
    `predecessor_ledger=${report.predecessorLedger || 'UNKNOWN'}`,
    `target_ledger=${report.targetLedger || 'UNKNOWN'}`,
    `target_policy_schema=${report.targetPolicySchema || 'UNKNOWN'}`,
    `historical_28001=${report.historical28001 || 'UNKNOWN'}`,
    `historical_28002=${report.historical28002 || 'UNKNOWN'}`,
    `historical_variant=${report.historicalVariant || 'UNKNOWN'}`,
    `gps_only_uat=${report.gpsOnlyUat || 'UNKNOWN'}`,
    `provenance_check=${report.provenanceCheck || 'UNKNOWN'}`,
    `face_nullability=${report.faceNullability || 'UNKNOWN'}`,
    `canonical_order=${report.canonicalNext || 'ORDER_UNKNOWN'}`,
    `other_canonical_pending=${report.otherCanonicalPending || 'UNKNOWN'}`,
  ];
  fs.appendFileSync(outputPath, rows.join('\n') + '\n', { encoding: 'utf8' });
}

async function reconcilePreviewG06({
  env = process.env, log = console.log, targetGuard, client, connect,
  sourceVerifier = verifyPinnedSources,
  applicationRoot = env.APPLICATION_SOURCE_ROOT,
  ef96Root = env.HISTORICAL_EF96_ROOT,
  f212Root = env.HISTORICAL_F212_ROOT,
} = {}) {
  let db = client;
  let ownClient = false;
  let transactionStarted = false;
  let targetGuardPassed = false;
  const emit = (key, value) => log(`${key}=${value}`);
  try {
    const guard = targetGuard || require(path.join(env.RELEASE_CONTROL_ROOT || '', 'scripts', 'ci', 'verify-preview-migration-target.js')).verifyPreviewMigrationTarget;
    guard({ env, log: () => {} });
    targetGuardPassed = true;
    emit('PREVIEW_TARGET_GUARD', 'PASS');
    if (String(env.VERCEL_ENV || '').toLowerCase() !== 'preview' || !env.DATABASE_URL || !env.DIRECT_URL) throw Object.assign(new Error(), { safeClass: 'STATUS_READ_FAILED' });

    const sources = sourceVerifier({ applicationRoot, ef96Root, f212Root });
    if (db) {
      if (typeof db.connect === 'function') await db.connect();
    } else {
      const Client = require('pg').Client;
      db = connect ? connect(env.DATABASE_URL) : new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 15000, query_timeout: 20000 });
      ownClient = true;
      await db.connect();
    }
    await db.query('BEGIN READ ONLY');
    transactionStarted = true;
    await db.query("SET LOCAL statement_timeout = '20000ms'");

    const ledgerResult = await db.query(SQL.ledger);
    const groups = groupLedger(ledgerResult.rows);
    const sourceByName = new Map(sources.map((entry) => [entry.name, entry.checksum]));
    const historical28001 = classifyHistorical(groups.get(EXPECTED.historical28001), {
      ef96: EXPECTED.ef96MigrationSha256,
      f212: EXPECTED.f212Migration1Sha256,
    });
    const historical28002 = classifyHistoricalConstraint(groups.get(EXPECTED.historical28002), EXPECTED.f212Migration2Sha256);
    const historicalVariant = classifyHistoricalVariant(historical28001, historical28002);
    const historicalClassifications = new Map([
      [EXPECTED.historical28001, historical28001],
      [EXPECTED.historical28002, historical28002],
    ]);
    const duplicateClassifications = new Map(DUPLICATE_GROUPS.map((name) => [name, classifyDuplicateRows(groups.get(name))]));
    const canonicalHistory = canonicalHistoryFacts(sources, groups, historicalClassifications, duplicateClassifications);

    const columns = await db.query(SQL.columns, [PENDING_COLUMNS]);
    const indexes = await db.query(SQL.indexes, [EXPECTED_INDEXES]);
    const constraintNames = [...EXPECTED_CONSTRAINTS, ...EXPECTED_FOREIGN_KEYS, 'attendance_events_server_time_check'];
    const constraints = await db.query(SQL.constraints, [constraintNames]);
    const tables = await db.query(SQL.tables);
    const pendingTableExists = tables.rows.some((row) => row.name === 'attendance_pending_events' && ['r', 'p'].includes(row.relation_kind));
    const pendingPrivileges = pendingTableExists ? await db.query(SQL.pendingPrivileges) : { rows: [] };
    const enums = await db.query(SQL.enums);
    const legacyRows = await db.query(SQL.legacy);
    const rows = {
      columns: columns.rows,
      indexes: indexes.rows,
      constraints: constraints.rows,
      tables: tables.rows,
      pendingPrivileges: pendingPrivileges.rows,
      enums: enums.rows,
      legacy: legacyRows.rows,
    };
    const facts = catalogFacts(rows, sources);
    const predecessorSchema = classifyPredecessorSchema(facts);
    const legacy = facts.legacy;
    const targetPolicySchema = facts.targetPolicyTable ? 'PRESENT' : facts.targetPolicyObjectConflict ? 'CONFLICT' : 'ABSENT';
    const plan = classifyMigrationPlan({
      predecessorSchema,
      targetPolicySchema,
      canonical: canonicalHistory,
      historical28001,
      historical28002,
      historicalVariant,
      duplicateClassifications,
      legacy,
    });

    const ledgerInventory = [...groups.entries()].map(([name, records]) => {
      const canonicalChecksum = sourceByName.get(name);
      const historyType = canonicalChecksum
        ? records.every((row) => String(row.checksum).toLowerCase() === canonicalChecksum) ? 'KNOWN_SOURCE_MIGRATION' : 'KNOWN_SOURCE_CHECKSUM_MISMATCH'
        : historicalClassifications.get(name) && !['NO_MATCH', 'UNKNOWN'].includes(historicalClassifications.get(name))
          ? 'MATCHED_PREVIEW_HISTORICAL_SOURCE' : 'UNKNOWN_TO_SOURCE';
      const completion = records.length > 1 ? duplicateClassifications.get(name) || 'DUPLICATE_RECORD'
        : records[0].rolled_back_at ? 'ROLLED_BACK'
          : records[0].finished_at ? 'COMPLETED'
            : 'FAILED_OR_INCOMPLETE';
      return { name, classification: historyType, completion, recordCount: records.length };
    });
    const report = {
      previewTargetGuard: 'PASS',
      predecessorLedger: canonicalHistory.predecessorLedger,
      targetLedger: canonicalHistory.targetLedger,
      predecessorSchema,
      targetPolicySchema,
      historical28001,
      historical28002,
      historicalVariant,
      duplicateClassifications: Object.fromEntries(duplicateClassifications),
      gpsOnlyUat: legacy.gpsOnlyUat,
      provenanceCheck: legacy.provenanceCheck,
      faceNullability: legacy.faceNullability,
      canonicalNext: canonicalHistory.canonicalNext,
      otherCanonicalPending: canonicalHistory.otherPendingNames.length ? canonicalHistory.otherPendingNames.join(',') : 'NONE',
      incompleteCanonical: canonicalHistory.incompleteNames.length ? canonicalHistory.incompleteNames.join(',') : 'NONE',
      canonicalChecksumMismatch: canonicalHistory.checksumMismatchNames.length ? canonicalHistory.checksumMismatchNames.join(',') : 'NONE',
      unexplainedLedger: canonicalHistory.unexplainedLedgerNames.length ? canonicalHistory.unexplainedLedgerNames.join(',') : 'NONE',
      unexpectedDuplicateGroups: canonicalHistory.unexpectedDuplicateNames.length ? canonicalHistory.unexpectedDuplicateNames.join(',') : 'NONE',
      historyExplained: canonicalHistory.historyExplained ? 'YES' : 'NO',
      ledgerInventory,
      migrationPlan: plan,
      predecessorComponents: {
        columns: EXPECTED_COLUMNS.every(([table, column]) => facts.columns.has(`${table}.${column}`)) ? 'PASS' : 'FAIL',
        indexes: EXPECTED_INDEXES.every((name) => facts.indexes.get(name) === true) ? 'PASS' : 'FAIL',
        constraints: EXPECTED_CONSTRAINTS.every((name) => facts.constraints.get(name) === true) ? 'PASS' : 'FAIL',
        foreignKeys: EXPECTED_FOREIGN_KEYS.every((name) => facts.foreignKeys.get(name) === true) ? 'PASS' : 'FAIL',
        pendingTable: facts.pendingTable ? 'PRESENT' : facts.pendingObjectConflict ? 'CONFLICT' : 'ABSENT',
        pendingRls: facts.pendingRls ? 'ENABLED' : 'DISABLED_OR_ABSENT',
        pendingRoleRevokes: facts.pendingRevokeSafe ? 'PASS' : 'FAIL',
        pendingStatusEnum: facts.pendingEnum ? 'PASS' : 'FAIL',
        sourceModeConstraint: facts.sourceModeSemantics ? 'PASS' : 'FAIL',
        priorServerTimeConstraint: facts.priorServerTimeConstraint ? 'PRESENT' : 'ABSENT',
      },
      rawChecksumsEmitted: false,
      businessRowsRead: false,
      databaseMutationsPerformed: false,
      productionAccessed: false,
    };
    emit('PREDECESSOR_LEDGER', report.predecessorLedger);
    emit('TARGET_LEDGER', report.targetLedger);
    emit('PREDECESSOR_SCHEMA', report.predecessorSchema);
    emit('PREDECESSOR_COLUMNS', report.predecessorComponents.columns);
    emit('PREDECESSOR_INDEXES', report.predecessorComponents.indexes);
    emit('PREDECESSOR_CONSTRAINTS', report.predecessorComponents.constraints);
    emit('PREDECESSOR_FOREIGN_KEYS', report.predecessorComponents.foreignKeys);
    emit('PENDING_EVENTS_TABLE', report.predecessorComponents.pendingTable);
    emit('PENDING_EVENTS_RLS', report.predecessorComponents.pendingRls);
    emit('PENDING_EVENTS_ROLE_REVOKES', report.predecessorComponents.pendingRoleRevokes);
    emit('PENDING_EVENTS_STATUS_ENUM', report.predecessorComponents.pendingStatusEnum);
    emit('SOURCE_MODE_SERVER_TIME_CONSTRAINT', report.predecessorComponents.sourceModeConstraint);
    emit('PRIOR_SERVER_TIME_CONSTRAINT', report.predecessorComponents.priorServerTimeConstraint);
    emit('TARGET_POLICY_SCHEMA', report.targetPolicySchema);
    emit('HISTORICAL_202609280001', report.historical28001);
    emit('HISTORICAL_202609280002', report.historical28002);
    emit('HISTORICAL_VARIANT_COMPATIBILITY', report.historicalVariant);
    for (const [name, state] of Object.entries(report.duplicateClassifications)) emit(`DUPLICATE_${name}`, state);
    emit('GPS_ONLY_UAT_ENUM', report.gpsOnlyUat);
    emit('PROVENANCE_CHECK', report.provenanceCheck);
    emit('FACE_VERIFICATION_SESSION_NULLABILITY', report.faceNullability);
    emit('CANONICAL_MIGRATION_ORDER', report.canonicalNext);
    emit('OTHER_CANONICAL_PENDING', report.otherCanonicalPending);
    emit('INCOMPLETE_CANONICAL_MIGRATIONS', report.incompleteCanonical);
    emit('CANONICAL_CHECKSUM_MISMATCHES', report.canonicalChecksumMismatch);
    emit('UNEXPLAINED_LEDGER_MIGRATIONS', report.unexplainedLedger);
    emit('UNEXPECTED_DUPLICATE_GROUPS', report.unexpectedDuplicateGroups);
    emit('HISTORY_EXPLAINED', report.historyExplained);
    emit('LEDGER_INVENTORY_JSON', JSON.stringify(report.ledgerInventory));
    emit('MIGRATION_PLAN', report.migrationPlan);
    emit('RAW_CHECKSUMS_EMITTED', 'false');
    emit('BUSINESS_ROWS_READ', 'false');
    emit('DATABASE_MUTATIONS_PERFORMED', 'false');
    emit('PRODUCTION_ACCESSED', 'false');
    writeGithubOutputs(report);
    return report;
  } catch (error) {
    const category = error?.safeClass || (!targetGuardPassed ? 'PREVIEW_TARGET_GUARD_FAILED' : safeFailureCategory(error));
    if (!targetGuardPassed) emit('PREVIEW_TARGET_GUARD', 'FAIL');
    emit('RECONCILIATION_RESULT', 'STATUS_READ_FAILED');
    emit('SCHEMA_READ_CATEGORY', category);
    emit('MIGRATION_PLAN', 'FAIL_CLOSED_UNKNOWN');
    emit('RAW_DATABASE_ERROR_EMITTED', 'false');
    emit('RAW_CHECKSUMS_EMITTED', 'false');
    emit('BUSINESS_ROWS_READ', 'false');
    emit('DATABASE_MUTATIONS_PERFORMED', 'false');
    emit('PRODUCTION_ACCESSED', 'false');
    const report = { previewTargetGuard: targetGuardPassed ? 'PASS' : 'FAIL', migrationPlan: 'FAIL_CLOSED_UNKNOWN', status: 'STATUS_READ_FAILED', failureCategory: category };
    writeGithubOutputs(report);
    return report;
  } finally {
    if (transactionStarted) await db.query('ROLLBACK').catch(() => {});
    if (ownClient && db) await db.end().catch(() => {});
  }
}

if (require.main === module) {
  reconcilePreviewG06().then((result) => {
    process.exitCode = result.status === 'STATUS_READ_FAILED' ? 1 : 0;
  });
}

module.exports = {
  DUPLICATE_GROUPS,
  EXPECTED,
  EXPECTED_COLUMNS,
  EXPECTED_CONSTRAINTS,
  EXPECTED_FOREIGN_KEYS,
  EXPECTED_INDEXES,
  PENDING_COLUMNS,
  SQL,
  canonicalHistoryFacts,
  classifyDuplicateRows,
  classifyHistorical,
  classifyHistoricalConstraint,
  classifyHistoricalVariant,
  classifyMigrationPlan,
  classifyPredecessorSchema,
  groupLedger,
  migrationInventory,
  reconcilePreviewG06,
  safeFailureCategory,
  writeGithubOutputs,
  verifyPinnedSources,
};
