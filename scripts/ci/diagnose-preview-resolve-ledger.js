'use strict';

const { verifyPreviewMigrationTarget } = require('./verify-preview-migration-target');
const {
  RESOLVE_CHECKSUM,
  RESOLVE_TARGET,
  inspectSchema,
} = require('./verify-preview-resolve-state');

function normalizeDate(value) {
  return value ? new Date(value).toISOString() : null;
}

function classifyTargetRow(row) {
  if (row?.finished_at && !row?.rolled_back_at) return 'APPLIED';
  if (row?.rolled_back_at) return 'ROLLED_BACK';
  if (row && !row.finished_at && !row.rolled_back_at) return 'FAILED';
  return 'OTHER';
}

function normalizeTargetRow(row) {
  return {
    id: String(row?.id || ''),
    migration_name: String(row?.migration_name || ''),
    checksum: String(row?.checksum || ''),
    started_at: normalizeDate(row?.started_at),
    finished_at: normalizeDate(row?.finished_at),
    rolled_back_at: normalizeDate(row?.rolled_back_at),
    applied_steps_count: Number(row?.applied_steps_count ?? 0),
    logs_present: Boolean(row?.logs_present),
  };
}

function summarizeTargetRows(rows) {
  const normalized = (rows || []).map(normalizeTargetRow);
  const states = normalized.map(classifyTargetRow);
  return {
    rows: normalized,
    rowCount: normalized.length,
    applied: states.filter((state) => state === 'APPLIED').length,
    failed: states.filter((state) => state === 'FAILED').length,
    rolledBack: states.filter((state) => state === 'ROLLED_BACK').length,
    validApplied: normalized.some((row) => classifyTargetRow(row) === 'APPLIED'
      && row.checksum === RESOLVE_CHECKSUM),
  };
}

async function queryLedger(prisma) {
  return prisma.$queryRawUnsafe(`
    SELECT id::text AS id, migration_name, checksum, started_at, finished_at,
           rolled_back_at, applied_steps_count, (logs IS NOT NULL) AS logs_present
    FROM "_prisma_migrations"
    WHERE migration_name = '${RESOLVE_TARGET}'
    ORDER BY started_at ASC NULLS FIRST, id ASC
  `);
}

async function main({ log = console.log, error = console.error } = {}) {
  let prisma;
  try {
    verifyPreviewMigrationTarget({ env: process.env, log });
    log('PRODUCTION_TARGET_REJECT_GUARD=PASS');

    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    const targetRows = await queryLedger(prisma);
    const summary = summarizeTargetRows(targetRows);
    const inventory = await inspectSchema(prisma);

    log(`TARGET_LEDGER_ROW_COUNT=${summary.rowCount}`);
    summary.rows.forEach((row, index) => {
      const n = index + 1;
      log(`ROW_${n}_ID=${row.id}`);
      log(`ROW_${n}_CHECKSUM_MATCH=${row.checksum === RESOLVE_CHECKSUM ? 'YES' : 'NO'}`);
      log(`ROW_${n}_FINISHED=${row.finished_at ? 'YES' : 'NO'}`);
      log(`ROW_${n}_ROLLED_BACK=${row.rolled_back_at ? 'YES' : 'NO'}`);
      log(`ROW_${n}_APPLIED_STEPS=${row.applied_steps_count}`);
      log(`ROW_${n}_LOGS_PRESENT=${row.logs_present ? 'YES' : 'NO'}`);
      log(`ROW_${n}_STATE=${classifyTargetRow(row)}`);
    });
    log(`APPLIED_TARGET_ROW_COUNT=${summary.applied}`);
    log(`FAILED_TARGET_ROW_COUNT=${summary.failed}`);
    log(`ROLLED_BACK_TARGET_ROW_COUNT=${summary.rolledBack}`);
    log(`VALID_APPLIED_TARGET_ROW=${summary.validApplied ? 'YES' : 'NO'}`);
    log(`EXPECTED_MIGRATION_OBJECT_COUNT=${inventory.expected}`);
    log(`MATCHING_OBJECT_COUNT=${inventory.matching}`);
    log(`DIFFERING_OBJECT_COUNT=${inventory.differing}`);
    log(`MISSING_OBJECT_COUNT=${inventory.missing}`);
    log('SCHEMA_EQUIVALENCE=' + (inventory.exact ? 'PASS' : 'FAIL'));
    log('NON_TARGET_LEDGER_ROWS_CHANGED=NOT_PROVABLE_WITHOUT_PRE_RESOLVE_ROW_SNAPSHOT');
    log('RAW_DATABASE_OUTPUT_EMITTED=false');
    return 0;
  } catch (reason) {
    error(`Preview resolve ledger diagnosis failed: ${reason.message}`);
    return 1;
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  classifyTargetRow,
  normalizeTargetRow,
  summarizeTargetRows,
};
