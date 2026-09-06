'use strict';

const EXPECTED_MIGRATION_HEAD = '202609010002_mdg_master_codes_department_site_authority';
const REQUIRED_LEAVE_REQUEST_COLUMNS = Object.freeze([
  'leave_type_id',
  'leave_type_name_snapshot',
  'leave_quota_bucket_snapshot',
]);
const EXPECTED_APPROVAL_POLICY_KEY_COUNT = 26;

function queryRaw(prisma, sql) {
  if (typeof prisma.$queryRawUnsafe !== 'function') {
    throw new Error('Prisma read-only query capability is unavailable');
  }
  return prisma.$queryRawUnsafe(sql);
}

function migrationIsCurrent(rows, expectedHead) {
  return rows.some((row) =>
    String(row?.migration_name || '') === expectedHead &&
    Boolean(row?.finished_at) &&
    !row?.rolled_back_at
  );
}

async function verifyPreviewMigrationState({ prisma, expectedHead = EXPECTED_MIGRATION_HEAD, log = console.log } = {}) {
  const ownsClient = !prisma;
  let client = prisma;
  if (!client) {
    const { PrismaClient } = require('@prisma/client');
    client = new PrismaClient();
  }

  log('RAW_DATABASE_OUTPUT_EMITTED=false');
  log(`MIGRATION_HEAD=${expectedHead}`);
  try {
    if (expectedHead !== EXPECTED_MIGRATION_HEAD) throw new Error('Unexpected migration head');

    let migrationRows;
    try {
      migrationRows = await queryRaw(client, `
        SELECT migration_name, finished_at, rolled_back_at
        FROM "_prisma_migrations"
        WHERE migration_name = '${EXPECTED_MIGRATION_HEAD}'
        LIMIT 1
      `);
    } catch {
      log('PRISMA_MIGRATION_STATE=UNKNOWN');
      throw new Error('Preview migration ledger could not be read');
    }
    const migrationCurrent = migrationIsCurrent(Array.isArray(migrationRows) ? migrationRows : [], expectedHead);
    log(`PRISMA_MIGRATION_STATE=${migrationCurrent ? 'CURRENT' : 'NOT_CURRENT'}`);
    if (!migrationCurrent) throw new Error('Preview migration head is not current');

    let leaveColumns;
    try {
      const rows = await queryRaw(client, `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leave_requests'
          AND column_name IN ('leave_type_id', 'leave_type_name_snapshot', 'leave_quota_bucket_snapshot')
      `);
      leaveColumns = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.column_name || '')));
    } catch {
      leaveColumns = new Set();
    }
    const leaveCompatible = REQUIRED_LEAVE_REQUEST_COLUMNS.every((column) => leaveColumns.has(column));
    log(`LEAVE_REQUESTS_SCHEMA_COMPATIBILITY=${leaveCompatible ? 'PASS' : 'FAIL'}`);

    let autoScheduleCompatible = false;
    try {
      const rows = await queryRaw(client, "SELECT to_regclass('public.auto_schedule_patterns')::text AS name");
      autoScheduleCompatible = (Array.isArray(rows) ? rows : []).some((row) => {
        const name = String(row?.name || '');
        return name === 'auto_schedule_patterns' || name === 'public.auto_schedule_patterns';
      });
    } catch {
      autoScheduleCompatible = false;
    }
    log(`AUTO_SCHEDULE_SCHEMA_COMPATIBILITY=${autoScheduleCompatible ? 'PASS' : 'FAIL'}`);

    let approvalPolicyPresent = false;
    try {
      const rows = await queryRaw(client, `
        SELECT COUNT(*)::int AS count
        FROM "system_settings"
        WHERE "key" LIKE 'APPROVAL_POLICY.%'
      `);
      const count = Number(rows?.[0]?.count || 0);
      approvalPolicyPresent = count === EXPECTED_APPROVAL_POLICY_KEY_COUNT;
    } catch {
      approvalPolicyPresent = false;
    }
    log(`APPROVAL_POLICY_REFERENCE_DATA=${approvalPolicyPresent ? 'PRESENT' : 'ABSENT'}`);

    const schemaCompatible = leaveCompatible && autoScheduleCompatible;
    log(`SCHEMA_COMPATIBILITY=${schemaCompatible ? 'PASS' : 'FAIL'}`);
    if (!schemaCompatible) throw new Error('Preview migration schema compatibility check failed');
    if (!approvalPolicyPresent) throw new Error('Preview approval policy reference data is absent or incomplete');

    return {
      migrationState: 'CURRENT',
      migrationHead: expectedHead,
      leaveRequestsSchema: leaveCompatible,
      autoScheduleSchema: autoScheduleCompatible,
      approvalPolicyReferenceData: approvalPolicyPresent,
      schemaCompatible,
    };
  } catch (reason) {
    if (reason?.message === 'Unexpected migration head') throw reason;
    throw new Error('Preview migration compatibility verification failed');
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

async function main() {
  try {
    await verifyPreviewMigrationState();
    return 0;
  } catch {
    console.error('Preview migration compatibility verification failed');
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  EXPECTED_APPROVAL_POLICY_KEY_COUNT,
  EXPECTED_MIGRATION_HEAD,
  REQUIRED_LEAVE_REQUEST_COLUMNS,
  migrationIsCurrent,
  verifyPreviewMigrationState,
};
