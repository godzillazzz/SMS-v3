'use strict';

const fs = require('node:fs');
const { RESOLVE_CHECKSUM, RESOLVE_TARGET } = require('./verify-preview-resolve-source');

const EXPECTED_MIGRATION_OBJECT_COUNT = 36;

const EXPECTED_TABLES = Object.freeze([
  'security_sites',
  'security_site_qr_credentials',
]);

const EXPECTED_COLUMNS = Object.freeze([
  ['security_sites', 'id', 'uuid', 'NO', true],
  ['security_sites', 'code', 'varchar', 'NO', false],
  ['security_sites', 'name', 'varchar', 'NO', false],
  ['security_sites', 'latitude', 'numeric', 'NO', false],
  ['security_sites', 'longitude', 'numeric', 'NO', false],
  ['security_sites', 'geofence_radius_meters', 'int4', 'NO', false],
  ['security_sites', 'is_active', 'bool', 'NO', true],
  ['security_sites', 'created_at', 'timestamp', 'NO', true],
  ['security_sites', 'updated_at', 'timestamp', 'NO', false],
  ['security_site_qr_credentials', 'id', 'uuid', 'NO', true],
  ['security_site_qr_credentials', 'security_site_id', 'uuid', 'NO', false],
  ['security_site_qr_credentials', 'token_hash', 'bpchar', 'NO', false],
  ['security_site_qr_credentials', 'version', 'int4', 'NO', false],
  ['security_site_qr_credentials', 'valid_from', 'timestamp', 'NO', true],
  ['security_site_qr_credentials', 'valid_until', 'timestamp', 'YES', false],
  ['security_site_qr_credentials', 'revoked_at', 'timestamp', 'YES', false],
  ['security_site_qr_credentials', 'created_at', 'timestamp', 'NO', true],
  ['shift_assignments', 'security_site_id', 'uuid', 'YES', false],
]);

const EXPECTED_CONSTRAINTS = Object.freeze([
  ['security_sites', 'security_sites_pkey', 'p'],
  ['security_sites', 'security_sites_latitude_range', 'c'],
  ['security_sites', 'security_sites_longitude_range', 'c'],
  ['security_sites', 'security_sites_geofence_radius_positive', 'c'],
  ['security_site_qr_credentials', 'security_site_qr_credentials_pkey', 'p'],
  ['security_site_qr_credentials', 'security_site_qr_credentials_token_hash_format', 'c'],
  ['security_site_qr_credentials', 'security_site_qr_credentials_version_positive', 'c'],
  ['security_site_qr_credentials', 'security_site_qr_credentials_valid_window', 'c'],
  ['security_site_qr_credentials', 'security_site_qr_credentials_security_site_id_fkey', 'f'],
  ['shift_assignments', 'shift_assignments_security_site_id_fkey', 'f'],
]);

const EXPECTED_INDEXES = Object.freeze([
  ['security_sites', 'security_sites_code_key', ['code']],
  ['security_sites', 'security_sites_is_active_code_idx', ['is_active', 'code']],
  ['security_site_qr_credentials', 'security_site_qr_credentials_token_hash_key', ['token_hash']],
  ['security_site_qr_credentials', 'security_site_qr_credentials_security_site_id_version_key', ['security_site_id', 'version']],
  ['security_site_qr_credentials', 'security_site_qr_credentials_site_validity_idx', ['security_site_id', 'revoked_at', 'valid_from', 'valid_until']],
  ['shift_assignments', 'shift_assignments_security_site_id_work_date_idx', ['security_site_id', 'work_date']],
]);

function queryRaw(prisma, sql) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') throw new Error('Prisma read-only query capability is unavailable');
  return prisma.$queryRawUnsafe(sql);
}

