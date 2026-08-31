'use strict';

const { PrismaClient } = require('@prisma/client');

async function verify({ prisma = new PrismaClient(), log = console.log } = {}) {
  let ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    const table = await prisma.$queryRawUnsafe("SELECT to_regclass('public.leave_type_master')::text AS name");
    if (!table?.[0]?.name) throw new Error('leave_type_master table missing');

    const columns = await prisma.$queryRawUnsafe(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='leave_requests' AND column_name IN ('leave_type_id','leave_type_name_snapshot','leave_quota_bucket_snapshot') ORDER BY column_name"
    );
    const columnNames = new Set(columns.map((row) => row.column_name));
    for (const name of ['leave_type_id', 'leave_type_name_snapshot', 'leave_quota_bucket_snapshot']) {
      if (!columnNames.has(name)) throw new Error(`leave_requests column missing: ${name}`);
    }

    const core = await prisma.$queryRawUnsafe(
      "SELECT code, name, quota_bucket, is_active, is_system FROM leave_type_master WHERE code IN ('SICK','PERSONAL','VACATION') ORDER BY code"
    );
    const expected = new Map([
      ['SICK', ['ลาป่วย', 'SICK']],
      ['PERSONAL', ['ลากิจ', 'PERSONAL']],
      ['VACATION', ['ลาพักร้อน', 'VACATION']]
    ]);
    if (core.length !== 3) throw new Error('core Leave Type rows missing');
    for (const row of core) {
      const rule = expected.get(row.code);
      if (!rule || row.name !== rule[0] || row.quota_bucket !== rule[1] || row.is_active !== true || row.is_system !== true) {
        throw new Error(`core Leave Type mismatch: ${row.code}`);
      }
    }

    const missingNames = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*)::int AS count FROM leave_requests WHERE leave_type_name_snapshot IS NULL'
    );
    if (Number(missingNames?.[0]?.count || 0) !== 0) throw new Error('leave type name snapshot backfill incomplete');

    const coreMismatch = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
         FROM leave_requests
        WHERE (
          (upper(trim(leave_type)) = 'SICK' OR leave_type ILIKE '%ป่วย%')
          AND (leave_quota_bucket_snapshot IS DISTINCT FROM 'SICK' OR leave_type_id IS NULL)
        ) OR (
          (upper(trim(leave_type)) = 'PERSONAL' OR leave_type ILIKE '%กิจ%')
          AND (leave_quota_bucket_snapshot IS DISTINCT FROM 'PERSONAL' OR leave_type_id IS NULL)
        ) OR (
          (upper(trim(leave_type)) = 'VACATION' OR leave_type ILIKE '%พักร้อน%')
          AND (leave_quota_bucket_snapshot IS DISTINCT FROM 'VACATION' OR leave_type_id IS NULL)
        )`
    );
    if (Number(coreMismatch?.[0]?.count || 0) !== 0) throw new Error('recognized legacy Leave Type backfill mismatch');

    const constraints = await prisma.$queryRawUnsafe(
      "SELECT conname FROM pg_constraint WHERE conname='leave_requests_leave_type_id_fkey'"
    );
    if (constraints.length !== 1) throw new Error('leave type foreign key missing');

    const indexes = await prisma.$queryRawUnsafe(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('leave_type_master_code_key','leave_type_master_is_active_sort_order_idx','leave_requests_leave_type_id_idx')"
    );
    const indexNames = new Set(indexes.map((row) => row.indexname));
    for (const index of ['leave_type_master_code_key', 'leave_type_master_is_active_sort_order_idx', 'leave_requests_leave_type_id_idx']) {
      if (!indexNames.has(index)) throw new Error(`migration index missing: ${index}`);
    }

    log('CFG03_PRODUCTION_MIGRATION_VERIFY=PASS');
    log('LEAVE_TYPE_MASTER_TABLE=PASS');
    log('LEAVE_REQUEST_SNAPSHOT_COLUMNS=PASS');
    log('CORE_LEAVE_TYPES_THAI=PASS');
    log('HISTORICAL_NAME_BACKFILL=PASS');
    log('CORE_BUCKET_BACKFILL=PASS');
    log('FK_AND_INDEXES=PASS');
    log('RAW_LEAVE_DATA_EMITTED=false');
    return true;
  } finally {
    if (ownsClient) await prisma.$disconnect();
  }
}

if (require.main === module) {
  verify().catch((error) => {
    console.error(`CFG03 production migration verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { verify };
