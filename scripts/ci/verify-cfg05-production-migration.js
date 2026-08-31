'use strict';

const { PrismaClient } = require('@prisma/client');

const expectedCore = Object.freeze({
  SUPERVISOR: Object.freeze({
    mode: 'WEEKLY',
    targetGroup: 'SUPERVISOR',
    phases: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    shifts: ['D', 'D', 'D', 'D', 'D', 'D', 'OFF']
  }),
  ROTATE: Object.freeze({
    mode: 'CYCLE',
    targetGroup: 'GENERAL',
    phases: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'OFF-D', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'OFF-N'],
    shifts: ['D', 'D', 'D', 'D', 'D', 'D', 'OFF', 'N', 'N', 'N', 'N', 'N', 'N', 'OFF']
  })
});

async function verify({ prisma = new PrismaClient(), log = console.log } = {}) {
  const ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    const columns = await prisma.$queryRawUnsafe(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='auto_schedule_patterns'"
    );
    const byName = new Map(columns.map((row) => [row.column_name, row]));
    const required = {
      id: 'uuid',
      code: 'character varying',
      name: 'character varying',
      mode: 'character varying',
      steps: 'jsonb',
      is_active: 'boolean',
      is_system: 'boolean',
      target_group: 'character varying',
      sort_order: 'integer',
      created_at: 'timestamp without time zone',
      updated_at: 'timestamp without time zone'
    };
    for (const [name, type] of Object.entries(required)) {
      const column = byName.get(name);
      if (!column) throw new Error(`auto_schedule_patterns.${name} column missing`);
      if (column.data_type !== type) throw new Error(`auto_schedule_patterns.${name} type mismatch`);
    }
    if (byName.get('is_active')?.is_nullable !== 'NO' || !/true/i.test(String(byName.get('is_active')?.column_default || ''))) {
      throw new Error('auto_schedule_patterns.is_active invariant mismatch');
    }
    if (byName.get('is_system')?.is_nullable !== 'NO' || !/false/i.test(String(byName.get('is_system')?.column_default || ''))) {
      throw new Error('auto_schedule_patterns.is_system invariant mismatch');
    }
    if (byName.get('sort_order')?.is_nullable !== 'NO' || !/100/.test(String(byName.get('sort_order')?.column_default || ''))) {
      throw new Error('auto_schedule_patterns.sort_order invariant mismatch');
    }

    const indexes = await prisma.$queryRawUnsafe(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='auto_schedule_patterns'"
    );
    const indexNames = new Set(indexes.map((row) => row.indexname));
    for (const name of [
      'auto_schedule_patterns_pkey',
      'auto_schedule_patterns_code_key',
      'auto_schedule_patterns_is_active_sort_order_idx',
      'auto_schedule_patterns_target_group_is_active_idx'
    ]) {
      if (!indexNames.has(name)) throw new Error(`missing index ${name}`);
    }

    const coreRows = await prisma.autoSchedulePattern.findMany({
      where: { code: { in: ['SUPERVISOR', 'ROTATE'] } },
      select: { code: true, mode: true, targetGroup: true, isActive: true, isSystem: true, steps: true }
    });
    if (coreRows.length !== 2) throw new Error('CFG-05 core pattern seed count mismatch');
    for (const row of coreRows) {
      const expected = expectedCore[row.code];
      if (!expected) throw new Error('unexpected CFG-05 core pattern code');
      if (row.mode !== expected.mode || row.targetGroup !== expected.targetGroup || row.isActive !== true || row.isSystem !== true) {
        throw new Error(`CFG-05 core pattern invariant mismatch for ${row.code}`);
      }
      if (!Array.isArray(row.steps)) throw new Error(`CFG-05 steps missing for ${row.code}`);
      const phases = row.steps.map((step) => String(step?.phaseCode || ''));
      const shifts = row.steps.map((step) => String(step?.shiftCode || ''));
      if (JSON.stringify(phases) !== JSON.stringify(expected.phases)) throw new Error(`CFG-05 phase sequence mismatch for ${row.code}`);
      if (JSON.stringify(shifts) !== JSON.stringify(expected.shifts)) throw new Error(`CFG-05 shift sequence mismatch for ${row.code}`);
      if (shifts.includes('AL')) throw new Error(`CFG-05 core pattern illegally embeds AL for ${row.code}`);
    }

    log('CFG05_PRODUCTION_MIGRATION_VERIFY=PASS');
    log('AUTO_SCHEDULE_PATTERN_SCHEMA=PASS');
    log('AUTO_SCHEDULE_PATTERN_INDEXES=PASS');
    log('AUTO_SCHEDULE_PATTERN_CORE_SEEDS=2');
    log('AUTO_SCHEDULE_PATTERN_AL_REFERENCES=0');
    log('RAW_AUTO_SCHEDULE_PATTERN_DATA_EMITTED=false');
    return true;
  } finally {
    if (ownsClient) await prisma.$disconnect();
  }
}

if (require.main === module) {
  verify().catch((error) => {
    console.error(`CFG05 production migration verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { expectedCore, verify };
