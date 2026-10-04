'use strict';

// Catalog/ledger observation only. The caller must prove the Production target first.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PREDECESSOR = '202610020001_g06_simple_device_offline';
const TARGET = '202610020002_attendance_time_policy_v1';
const REQUIRED_COLUMNS = Object.freeze({
  attendance_time_policies: { id: 'uuid', scope_type: 'varchar', site_id: 'uuid', shift_type_id: 'uuid', policy: 'jsonb', effective_from: 'timestamptz', created_by_user_id: 'uuid', created_at: 'timestamptz' },
  attendance_events: { punctuality: 'varchar', checkout_condition: 'varchar', time_policy_snapshot: 'jsonb' },
  attendance_pending_events: { time_policy_snapshot: 'jsonb' }
});
const INDEXES = Object.freeze([
  'attendance_time_policies_company_effective_idx', 'attendance_time_policies_company_effective_key',
  'attendance_time_policies_site_effective_idx', 'attendance_time_policies_site_effective_key',
  'attendance_time_policies_shift_effective_idx', 'attendance_time_policies_shift_effective_key',
  'attendance_time_policies_created_by_created_idx'
]);
const CONSTRAINTS = Object.freeze([
  'attendance_time_policies_pkey', 'attendance_time_policies_scope_check', 'attendance_time_policies_values_check',
  'attendance_time_policies_site_fkey', 'attendance_time_policies_shift_type_fkey', 'attendance_time_policies_created_by_fkey',
  'attendance_events_punctuality_check', 'attendance_events_checkout_condition_check'
]);
function assert(value, message) { if (!value) throw new Error(message); }
function sourceMigrations(root = process.cwd()) {
  const dir = path.join(root, 'prisma/migrations');
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => ({
    name: entry.name,
    checksum: crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, entry.name, 'migration.sql'))).digest('hex')
  })).sort((a, b) => a.name.localeCompare(b.name));
}
function classifyHistory(rows, source) {
  const byName = new Map(source.map((migration) => [migration.name, migration]));
  const groups = new Map();
  for (const row of rows) {
    if (!byName.has(row.migration_name)) return { state: 'HISTORY_DIVERGED' };
    if (row.checksum !== byName.get(row.migration_name).checksum) return { state: 'HISTORY_DIVERGED' };
    if (!row.finished_at && !row.rolled_back_at) return { state: 'PARTIAL_OR_FAILED' };
    if (row.finished_at && row.rolled_back_at) return { state: 'HISTORY_DIVERGED' };
    const group = groups.get(row.migration_name) || [];
    group.push(row); groups.set(row.migration_name, group);
  }
  for (const group of groups.values()) {
    if (group.filter((row) => row.finished_at && !row.rolled_back_at).length !== 1) return { state: 'HISTORY_DIVERGED' };
  }
  const pending = source.filter((migration) => !groups.has(migration.name)).map((migration) => migration.name);
  if (!pending.length) return { state: 'BOTH_ALREADY_APPLIED_AND_VALID', pending };
  if (pending.join(',') === [PREDECESSOR, TARGET].join(',')) return { state: 'EXACTLY_PENDING_001_THEN_002', pending };
  if (pending.join(',') === TARGET) return { state: '001_APPLIED_002_PENDING', pending };
  return { state: 'HISTORY_DIVERGED' };
}
async function columns(db) {
  return db.$queryRawUnsafe(`SELECT c.relname AS table_name, a.attname AS column_name, t.typname AS udt_name,
    a.attnotnull, a.atttypmod
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid
    WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    AND c.relname IN ('attendance_time_policies','attendance_events','attendance_pending_events','attendance_device_enrollments')`);
}
function policyShape(rows) {
  const relevant = rows.filter((row) => Object.hasOwn(REQUIRED_COLUMNS[row.table_name] || {}, row.column_name));
  if (!relevant.length) return 'ABSENT';
  const expectedCount = Object.values(REQUIRED_COLUMNS).reduce((sum, fields) => sum + Object.keys(fields).length, 0);
  const valid = relevant.length === expectedCount && relevant.every((row) => {
    if (row.udt_name !== REQUIRED_COLUMNS[row.table_name][row.column_name]) return false;
    if (row.table_name === 'attendance_time_policies') {
      const nullable = ['site_id', 'shift_type_id'].includes(row.column_name);
      if (row.attnotnull !== !nullable) return false;
      if (['effective_from', 'created_at'].includes(row.column_name) && ![-1, 6].includes(row.atttypmod)) return false;
    }
    return true;
  });
  return valid ? 'PRESENT' : 'PARTIAL';
}
async function verifyPolicySchema(db) {
  assert(policyShape(await columns(db)) === 'PRESENT', 'TIME_POLICY_COLUMN_SHAPE_FAILED');
  const indexes = await db.$queryRawUnsafe(`SELECT c.relname, i.indisvalid, i.indisready, i.indisunique,
    pg_get_expr(i.indpred,i.indrelid) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relname LIKE 'attendance_time_policies_%'`);
  assert(INDEXES.every((name) => indexes.some((row) => row.relname === name && row.indisvalid && row.indisready)), 'TIME_POLICY_INDEX_FAILED');
  assert(INDEXES.filter((name) => name.endsWith('_key')).every((name) => indexes.some((row) => row.relname === name && row.indisunique && row.predicate)), 'TIME_POLICY_UNIQUE_SCOPE_INDEX_FAILED');
  const constraints = await db.$queryRawUnsafe(`SELECT conname, convalidated FROM pg_constraint
    WHERE connamespace='public'::regnamespace AND (conrelid='public.attendance_time_policies'::regclass
    OR conname IN ('attendance_events_punctuality_check','attendance_events_checkout_condition_check'))`);
  assert(CONSTRAINTS.every((name) => constraints.some((row) => row.conname === name && row.convalidated)), 'TIME_POLICY_CONSTRAINT_FAILED');
  const security = await db.$queryRawUnsafe(`SELECT c.relrowsecurity,
    (SELECT COUNT(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='attendance_time_policies') AS policies
    FROM pg_class c WHERE c.oid='public.attendance_time_policies'::regclass`);
  assert(security.length === 1 && security[0].relrowsecurity && security[0].policies === 0, 'TIME_POLICY_RLS_FAILED');
  const grants = await db.$queryRawUnsafe(`SELECT r.rolname,
    has_table_privilege(r.oid,'public.attendance_time_policies','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS privilege
    FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')`);
  assert(grants.length === 2 && grants.every((row) => !row.privilege), 'TIME_POLICY_BROWSER_REVOKE_FAILED');
  return true;
}
async function inspect({ prisma, root = process.cwd(), log = console.log, post = false } = {}) {
  const { PrismaClient } = require('@prisma/client');
  const client = prisma || new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try {
    return await client.$transaction(async (db) => {
      await db.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const rows = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations');
      const result = classifyHistory(rows, sourceMigrations(root));
      log('PRODUCTION_MIGRATION_CLASS=' + result.state);
      assert(!['HISTORY_DIVERGED','PARTIAL_OR_FAILED'].includes(result.state), 'PRODUCTION_HISTORY_FAIL_CLOSED');
      const schemaColumns = await columns(db);
      const tables = await db.$queryRawUnsafe("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('attendance_pending_events','attendance_time_policies')");
      const shape = policyShape(schemaColumns);
      if (result.pending?.includes(PREDECESSOR)) {
        const present = tables.some((row) => row.relname === 'attendance_pending_events') || schemaColumns.some((row) => row.table_name === 'attendance_pending_events'
          || (row.table_name === 'attendance_device_enrollments' && row.column_name === 'observation_only')
          || (row.table_name === 'attendance_events' && ['device_enrollment_id','source_mode','device_captured_at','review_required','review_reasons'].includes(row.column_name)));
        assert(!present, 'PREDECESSOR_PARTIAL_OR_HISTORY_MISSING');
        log('PREDECESSOR_SCHEMA=ABSENT');
      } else {
        await require('./verify-g06-simple-attendance-production-migration').verify({ prisma: db, log });
        const pk = await db.$queryRawUnsafe("SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='attendance_pending_events_pkey' AND contype='p' AND convalidated");
        assert(pk.length === 1, 'PREDECESSOR_PRIMARY_KEY_FAILED');
        log('PREDECESSOR_SCHEMA=VALID');
      }
      if (result.pending?.includes(TARGET)) {
        assert(shape === 'ABSENT' && !tables.some((row) => row.relname === 'attendance_time_policies'), 'TARGET_PARTIAL_OR_HISTORY_MISSING');
        log('TARGET_SCHEMA=ABSENT');
      } else {
        await verifyPolicySchema(db);
        log('TARGET_SCHEMA=VALID');
        for (const name of [PREDECESSOR, TARGET]) assert(rows.filter((row) => row.migration_name === name && row.finished_at && !row.rolled_back_at).length === 1, 'TARGET_COMPLETION_COUNT_FAILED');
      }
      if (post) assert(result.state === 'BOTH_ALREADY_APPLIED_AND_VALID', 'POST_MIGRATION_STATE_FAILED');
      log('RAW_BUSINESS_ROWS_READ=NO');
      log('RAW_DATABASE_VALUES_EMITTED=NO');
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'apply_needed=' + Boolean(result.pending?.length) + '\n');
      return result;
    }, { timeout: 60000 });
  } finally { if (!prisma) await client.$disconnect(); }
}
if (require.main === module) inspect({ post: process.argv.includes('--post') }).catch(() => {
  process.stderr.write('PRODUCTION_MIGRATION_INSPECTION=FAIL_CLOSED\n'); process.exitCode = 1;
});
module.exports = { PREDECESSOR, TARGET, REQUIRED_COLUMNS, INDEXES, CONSTRAINTS, sourceMigrations, classifyHistory, policyShape, verifyPolicySchema, columns, inspect };
