'use strict';

const { Prisma, PrismaClient } = require('@prisma/client');

const EXPECTED_SETTINGS = Object.freeze(new Map([
  ['RETENTION.OPERATIONAL_USAGE.MONTHS', '6'],
  ['RETENTION.ATTENDANCE_RAW.MONTHS', '12'],
  ['RETENTION.PATROL_RAW.MONTHS', '3'],
  ['RETENTION.TIMEZONE', 'Asia/Bangkok']
]));
const TABLES = Object.freeze(['retention_policy_changes', 'retention_cleanup_runs']);
const INDEXES = Object.freeze([
  'retention_policy_changes_one_scheduled_key',
  'retention_policy_changes_status_effective_idx',
  'retention_policy_changes_requester_requested_idx',
  'retention_cleanup_runs_started_status_idx',
  'retention_cleanup_runs_actor_started_idx'
]);

async function verify({ prisma = new PrismaClient(), log = console.log } = {}) {
  const ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    const settings = await prisma.systemSetting.findMany({
      where: { key: { in: [...EXPECTED_SETTINGS.keys()] } },
      select: { key: true, value: true }
    });
    if (settings.length !== EXPECTED_SETTINGS.size) throw new Error('CFG-07 retention policy key count mismatch');
    const byKey = new Map(settings.map((row) => [row.key, row.value]));
    for (const [key, expected] of EXPECTED_SETTINGS) {
      if (byKey.get(key) !== expected) throw new Error('CFG-07 retention policy default mismatch');
    }

    const tables = await prisma.$queryRaw(Prisma.sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname='public' AND tablename IN (${Prisma.join(TABLES)})
    `);
    if (tables.length !== TABLES.length) throw new Error('CFG-07 governance table count mismatch');

    const rls = await prisma.$queryRaw(Prisma.sql`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'
        AND c.relname IN (${Prisma.join(TABLES)})
        AND c.relrowsecurity = true
    `);
    if (rls.length !== TABLES.length) throw new Error('CFG-07 RLS invariant mismatch');

    const indexes = await prisma.$queryRaw(Prisma.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname='public' AND indexname IN (${Prisma.join(INDEXES)})
    `);
    if (indexes.length !== INDEXES.length) throw new Error('CFG-07 governance index count mismatch');

    const scheduledUnique = await prisma.$queryRaw(Prisma.sql`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname='public' AND indexname='retention_policy_changes_one_scheduled_key'
    `);
    if (scheduledUnique.length !== 1 || !/UNIQUE/i.test(scheduledUnique[0].indexdef || '') || !/status.*SCHEDULED/i.test(scheduledUnique[0].indexdef || '')) {
      throw new Error('CFG-07 one-scheduled-change uniqueness invariant mismatch');
    }

    log('CFG07_PRODUCTION_MIGRATION_VERIFY=PASS');
    log('RETENTION_POLICY_KEY_COUNT=4');
    log('RETENTION_GOVERNANCE_TABLE_COUNT=2');
    log('RETENTION_GOVERNANCE_INDEX_COUNT=5');
    log('RETENTION_RLS_TABLE_COUNT=2');
    log('RETENTION_POLICY_DEFAULTS_VERIFIED=true');
    log('RETENTION_RAW_VALUES_EMITTED=false');
    return true;
  } finally {
    if (ownsClient) await prisma.$disconnect();
  }
}

if (require.main === module) {
  verify().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_SETTINGS, TABLES, INDEXES, verify };
