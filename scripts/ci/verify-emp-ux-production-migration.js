'use strict';

const { Prisma, PrismaClient } = require('@prisma/client');
const TABLES = Object.freeze(['department_master','position_master']);
const INDEXES = Object.freeze(['department_master_normalized_name_key','department_master_is_active_sort_order_name_idx','position_master_normalized_name_key','position_master_is_active_sort_order_name_idx']);
async function verify({ prisma = new PrismaClient(), log = console.log } = {}) {
  const ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    const tables = await prisma.$queryRaw(Prisma.sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (${Prisma.join(TABLES)})`);
    if (tables.length !== TABLES.length) throw new Error('EMP-UX master table count mismatch');
    const indexes = await prisma.$queryRaw(Prisma.sql`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN (${Prisma.join(INDEXES)})`);
    if (indexes.length !== INDEXES.length) throw new Error('EMP-UX master index count mismatch');
    const deptMissing = await prisma.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS count FROM employees e WHERE e.department IS NOT NULL AND BTRIM(e.department) <> '' AND NOT EXISTS (SELECT 1 FROM department_master d WHERE d.normalized_name=LOWER(BTRIM(e.department)))`);
    const posMissing = await prisma.$queryRaw(Prisma.sql`SELECT COUNT(*)::int AS count FROM employees e WHERE e.job_title IS NOT NULL AND BTRIM(e.job_title) <> '' AND NOT EXISTS (SELECT 1 FROM position_master p WHERE p.normalized_name=LOWER(BTRIM(e.job_title)))`);
    if (Number(deptMissing[0]?.count || 0) !== 0) throw new Error('EMP-UX Department bootstrap coverage mismatch');
    if (Number(posMissing[0]?.count || 0) !== 0) throw new Error('EMP-UX Position bootstrap coverage mismatch');
    log('EMP_UX_PRODUCTION_MIGRATION_VERIFY=PASS');
    log('PERSONNEL_MASTER_TABLE_COUNT=2');
    log('PERSONNEL_MASTER_INDEX_COUNT=4');
    log('DEPARTMENT_BOOTSTRAP_COVERAGE=PASS');
    log('POSITION_BOOTSTRAP_COVERAGE=PASS');
    log('RAW_EMPLOYEE_OR_MASTER_VALUES_EMITTED=false');
    return true;
  } finally { if (ownsClient) await prisma.$disconnect(); }
}
if (require.main === module) verify().catch((error)=>{ process.stderr.write(error.message+'\n'); process.exitCode=1; });
module.exports={TABLES,INDEXES,verify};
