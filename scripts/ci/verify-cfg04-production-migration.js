'use strict';

const { PrismaClient } = require('@prisma/client');

async function verify({ prisma = new PrismaClient(), log = console.log } = {}) {
  const ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    const columns = await prisma.$queryRawUnsafe(
      "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='shift_types' AND column_name='is_active'"
    );
    if (columns.length !== 1) throw new Error('shift_types.is_active column missing');
    const column = columns[0];
    if (column.data_type !== 'boolean') throw new Error('shift_types.is_active must be boolean');
    if (column.is_nullable !== 'NO') throw new Error('shift_types.is_active must be NOT NULL');
    if (!/true/i.test(String(column.column_default || ''))) throw new Error('shift_types.is_active default must be true');

    const nullRows = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*)::int AS count FROM shift_types WHERE is_active IS NULL'
    );
    if (Number(nullRows?.[0]?.count || 0) !== 0) throw new Error('shift_types.is_active contains NULL rows');

    log('CFG04_PRODUCTION_MIGRATION_VERIFY=PASS');
    log('SHIFT_TYPES_IS_ACTIVE_COLUMN=PASS');
    log('SHIFT_TYPES_IS_ACTIVE_BOOLEAN=PASS');
    log('SHIFT_TYPES_IS_ACTIVE_NOT_NULL=PASS');
    log('SHIFT_TYPES_IS_ACTIVE_DEFAULT_TRUE=PASS');
    log('SHIFT_TYPES_IS_ACTIVE_NULL_ROWS=0');
    log('RAW_SHIFT_DATA_EMITTED=false');
    return true;
  } finally {
    if (ownsClient) await prisma.$disconnect();
  }
}

if (require.main === module) {
  verify().catch((error) => {
    console.error(`CFG04 production migration verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { verify };
