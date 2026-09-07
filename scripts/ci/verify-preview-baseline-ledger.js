'use strict';

const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { BASELINE_ALLOWLIST, verifyManifest } = require('./verify-preview-baseline-manifest');

// Prisma migration checksums are computed from the repository migration text as
// checked out on Linux. Keep these equal to the manifest's canonical UTF-8/LF
// SHA-256 values so Windows CRLF worktrees cannot create a false ledger mismatch.
const CHECKSUMS = Object.freeze({
  '202608240004_g06_attendance_event_workflow_v1': 'effed21604b8ab3a3fb57b66cf11446ad7317615cd0c1d7b1cdf8ea8e4fcae43',
  '202608250001_g06_face_match_only_mode_v1': '94051667829738c69bed5d92feddf6e5026d2c1ab13d0e9e89ea7ccb14b08eb1',
  '202608250002_g06_department_security_site_default_v1': '1942f60184fe350232f4c5214d8a8b751e6c09c99afc823aba81a925a869c0e3',
  '202608250003_attendance_governance_v1': '3351ac5d74511b7f705d9c0be0efc28c5aeb93ec0efa3f2c167de315cd283a09',
  '202608270001_attendance_adjustment_request_v4': '4f1bfd5a28a1d53becf7757cd3fb47546921e7911949d10060c7371af696e293',
  '202608270002_attendance_effective_correction_authority_v4': '5df43d763eac119792da29212c2c3b35bc3c6fc6cfaf4ceff5f102c691b56417',
  '202608270003_attendance_face_evidence_v1': '17cb59dd7976588e9302f299d0b2980b1417ba0ec4e250d5bf8af73675ce026f',
  '202608270004_attendance_face_evidence_rls_v1': '8e67c414bd71d4ad4ca898dfd10850712f39278629cc76ce1f14bb7b1a35c89d',
  '202608270005_g06_server_authority_rls_v1': '275029fe268af811380c2c2ce7285686aae9784aca9f19d564b2bc3a0bb16739',
  '202608270005_g06_server_only_rls_v1': 'dd177be158d82b37f0d14bd87911ffce2d555290ad037b5c34b1d90846ab02bb',
});

function queryRaw(prisma, sql) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') {
    throw new Error('Prisma read-only query capability is unavailable');
  }
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
    if (matching.some((row) => validApplied(row, name))) {
      throw new Error(`allowlisted migration already applied: ${name}`);
    }
    if (matching.some((row) => row.checksum !== CHECKSUMS[name])) {
      throw new Error(`allowlisted migration checksum mismatch in ledger: ${name}`);
    }
    if (matching.some((row) => failedUnrolled(row) && row.applied_steps_count !== 0)) {
      throw new Error(`allowlisted migration has partial failed steps: ${name}`);
    }
  }
  log('BASELINE_LEDGER_PRECHECK=PASS');
  log('ALLOWLIST_FAILED_ROWS_HAVE_ZERO_APPLIED_STEPS=YES');
  return true;
}

function postcondition(beforeRows, afterRows, log = console.log) {
  const before = new Map(beforeRows.map((row) => [row.id, row]));
  const after = new Map(afterRows.map((row) => [row.id, row]));

  for (const [id, row] of before) {
    const now = after.get(id);
    if (!now) {
      if (!BASELINE_ALLOWLIST.includes(row.migration_name)) {
        throw new Error(`non-target ledger row disappeared: ${row.migration_name}`);
      }
      continue;
    }
    if (!BASELINE_ALLOWLIST.includes(row.migration_name)
      && JSON.stringify(row) !== JSON.stringify(now)) {
      throw new Error(`non-target ledger row changed: ${row.migration_name}`);
    }
  }

  for (const row of afterRows) {
    if (BASELINE_ALLOWLIST.includes(row.migration_name)) continue;
    const previous = before.get(row.id);
    if (!previous) throw new Error(`new non-target ledger row appeared: ${row.migration_name}`);
  }

  for (const name of BASELINE_ALLOWLIST) {
    const matching = afterRows.filter((row) => row.migration_name === name);
    if (!matching.some((row) => validApplied(row, name))) {
      throw new Error(`allowlisted migration is not applied after reconciliation: ${name}`);
    }
    if (matching.some(failedUnrolled)) {
      throw new Error(`allowlisted migration remains failed after reconciliation: ${name}`);
    }
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
      if (snapshotPath) {
        fs.writeFileSync(snapshotPath, JSON.stringify(rows, null, 2), { encoding: 'utf8', flag: 'wx' });
      }
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