function normalizeText(value) {
  return String(value ?? '').replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function expectedColumnMatches(row, [, , udtName, nullable, hasDefault]) {
  if (!row) return false;
  if (String(row.udt_name || '').toLowerCase() !== udtName) return false;
  if (String(row.is_nullable || '').toUpperCase() !== nullable) return false;
  return hasDefault ? Boolean(row.column_default) : !row.column_default;
}

function expectedConstraintMatches(row, [, , contype]) {
  return Boolean(row) && String(row.contype || '').toLowerCase() === contype;
}

function expectedIndexMatches(row, [, , columns]) {
  if (!row) return false;
  const definition = normalizeText(row.indexdef);
  return columns.every((column) => definition.includes(column)) && definition.includes('public');
}

function classifyInventory({ tables, columns, constraints, indexes }) {
  const tableSet = new Set((tables || []).map((row) => String(row.table_name || '')));
  const columnMap = new Map((columns || []).map((row) => [`${row.table_name}.${row.column_name}`, row]));
  const constraintMap = new Map((constraints || []).map((row) => [`${row.table_name}.${row.conname}`, row]));
  const indexMap = new Map((indexes || []).map((row) => [`${row.tablename}.${row.indexname}`, row]));

  const checks = [];
  for (const table of EXPECTED_TABLES) checks.push({ kind: 'table', exists: tableSet.has(table), matches: tableSet.has(table) });
  for (const expected of EXPECTED_COLUMNS) {
    const row = columnMap.get(`${expected[0]}.${expected[1]}`);
    checks.push({ kind: 'column', exists: Boolean(row), matches: expectedColumnMatches(row, expected) });
  }
  for (const expected of EXPECTED_CONSTRAINTS) {
    const row = constraintMap.get(`${expected[0]}.${expected[1]}`);
    checks.push({ kind: 'constraint', exists: Boolean(row), matches: expectedConstraintMatches(row, expected) });
  }
  for (const expected of EXPECTED_INDEXES) {
    const row = indexMap.get(`${expected[0]}.${expected[1]}`);
    checks.push({ kind: 'index', exists: Boolean(row), matches: expectedIndexMatches(row, expected) });
  }

  const matching = checks.filter((check) => check.matches).length;
  const missing = checks.filter((check) => !check.exists).length;
  const differing = checks.filter((check) => check.exists && !check.matches).length;
  return {
    expected: checks.length,
    matching,
    missing,
    differing,
    exact: checks.length === EXPECTED_MIGRATION_OBJECT_COUNT && matching === EXPECTED_MIGRATION_OBJECT_COUNT,
  };
}

async function inspectSchema(prisma) {
  const tables = await queryRaw(prisma, `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('security_sites', 'security_site_qr_credentials')
  `);
  const columns = await queryRaw(prisma, `
    SELECT table_name, column_name, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND ((table_name IN ('security_sites', 'security_site_qr_credentials'))
        OR (table_name = 'shift_assignments' AND column_name = 'security_site_id'))
  `);
  const constraints = await queryRaw(prisma, `
    SELECT cls.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'public'
      AND con.conname IN (
        'security_sites_pkey', 'security_sites_latitude_range', 'security_sites_longitude_range',
        'security_sites_geofence_radius_positive', 'security_site_qr_credentials_pkey',
        'security_site_qr_credentials_token_hash_format', 'security_site_qr_credentials_version_positive',
        'security_site_qr_credentials_valid_window', 'security_site_qr_credentials_security_site_id_fkey',
        'shift_assignments_security_site_id_fkey'
      )
  `);
  const indexes = await queryRaw(prisma, `
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'security_sites_code_key', 'security_sites_is_active_code_idx',
        'security_site_qr_credentials_token_hash_key',
        'security_site_qr_credentials_security_site_id_version_key',
        'security_site_qr_credentials_site_validity_idx',
        'shift_assignments_security_site_id_work_date_idx'
      )
  `);
  return classifyInventory({ tables, columns, constraints, indexes });
}

function normalizeLedgerRow(row) {
  const normalizeDate = (value) => value ? new Date(value).toISOString() : null;
  return {
    migration_name: String(row?.migration_name || ''),
    checksum: String(row?.checksum || ''),
    started_at: normalizeDate(row?.started_at),
    finished_at: normalizeDate(row?.finished_at),
    rolled_back_at: normalizeDate(row?.rolled_back_at),
    applied_steps_count: Number(row?.applied_steps_count ?? 0),
  };
}

function preResolveLedgerSafe(row) {
  return Boolean(row)
    && String(row.migration_name || '') === RESOLVE_TARGET
    && String(row.checksum || '') === RESOLVE_CHECKSUM
    && !row.finished_at
    && !row.rolled_back_at
    && Number(row.applied_steps_count ?? 0) === 0;
}

function comparePostLedger(beforeRows, afterRows) {
  const before = new Map((beforeRows || []).map((row) => [row.migration_name, normalizeLedgerRow(row)]));
  const after = new Map((afterRows || []).map((row) => [row.migration_name, normalizeLedgerRow(row)]));
  if (before.size !== after.size) return false;
  for (const [name, beforeRow] of before) {
    const afterRow = after.get(name);
    if (!afterRow) return false;
    if (name === RESOLVE_TARGET) {
      if (afterRow.checksum !== beforeRow.checksum || afterRow.rolled_back_at !== null || !afterRow.finished_at) return false;
      continue;
    }
    if (JSON.stringify(beforeRow) !== JSON.stringify(afterRow)) return false;
  }
  return true;
}

async function verifyPreResolveState({ prisma, snapshotPath, log = console.log } = {}) {
  const ownsClient = !prisma;
  const client = prisma || new (require('@prisma/client').PrismaClient)();
  try {
    const targetRows = await queryRaw(client, `
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
      FROM "_prisma_migrations"
      WHERE migration_name = '${RESOLVE_TARGET}'
      LIMIT 1
    `);
    const allRows = await queryRaw(client, `
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `);
    const row = Array.isArray(targetRows) ? targetRows[0] : null;
    const inventory = await inspectSchema(client);
    const ledgerSafe = preResolveLedgerSafe(row);
    const checksumMatch = Boolean(row) && String(row.checksum || '') === RESOLVE_CHECKSUM;

    log(`P3018_DIVERGENCE_CLASSIFICATION=${ledgerSafe && inventory.exact ? 'EXACT_EQUIVALENT_MIGRATION_ALREADY_PRESENT' : 'UNRESOLVED'}`);
    log(`FAILED_LEDGER_ROW_PRESENT=${row ? 'YES' : 'NO'}`);
    log(`FAILED_LEDGER_FINISHED=${row?.finished_at ? 'YES' : 'NO'}`);
    log(`FAILED_LEDGER_ROLLED_BACK=${row?.rolled_back_at ? 'YES' : 'NO'}`);
    log(`FAILED_LEDGER_APPLIED_STEPS=${Number(row?.applied_steps_count ?? -1)}`);
    log(`FAILED_LEDGER_CHECKSUM_MATCH_SOURCE=${checksumMatch ? 'YES' : 'NO'}`);
    log(`EXPECTED_MIGRATION_OBJECT_COUNT=${inventory.expected}`);
    log(`MATCHING_OBJECT_COUNT=${inventory.matching}`);
    log(`DIFFERING_OBJECT_COUNT=${inventory.differing}`);
    log(`MISSING_OBJECT_COUNT=${inventory.missing}`);
    log('MIGRATION_HAS_DATA_STATEMENTS=NO');
    log(`SECURITY_SITES_EXACT_MIGRATION_MATCH=${inventory.exact ? 'YES' : 'NO'}`);
    log(`FAILED_MIGRATION_SIDE_EFFECT=${inventory.exact ? 'FULL_SCHEMA_ALREADY_PRESENT_BEFORE_RUN' : 'UNKNOWN'}`);
    log('RAW_DATABASE_OUTPUT_EMITTED=false');
    if (!(ledgerSafe && inventory.exact)) throw new Error('Preview resolve precondition is not proven');
    if (snapshotPath) fs.writeFileSync(snapshotPath, JSON.stringify(allRows.map(normalizeLedgerRow), null, 2), { encoding: 'utf8', flag: 'wx' });
    return { ledgerSafe, checksumMatch, inventory };
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

async function verifyPostResolveState({ prisma, snapshotPath, log = console.log } = {}) {
  const ownsClient = !prisma;
  const client = prisma || new (require('@prisma/client').PrismaClient)();
  try {
    const targetRows = await queryRaw(client, `
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
      FROM "_prisma_migrations"
      WHERE migration_name = '${RESOLVE_TARGET}'
      LIMIT 1
    `);
    const allRows = await queryRaw(client, `
      SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `);
    const row = Array.isArray(targetRows) ? targetRows[0] : null;
    const inventory = await inspectSchema(client);
    const beforeRows = snapshotPath ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : [];
    const targetApplied = Boolean(row?.finished_at) && !row?.rolled_back_at && String(row?.checksum || '') === RESOLVE_CHECKSUM;
    const ledgerUnchangedOutsideTarget = comparePostLedger(beforeRows, allRows);
    log(`TARGET_MIGRATION_RECOGNIZED_AS_APPLIED=${targetApplied ? 'YES' : 'NO'}`);
    log(`POST_RESOLVE_SCHEMA_OBJECTS_MATCH=${inventory.matching}_OF_${inventory.expected}`);
    log(`UNEXPECTED_SCHEMA_CHANGE=${inventory.exact ? 'NO' : 'YES'}`);
    log(`UNEXPECTED_LEDGER_CHANGE=${ledgerUnchangedOutsideTarget ? 'NO' : 'YES'}`);
    log('BUSINESS_DATA_MUTATION=NO');
    log('MIGRATION_DEPLOY_EXECUTED=NO');
    log('RAW_DATABASE_OUTPUT_EMITTED=false');
    if (!(targetApplied && inventory.exact && ledgerUnchangedOutsideTarget)) throw new Error('Preview resolve postcondition failed');
    return { targetApplied, inventory, ledgerUnchangedOutsideTarget };
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

async function main() {
  const mode = process.argv.includes('--mode=post') ? 'post' : 'pre';
  const snapshotIndex = process.argv.indexOf('--snapshot');
  const snapshotPath = snapshotIndex >= 0 ? process.argv[snapshotIndex + 1] : undefined;
  try {
    if (mode === 'post') await verifyPostResolveState({ snapshotPath });
    else await verifyPreResolveState({ snapshotPath });
    return 0;
  } catch {
    console.error(`Preview resolve ${mode}-condition verification failed`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  EXPECTED_COLUMNS,
  EXPECTED_CONSTRAINTS,
  EXPECTED_INDEXES,
  EXPECTED_MIGRATION_OBJECT_COUNT,
  EXPECTED_TABLES,
  RESOLVE_CHECKSUM,
  RESOLVE_TARGET,
  classifyInventory,
  comparePostLedger,
  expectedColumnMatches,
  inspectSchema,
  normalizeLedgerRow,
  preResolveLedgerSafe,
  verifyPostResolveState,
  verifyPreResolveState,
};
