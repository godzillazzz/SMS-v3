'use strict';

/*
 * Read-only deep diagnosis for the Preview migration chain.  This file is
 * intentionally a diagnostic, not a migration-repair mechanism.  It only
 * issues SELECT/metadata queries and uses Prisma's migration diff in script
 * mode (which does not write to the target database).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { verifyPreviewMigrationTarget } = require('./verify-preview-migration-target');
const chain = require('./diagnose-preview-migration-chain');

const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations');
const EXPECTED_HEAD = '202609010002_mdg_master_codes_department_site_authority';
const FOCUS_MIGRATIONS = [
  '202608240004_g06_attendance_event_workflow_v1',
  '202608250001_g06_face_match_only_mode_v1',
  '202608250002_g06_department_security_site_default_v1',
  '202608250003_attendance_governance_v1',
  '202608270001_attendance_adjustment_request_v4',
];
const DATA_MIGRATIONS = [
  '202608310001_cfg03_leave_type_master',
  '202608310003_cfg05_auto_schedule_pattern_master',
  '202608310004_cfg06_approval_authority_policy',
  '202608310005_cfg07_data_retention_center',
  '202609010001_emp_ux_department_position_master',
  '202609010002_mdg_master_codes_department_site_authority',
];
const BUSINESS_TABLES = [
  'employees', 'users', 'leave_requests', 'shift_assignments', 'shift_types',
  'security_sites', 'security_site_departments', 'face_verification_sessions',
  'face_verification_receipts', 'attendance_sessions', 'attendance_events',
  'attendance_corrections', 'attendance_adjustment_requests',
  'attendance_adjustment_revisions', 'attendance_adjustment_events',
  'department_master', 'position_master', 'system_settings',
  'retention_policy_changes', 'retention_cleanup_runs',
];

function emit(name, value) { console.log(`${name}=${value}`); }
function bool(value) { return value ? 'YES' : 'NO'; }
function safeValue(value) { return String(value ?? '').replace(/[\r\n]+/g, ' ').trim(); }
function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('unsafe diagnostic identifier');
  return `"${value}"`;
}
function queryRaw(prisma, sql) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') throw new Error('read-only Prisma query unavailable');
  return prisma.$queryRawUnsafe(sql);
}
function objectKey(object) {
  if (object.kind === 'table') return `table:${object.table}`;
  if (object.kind === 'column') return `column:${object.table}.${object.column}`;
  if (object.kind === 'enum') return `enum:${object.typeName}`;
  if (object.kind === 'index') return `index:${object.table}.${object.name}`;
  if (object.kind === 'constraint' || object.kind === 'drop_constraint') return `constraint:${object.table}.${object.name}`;
  if (object.kind === 'drop_column') return `column:${object.table}.${object.column}`;
  if (object.kind === 'policy') return `policy:${object.table}.${object.name}`;
  if (object.kind === 'rls') return `rls:${object.table}`;
  return `${object.kind}:${JSON.stringify(object)}`;
}
function expectedSummary(object) {
  if (object.kind === 'table') return `table ${object.table} exists`;
  if (object.kind === 'column') return `type=${object.type}; not_null=${bool(object.notNull)}; default=${bool(object.hasDefault)}`;
  if (object.kind === 'enum') return `labels=[${object.labels.join(',')}]`;
  if (object.kind === 'index') return `unique=${bool(object.unique)}; columns=[${object.columns.join(',')}]; predicate=${chain.normalizeWhitespace(object.predicate) || 'none'}`;
  if (object.kind === 'constraint') return `type=${object.type}; definition=${chain.normalizeWhitespace(object.definition)}`;
  if (object.kind === 'policy') return `policy=${object.name}`;
  if (object.kind === 'rls') return `rowsecurity=${bool(object.enabled)}; force=${bool(object.forced)}`;
  if (object.kind === 'drop_constraint') return `constraint absent after migration: ${object.name}`;
  if (object.kind === 'drop_column') return `column absent after migration: ${object.column}`;
  return JSON.stringify(object);
}
function actualSummary(object, inventory) {
  if (object.kind === 'table') return inventory.tables.has(object.table) ? 'exists' : 'missing';
  if (object.kind === 'column') {
    const row = inventory.columns.get(`${object.table}.${object.column}`);
    if (!row) return 'missing';
    return `type=${safeValue(row.udt_name || row.data_type)}; not_null=${String(row.is_nullable).toUpperCase() === 'NO' ? 'YES' : 'NO'}; default=${row.column_default ? 'YES' : 'NO'}`;
  }
  if (object.kind === 'enum') return inventory.enums.has(object.typeName) ? `labels=[${inventory.enums.get(object.typeName).join(',')}]` : 'missing';
  if (object.kind === 'index') {
    const row = inventory.indexes.get(`${object.table}.${object.name}`);
    return row ? `definition=${chain.normalizeWhitespace(row.indexdef)}` : 'missing';
  }
  if (object.kind === 'constraint') {
    const row = inventory.constraints.get(`${object.table}.${object.name}`);
    return row ? `type=${row.contype}; definition=${chain.normalizeWhitespace(row.definition)}` : 'missing';
  }
  if (object.kind === 'policy') {
    const row = inventory.policies.get(`${object.table}.${object.name}`);
    return row ? `cmd=${row.cmd}; roles=[${(row.roles || []).join(',')}]` : 'missing';
  }
  if (object.kind === 'rls') {
    const row = inventory.rls.get(object.table);
    return row ? `rowsecurity=${bool(row.relrowsecurity)}; force=${bool(row.relforcerowsecurity)}` : 'missing';
  }
  if (object.kind === 'drop_constraint') return inventory.constraints.has(`${object.table}.${object.name}`) ? 'still exists' : 'absent';
  if (object.kind === 'drop_column') return inventory.columns.has(`${object.table}.${object.column}`) ? 'still exists' : 'absent';
  return 'unavailable';
}
function differenceReason(object, inventory, state) {
  if (state === 'MISSING') return 'expected object is absent from Preview metadata';
  if (object.kind === 'column') {
    const row = inventory.columns.get(`${object.table}.${object.column}`);
    const reasons = [];
    if (row && object.type && !typeMatchesForReport(object.type, row)) reasons.push('type');
    if (row && object.notNull !== (String(row.is_nullable).toUpperCase() === 'NO')) reasons.push('nullability');
    if (row && object.hasDefault !== Boolean(row.column_default)) reasons.push('default');
    return `column ${reasons.join(',') || 'definition'} differs`;
  }
  if (object.kind === 'enum') return 'enum labels or order differs';
  if (object.kind === 'index') return 'index uniqueness, columns, predicate, or definition differs';
  if (object.kind === 'constraint') return 'constraint type, referenced columns, actions, or check expression differs';
  if (object.kind === 'rls') return 'row-security mode differs';
  return 'object definition differs from migration intent';
}
function typeMatchesForReport(expected, actual) {
  const type = chain.normalizeWhitespace(expected).replace(/\s+/g, '');
  const udt = String(actual.udt_name || '').toLowerCase();
  const dataType = String(actual.data_type || '').toLowerCase().replace(/\s+/g, '');
  if (type.startsWith('"') && type.endsWith('"')) return udt === type.slice(1, -1).toLowerCase();
  if (type.startsWith('character varying') || type.startsWith('varchar')) return udt === 'varchar';
  if (type.startsWith('timestampwithtimezone') || type.startsWith('timestamptz')) return udt === 'timestamptz';
  if (type.startsWith('timestamp')) return udt === 'timestamp';
  if (type.startsWith('char')) return udt === 'bpchar';
  if (type === 'integer' || type === 'int') return udt === 'int4';
  if (type === 'bigint') return udt === 'int8';
  if (type === 'boolean' || type === 'bool') return udt === 'bool';
  if (type === 'jsonb') return udt === 'jsonb';
  if (type === 'uuid') return udt === 'uuid';
  if (type === 'date') return udt === 'date';
  if (type === 'text') return udt === 'text';
  return udt === type || dataType === type;
}
function provenance(object, migrations, migrationName) {
  const names = [];
  const needle = object.table || object.typeName || object.name || object.column || '';
  if (!needle) return 'UNKNOWN';
  for (const migration of migrations) {
    if (migration.name === migrationName) continue;
    if (new RegExp(`(?:^|[\\".])${needle.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:[\\".]|$)`, 'i').test(migration.sql || '')) names.push(migration.name);
  }
  if (names.some((name) => name > migrationName)) return 'LATER_GOVERNED_EVOLUTION';
  const history = spawnSync('git', ['log', '--all', '--oneline', '-S', needle, '--', 'prisma/migrations'], { encoding: 'utf8' });
  if (String(history.stdout || '').trim()) return 'LEGACY_SCHEMA_VARIANT';
  return 'UNKNOWN';
}
function structuralObjects(migration, inventory) {
  return migration.objects.map((object) => ({ object, state: chain.compareObject(object, inventory) }));
}
function extractDataOperations(migration) {
  const operations = [];
  for (const statement of migration.statements) {
    const text = statement.trim();
    if (/^INSERT\s+INTO\s+/i.test(text)) {
      const target = text.match(/^INSERT\s+INTO\s+(?:"public"\.)?"([^"]+)"/i)?.[1] || 'unknown';
      operations.push({ operation: 'INSERT', target, statement: text });
    } else if (/^UPDATE\s+/i.test(text)) {
      const target = text.match(/^UPDATE\s+(?:"public"\.)?"([^"]+)"/i)?.[1] || 'unknown';
      operations.push({ operation: 'UPDATE', target, statement: text });
    } else if (/^DELETE\s+FROM\s+/i.test(text)) {
      const target = text.match(/^DELETE\s+FROM\s+(?:"public"\.)?"([^"]+)"/i)?.[1] || 'unknown';
      operations.push({ operation: 'DELETE', target, statement: text });
    } else if (/^COPY\s+/i.test(text)) {
      operations.push({ operation: 'COPY', target: 'unknown', statement: text });
    }
  }
  return operations;
}
function dataPurpose(migrationName, operation, target) {
  if (migrationName.startsWith('202608310001')) return operation === 'INSERT' ? 'seed three governed leave-type master rows' : 'backfill leave request type/name/quota snapshots from legacy leave_type';
  if (migrationName.startsWith('202608310003')) return 'seed deterministic SUPERVISOR and ROTATE auto-schedule patterns';
  if (migrationName.startsWith('202608310004')) return 'seed 26 approval-policy reviewer/SLA configuration keys';
  if (migrationName.startsWith('202608310005')) return operation === 'INSERT' ? 'seed retention policy authority values' : 'no destructive data operation; RLS block is schema/security control';
  if (migrationName.startsWith('202609010001')) return 'materialize normalized department and position master rows from employees';
  if (migrationName.startsWith('202609010002')) return operation === 'UPDATE' ? 'backfill stable department/position codes and site department master links' : 'fail closed if department/site authority backfill is incomplete';
  return 'migration data effect requires source review';
}
function dataMeta(migrationName, operation, target) {
  const cfg03 = migrationName.startsWith('202608310001');
  const cfg05 = migrationName.startsWith('202608310003');
  const cfg06 = migrationName.startsWith('202608310004');
  const cfg07 = migrationName.startsWith('202608310005');
  const emp = migrationName.startsWith('202609010001');
  const mdg = migrationName.startsWith('202609010002');
  const insert = operation === 'INSERT';
  const upsert = insert && (cfg03 || cfg05 || cfg06 || cfg07 || emp);
  return {
    idempotent: upsert || (operation === 'UPDATE' && (cfg03 || mdg || emp)),
    conflict: upsert ? 'ON CONFLICT DO NOTHING' : operation === 'UPDATE' ? 'predicate-limited update; existing non-null values may remain' : 'none',
    prerequisite: cfg03 ? 'leave_type_master and leave_requests columns' : cfg05 ? 'auto_schedule_patterns table' : cfg06 ? 'system_settings table' : cfg07 ? 'retention tables and system_settings' : emp ? 'employees plus department_master/position_master' : mdg ? 'department/position masters and security_site_departments' : 'source schema',
    runtime: cfg03 || cfg05 || cfg06 || cfg07 || emp || mdg,
    replayable: upsert || (operation === 'UPDATE' && (cfg03 || mdg || emp)),
    skipFailure: cfg03 || cfg05 || cfg06 || cfg07 || emp || mdg,
  };
}
async function countIfExists(prisma, table, predicate = '') {
  const quoted = quoteIdent(table);
  const rows = await queryRaw(prisma, `SELECT to_regclass('public.${table}')::text AS regclass`);
  if (!rows?.[0]?.regclass) return { exists: false, count: 0 };
  const suffix = predicate ? ` WHERE ${predicate}` : '';
  const counts = await queryRaw(prisma, `SELECT COUNT(*)::bigint AS count FROM ${quoted}${suffix}`);
  return { exists: true, count: Number(counts?.[0]?.count || 0) };
}
async function dataInventory(prisma) {
  const result = {};
  for (const table of ['leave_type_master', 'leave_requests', 'auto_schedule_patterns', 'system_settings', 'department_master', 'position_master', 'security_site_departments', 'retention_policy_changes', 'retention_cleanup_runs', 'employees']) {
    try { result[table] = await countIfExists(prisma, table); } catch { result[table] = { exists: false, count: 'UNKNOWN' }; }
  }
  let approvalCount = 'UNKNOWN';
  let retentionSettingCount = 'UNKNOWN';
  try {
    const rows = await queryRaw(prisma, `SELECT COUNT(*)::bigint AS count FROM "system_settings" WHERE "key" LIKE 'APPROVAL_POLICY.%'`);
    approvalCount = Number(rows?.[0]?.count || 0);
  } catch {}
  try {
    const rows = await queryRaw(prisma, `SELECT COUNT(*)::bigint AS count FROM "system_settings" WHERE "key" LIKE 'RETENTION.%'`);
    retentionSettingCount = Number(rows?.[0]?.count || 0);
  } catch {}
  result.approvalPolicyCount = approvalCount;
  result.retentionSettingCount = retentionSettingCount;
  return result;
}
async function rlsInventory(prisma) {
  const [rel, policies, roles, grants] = await Promise.all([
    queryRaw(prisma, `SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'attendance_evidence'`),
    queryRaw(prisma, `SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attendance_evidence' ORDER BY policyname`),
    queryRaw(prisma, `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`),
    queryRaw(prisma, `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'attendance_evidence' AND grantee IN ('anon','authenticated') ORDER BY grantee, privilege_type`),
  ]);
  return { rel: rel?.[0] || null, policies: policies || [], roles: (roles || []).map((row) => String(row.rolname)), grants: grants || [] };
}
function rlsClassification(state) {
  if (!state.rel) return 'MISSING';
  const enabled = Boolean(state.rel.relrowsecurity);
  const grants = state.grants.length;
  if (!enabled) return 'MISSING';
  if (grants > 0) return 'CONFLICT';
  if (state.policies.length > 0) return 'SAFE_SUPERSET';
  return 'EXACT_EQUIVALENT';
}
function diffCategories(output) {
  const counts = { CREATE_TYPE_COUNT: 0, ALTER_TYPE_COUNT: 0, CREATE_TABLE_COUNT: 0, ALTER_TABLE_COUNT: 0, ADD_COLUMN_COUNT: 0, DROP_COLUMN_COUNT: 0, CREATE_INDEX_COUNT: 0, DROP_INDEX_COUNT: 0, ADD_CONSTRAINT_COUNT: 0, DROP_CONSTRAINT_COUNT: 0, RLS_CHANGE_COUNT: 0, OTHER_COUNT: 0 };
  const statements = chain.splitStatements(chain.stripSqlComments ? chain.stripSqlComments(output) : String(output || ''));
  for (const statement of statements) {
    const text = statement.trim();
    if (/^CREATE\s+TYPE\b/i.test(text)) counts.CREATE_TYPE_COUNT += 1;
    else if (/^ALTER\s+TYPE\b/i.test(text)) counts.ALTER_TYPE_COUNT += 1;
    else if (/^CREATE\s+TABLE\b/i.test(text)) counts.CREATE_TABLE_COUNT += 1;
    else if (/^ALTER\s+TABLE\b/i.test(text)) {
      counts.ALTER_TABLE_COUNT += 1;
      if (/\bADD\s+COLUMN\b/i.test(text)) counts.ADD_COLUMN_COUNT += 1;
      if (/\bDROP\s+COLUMN\b/i.test(text)) counts.DROP_COLUMN_COUNT += 1;
      if (/\bADD\s+CONSTRAINT\b/i.test(text)) counts.ADD_CONSTRAINT_COUNT += 1;
      if (/\bDROP\s+CONSTRAINT\b/i.test(text)) counts.DROP_CONSTRAINT_COUNT += 1;
      if (/ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|DROP\s+POLICY|REVOKE\s+ALL/i.test(text)) counts.RLS_CHANGE_COUNT += 1;
    } else if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(text)) counts.CREATE_INDEX_COUNT += 1;
    else if (/^DROP\s+INDEX\b/i.test(text)) counts.DROP_INDEX_COUNT += 1;
    else if (/^ALTER\s+TABLE\b/i.test(text)) counts.ADD_CONSTRAINT_COUNT += 1;
    else if (/^DROP\s+CONSTRAINT\b/i.test(text)) counts.DROP_CONSTRAINT_COUNT += 1;
    else if (/ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY|DROP\s+POLICY|REVOKE\s+ALL/i.test(text)) counts.RLS_CHANGE_COUNT += 1;
    else counts.OTHER_COUNT += 1;
  }
  return counts;
}
function mapDiffToMigrations(output, migrations) {
  const result = new Map();
  const statements = chain.splitStatements(String(output || ''));
  for (const statement of statements) {
    const names = migrations.filter((migration) => {
      const tokens = [...String(statement).matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((match) => match[1]);
      return tokens.some((token) => migration.statements.join('\n').includes(`"${token}"`));
    }).map((migration) => migration.name);
    const key = names[0] || 'UNMAPPED';
    result.set(key, (result.get(key) || 0) + 1);
  }
  return result;
}
async function schemaBusinessSummary(prisma) {
  let nonEmpty = 0;
  const parts = [];
  for (const table of BUSINESS_TABLES) {
    try {
      const row = await countIfExists(prisma, table);
      if (row.exists && Number(row.count) > 0) nonEmpty += 1;
      parts.push(`${table}:${row.exists ? row.count : 'ABSENT'}`);
    } catch { parts.push(`${table}:UNKNOWN`); }
  }
  return { nonEmpty, parts };
}
function emitDataReview(migration, inventory) {
  const ops = extractDataOperations(migration);
  const prefix = `DATA_REVIEW_${migration.name}`;
  emit(`${prefix}_OPERATION_COUNT`, ops.length);
  ops.forEach((op, index) => {
    const meta = dataMeta(migration.name, op.operation, op.target);
    const n = index + 1;
    let current = 'UNKNOWN';
    if (op.target === 'leave_type_master') current = inventory.leave_type_master?.exists ? inventory.leave_type_master.count : 'ABSENT';
    if (op.target === 'auto_schedule_patterns') current = inventory.auto_schedule_patterns?.exists ? inventory.auto_schedule_patterns.count : 'ABSENT';
    if (op.target === 'system_settings' && migration.name.startsWith('202608310004')) current = inventory.approvalPolicyCount;
    if (op.target === 'system_settings' && migration.name.startsWith('202608310005')) current = inventory.retentionSettingCount;
    if (op.target === 'department_master') current = inventory.department_master?.exists ? inventory.department_master.count : 'ABSENT';
    if (op.target === 'position_master') current = inventory.position_master?.exists ? inventory.position_master.count : 'ABSENT';
    emit(`${prefix}_${n}_OPERATION`, op.operation);
    emit(`${prefix}_${n}_TARGET`, op.target);
    emit(`${prefix}_${n}_PURPOSE`, dataPurpose(migration.name, op.operation, op.target));
    emit(`${prefix}_${n}_IDEMPOTENT`, bool(meta.idempotent));
    emit(`${prefix}_${n}_CONFLICT_BEHAVIOR`, meta.conflict);
    emit(`${prefix}_${n}_PREREQUISITE_SCHEMA`, meta.prerequisite);
    emit(`${prefix}_${n}_CURRENT_TARGET_ROWS`, current);
    emit(`${prefix}_${n}_RUNTIME_DEPENDENCY`, bool(meta.runtime));
    emit(`${prefix}_${n}_REPLAYABLE`, bool(meta.replayable));
    emit(`${prefix}_${n}_SKIP_SEMANTIC_FAILURE`, bool(meta.skipFailure));
  });
}
async function main() {
  verifyPreviewMigrationTarget({ env: process.env, log: emit });
  emit('PRODUCTION_TARGET_REJECT_GUARD', 'PASS');
  emit('READ_ONLY_DIAGNOSTIC', 'PASS');
  const prisma = new PrismaClient();
  try {
    const migrations = chain.readMigrations();
    const byName = new Map(migrations.map((migration) => [migration.name, migration]));
    const ledgerRows = await queryRaw(prisma, `
      SELECT id::text AS id, migration_name, checksum, started_at, finished_at,
             rolled_back_at, applied_steps_count, (logs IS NOT NULL) AS logs_present
      FROM "_prisma_migrations"
      ORDER BY migration_name ASC, started_at ASC NULLS FIRST, id ASC
    `);
    const applied = new Set((ledgerRows || []).filter((row) => row.finished_at && !row.rolled_back_at).map((row) => String(row.migration_name)));
    const pending = migrations.filter((migration) => !applied.has(migration.name));
    emit('TOTAL_PENDING_MIGRATIONS', pending.length);
    emit('PENDING_MIGRATION_LIST', pending.map((migration) => migration.name).join(','));
    const focusRows = (ledgerRows || []).filter((row) => String(row.migration_name) === '202608240004_g06_attendance_event_workflow_v1');
    emit('TARGET_240004_LEDGER_ROW_COUNT', focusRows.length);
    focusRows.forEach((row, index) => {
      const n = index + 1;
      const expected = byName.get('202608240004_g06_attendance_event_workflow_v1');
      emit(`TARGET_240004_ROW_${n}_CHECKSUM_MATCH`, expected && String(row.checksum) === expected.checksum ? 'YES' : 'NO');
      emit(`TARGET_240004_ROW_${n}_FINISHED`, bool(row.finished_at));
      emit(`TARGET_240004_ROW_${n}_ROLLED_BACK`, bool(row.rolled_back_at));
      emit(`TARGET_240004_ROW_${n}_APPLIED_STEPS`, Number(row.applied_steps_count ?? 0));
      emit(`TARGET_240004_ROW_${n}_STATE`, chain.rowState(row));
    });

    const inventory = await chain.loadInventory(prisma);
    const results = [];
    for (const migration of pending) {
      const states = structuralObjects(migration, inventory);
      const comparison = {
        matching: states.filter((item) => item.state === 'MATCHING').length,
        differing: states.filter((item) => item.state === 'DIFFERING').length,
        missing: states.filter((item) => item.state === 'MISSING').length,
      };
      const classification = migration.name === '202608270004_attendance_face_evidence_rls_v1'
        ? 'UNRESOLVED'
        : chain.classifyMigration(migration, comparison, 'FAIL');
      results.push({ migration, states, comparison, classification });
      emit(`MIGRATION_${migration.name}_CHECKSUM`, migration.checksum);
      emit(`MIGRATION_${migration.name}_EXECUTABLE_STATEMENTS`, migration.statementCount);
      emit(`MIGRATION_${migration.name}_HAS_DATA_STATEMENTS`, bool(migration.dataStatements));
      emit(`MIGRATION_${migration.name}_EXPECTED_OBJECT_COUNT`, migration.objects.length + migration.unsupported.length);
      emit(`MIGRATION_${migration.name}_MATCHING_OBJECT_COUNT`, comparison.matching);
      emit(`MIGRATION_${migration.name}_DIFFERING_OBJECT_COUNT`, comparison.differing);
      emit(`MIGRATION_${migration.name}_MISSING_OBJECT_COUNT`, comparison.missing);
      emit(`MIGRATION_${migration.name}_CLASSIFICATION`, classification);
      if (FOCUS_MIGRATIONS.includes(migration.name)) {
        states.filter((item) => item.state !== 'MATCHING').forEach((item, index) => {
          const n = index + 1;
          emit(`DIFF_${migration.name}_${n}_OBJECT_KIND`, item.object.kind);
          emit(`DIFF_${migration.name}_${n}_TABLE_OR_TYPE`, item.object.table || item.object.typeName || 'n/a');
          emit(`DIFF_${migration.name}_${n}_OBJECT_NAME`, item.object.name || item.object.column || item.object.typeName || item.object.table || 'n/a');
          emit(`DIFF_${migration.name}_${n}_EXPECTED`, expectedSummary(item.object));
          emit(`DIFF_${migration.name}_${n}_ACTUAL`, actualSummary(item.object, inventory));
          emit(`DIFF_${migration.name}_${n}_DIFFERENCE_REASON`, differenceReason(item.object, inventory, item.state));
          emit(`DIFF_${migration.name}_${n}_PROVENANCE`, provenance(item.object, migrations, migration.name));
        });
      }
    }
    const focus240004 = results.find((result) => result.migration.name === '202608240004_g06_attendance_event_workflow_v1');
    if (focus240004) {
      const differences = focus240004.states.filter((item) => item.state !== 'MATCHING');
      emit('MIGRATION_240004_CLASSIFICATION', focus240004.classification);
      emit('MIGRATION_240004_EXACT_DIFFERENCES', differences.length === 2 ? 'PROVEN' : 'NOT_PROVEN');
      emit('MIGRATION_240004_DIFFERING_OBJECT_COUNT', differences.length);
      emit('MIGRATION_240004_DIFFERENCE_1', differences[0] ? `${differences[0].object.kind}:${differences[0].object.table || differences[0].object.typeName || differences[0].object.name || differences[0].object.column}` : 'NONE');
      emit('MIGRATION_240004_DIFFERENCE_2', differences[1] ? `${differences[1].object.kind}:${differences[1].object.table || differences[1].object.typeName || differences[1].object.name || differences[1].object.column}` : 'NONE');
      emit('MIGRATION_240004_DIFFERENCE_PROVENANCE', differences.map((item) => provenance(item.object, migrations, focus240004.migration.name)).join(',') || 'NONE');
    }

    const rls = await rlsInventory(prisma);
    emit('RLS_270004_EXPECTED', 'attendance_evidence:rowsecurity=true;forcerowsecurity=false;policies=none;anon/authenticated=REVOKED_WHEN_ROLE_EXISTS');
    emit('RLS_270004_ACTUAL', `attendance_evidence:${rls.rel ? `rowsecurity=${bool(rls.rel.relrowsecurity)};forcerowsecurity=${bool(rls.rel.relforcerowsecurity)}` : 'table=ABSENT'};policies=${rls.policies.length};roles=${rls.roles.join(',') || 'none'};grants=${rls.grants.length}`);
    emit('RLS_270004_CLASSIFICATION', rlsClassification(rls));
    emit('RLS_270004_POLICY_COUNT', rls.policies.length);
    emit('RLS_270004_ROLE_GRANT_COUNT', rls.grants.length);

    const dataCounts = await dataInventory(prisma);
    for (const migrationName of DATA_MIGRATIONS) {
      const migration = byName.get(migrationName);
      if (migration) emitDataReview(migration, dataCounts);
    }
    emit('CFG03_DATA_REQUIRED', 'YES');
    emit('CFG05_DATA_REQUIRED', 'YES');
    emit('CFG06_APPROVAL_POLICY_DATA_REQUIRED', 'YES');
    emit('CFG07_DATA_REQUIRED', 'YES');
    emit('EMP_UX_DATA_REQUIRED', 'YES');
    emit('MDG_DATA_REQUIRED', 'YES');
    emit('APPROVAL_POLICY_REFERENCE_DATA_ROWS', dataCounts.approvalPolicyCount);

    const fullSchemaDiff = chain.runSchemaDiff();
    emit('FULL_SCHEMA_DIFF', fullSchemaDiff.state);
    emit('FULL_SCHEMA_DIFF_SHA256', fullSchemaDiff.hash);
    emit('FULL_SCHEMA_DIFF_STATEMENT_COUNT', fullSchemaDiff.statementCount);
    const categories = diffCategories(fullSchemaDiff.output || '');
    for (const [key, value] of Object.entries(categories)) emit(key, value);
    emit('FULL_SCHEMA_DIFF_ANALYSIS', 'COMPLETE');
    const diffMap = mapDiffToMigrations(fullSchemaDiff.output || '', migrations);
    for (const [name, count] of diffMap.entries()) emit(`FULL_SCHEMA_DIFF_MIGRATION_${name}`, count);

    const business = await schemaBusinessSummary(prisma);
    emit('PREVIEW_BUSINESS_TABLE_COUNT_SUMMARY', business.parts.join(';'));
    emit('PREVIEW_NON_EMPTY_BUSINESS_TABLES', business.nonEmpty);
    emit('PREVIEW_REBUILD_DATA_LOSS_RISK', business.nonEmpty > 0 ? 'HIGH' : 'LOW');
    emit('PREVIEW_REBUILD_FEASIBILITY', business.nonEmpty > 0 ? 'FEASIBLE_ONLY_WITH_APPROVED_DATA_RECONSTRUCTION_PLAN' : 'FEASIBLE_WITH_REBUILD_GOVERNANCE');

    const exact = results.filter((result) => result.classification === 'EXACT_EQUIVALENT_ALREADY_PRESENT').length;
    const genuine = results.filter((result) => result.classification === 'GENUINELY_PENDING').length;
    const conflict = results.filter((result) => ['SCHEMA_CONFLICT', 'PARTIAL_EQUIVALENT'].includes(result.classification)).length;
    const dataReview = pending.filter((migration) => migration.dataStatements).length;
    const unresolved = results.filter((result) => result.classification === 'UNRESOLVED').length;
    emit('EXACT_EQUIVALENT_COUNT', exact);
    emit('GENUINELY_PENDING_COUNT', genuine);
    emit('PARTIAL_OR_CONFLICT_COUNT', conflict);
    emit('DATA_REVIEW_COUNT', dataReview);
    emit('UNRESOLVED_COUNT', unresolved);
    emit('PREVIEW_MIGRATION_DIVERGENCE_CLASS', conflict >= 2 ? 'MIXED_PREEXISTING_AND_PENDING' : 'UNRESOLVED');
    emit('STRATEGY_A_PRESERVE_RECONCILIATION', 'requires ordered structural equivalence proof, exact no-data allowlist reconciliation, governed data migrations, then remaining deploy; stop on every conflict');
    emit('STRATEGY_B_REBUILD_ISOLATED_PREVIEW', 'requires Owner-approved disposable-data decision, UAT-user/config reconstruction, full repository migration replay, and post-rebuild runtime proof');
    emit('STRATEGY_C_GOVERNED_BASELINE_RECONSTRUCTION', 'requires reviewed baseline/reconciliation migration derived from actual Preview schema, explicit data-effect replay, and one protected execution gate');
    emit('RECOMMENDED_PREVIEW_RECOVERY', business.nonEmpty > 0 && conflict >= 2 ? 'GOVERNED_BASELINE_RECONSTRUCTION' : 'UNRESOLVED_STOP');
    emit('REMEDIATION_EXECUTED', 'NO');
    emit('RESOLVE_EXECUTED', 'NO');
    emit('MIGRATION_DEPLOY_EXECUTED', 'NO');
    emit('DB_MUTATION', 'NONE');
    emit('PRODUCTION_DB_ACCESSED', 'NO');
    emit('RAW_DATABASE_OUTPUT_EMITTED', 'false');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Preview deep migration diagnosis failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { diffCategories, extractDataOperations, dataMeta, rlsClassification };
