'use strict';

const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { BASELINE_ALLOWLIST } = require('./verify-preview-baseline-manifest');

const { verifyManifest } = require('./verify-preview-baseline-manifest');

const CHECKSUMS = Object.freeze({
  '202608250001_g06_face_match_only_mode_v1': '179ac2a0948e6b051eefbf1517d1eb67a859cd3eb66a928d594c9d74a53b446c',
  '202608250002_g06_department_security_site_default_v1': '2d823908570e1dde4858c39a8eacfeccfba7fedeb59a768d8e20de9c343eb25d',
  '202608250003_attendance_governance_v1': '10044a4bc58cdb365a128074ddbe2ee55dc64714ae021b2ba2a766844e037b32',
  '202608270001_attendance_adjustment_request_v4': '11d97b373a0e3a126ab74019319277bac8e36a265332a0c19a7597e197708147',
  '202608270002_attendance_effective_correction_authority_v4': '8519cd9fd09e520310fe0eda405bcde8aa7b9c46be57cedaf8f209f51216d4fc',
  '202608270003_attendance_face_evidence_v1': '6627bdc0fdf61d0ecf4ec41c8531977e7cb205841fb41a2d60dbec26d7adf7d9',
  '202608270004_attendance_face_evidence_rls_v1': 'cbd8dc37183b252c448e243e802b068fe15c267d05a4fff3d3e2f2d6a03117d8',
  '202608270005_g06_server_authority_rls_v1': '92df5dfa4e8130fc3f99a8003c2703d5104789d944fed641881d4919ae78148d',
  '202608270005_g06_server_only_rls_v1': '5620aa67b6d183425023df3f9f4ccce36f4a0f5d2c3090991840cf6b0ea307eb',
});

function queryRaw(prisma, sql) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') throw new Error('Prisma read-only query capability is unavailable');
  return prisma.$queryRawUnsafe(sql);
}

function normalizeRow(row) {
  const iso = (value) => (value ? new Date(value).toISOString() : null);
  return {
    id: String(row.id || ''),
    migration_name: String(row.migration_name || ''),
    checksum: String(row.checksum || ''),
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    rolled_back_at: iso(row.rolled_back_at),
    applied_steps_count: Number(row.applied_steps_count ?? 0),
  };
}

async function readRows(prisma) {
  const rows = await queryRaw(prisma, `
    SELECT id, migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
    FROM "_prisma_migrations"
    ORDER BY migration_name, started_at NULLS FIRST, id
  `);
  return rows.map(normalizeRow);
}

function validApplied(row, name) {
  return Boolean(row)
    && row.migration_name === name
    && row.checksum === CHECKSUMS[name]
    && Boolean(row.finished_at)
    && !row.rolled_back_at;
}

function failedUnrolled(row) {
  return Boolean(row) && !row.finished_at && !row.rolled_back_at;
}

function precondition(rows, log = console.log) {
  for (const name of BASELINE_ALLOWLIST) {
    const matching = rows.filter((row) => row.migration_name === name);
    if (matching.some((row) => validApplied(row, name))) throw new Error(`allowlisted migration already applied: ${name}`);
    if (matching.some((row) => row.checksum !== CHECKSUMS[name])) throw new Error(`allowlisted migration checksum mismatch in ledger: ${name}`);
    if (matching.some((row) => failedUnrolled(row) && row.applied_steps_count !== 0)) throw new Error(`allowlisted migration has partial failed steps: ${name}`);
  }
  log('BASELINE_LEDGER_PRECHECK=PASS');
}

function postcondition(beforeRows, afterRows, log = console.log) {
  const before = new Map(beforeRows.map((row) => [row.id, row]));
  const after = new Map(afterRows.map((row) => [row.id, row]));
  for (const [id, row] of before) {
    const now = after.get(id);
    if (!now) {
      if (!BASELINE_ALLOWLIST.includes(row.migration_name)) throw new Error(`non-target ledger row disappeared: ${row.migration_name}`);
      continue;
    }
    if (!BASELINE_ALLOWLIST.includes(row.migration_name) && JSON.stringify(row) !== JSON.stringify(now)) throw new Error(`non-target ledger row changed: ${row.migration_name}`);
  }
  for (const row of afterRows) {
    if (BASELINE_ALLOWLIST.includes(row.migration_name)) continue;
    const previous = before.get(row.id);
    if (!previous) throw new Error(`new non-target ledger row appeared: ${row.migration_name}`);
  }
  for (const name of BASELINE_ALLOWLIST) {
    const matching = afterRows.filter((row) => row.migration_name === name);
    if (!matching.some((row) => validApplied(row, name))) throw new Error(`allowlisted migration is not applied after reconciliation: ${name}`);
    if (matching.some(failedUnrolled)) throw new Error(`allowlisted migration remains failed after reconciliation: ${name}`);
  }
  log('UNEXPECTED_NON_TARGET_LEDGER_CHANGE=NO');
  log('BASELINE_LEDGER_POSTCHECK=PASS');
  log('BUSINESS_DATA_MUTATION=NO');
  log('MIGRATION_DEPLOY_EXECUTED=NO');
  return true;
}

async function verifyBaselineLedger({ prisma, mode = 'pre', snapshotPath, log = console.log } = {}) {
  const ownsClient = !prisma;
  const client = prisma || new PrismaClient();
  try {
    const rows = await readRows(client);
    if (mode === 'pre') {
      precondition(rows, log);
      if (snapshotPath) fs.writeFileSync(snapshotPath, JSON.stringify(rows, null, 2), { encoding: 'utf8', flag: 'wx' });
      return { rows };
    }
    if (!snapshotPath) throw new Error('post ledger verification requires a snapshot');
    const beforeRows = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    postcondition(beforeRows, rows, log);
    return { beforeRows, rows };
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

async function main() {
  const mode = process.argv.includes('--mode=post') ? 'post' : 'pre';
  const snapshotIndex = process.argv.indexOf('--snapshot');
  const snapshotPath = snapshotIndex >= 0 ? process.argv[snapshotIndex + 1] : undefined;
  try {
    verifyManifest();
    await verifyBaselineLedger({ mode, snapshotPath });
    return 0;
  } catch (error) {
    console.error(`Preview baseline ledger guard failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  BASELINE_ALLOWLIST,
  CHECKSUMS,
  failedUnrolled,
  normalizeRow,
  postcondition,
  precondition,
  readRows,
  validApplied,
  verifyBaselineLedger,
};
