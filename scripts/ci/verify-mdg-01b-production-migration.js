'use strict';

const { PrismaClient } = require('@prisma/client');

async function verify({ prisma = new PrismaClient(), log = console.log } = {}) {
  const ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    const columns = await prisma.$queryRawUnsafe("SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND ((table_name='department_master' AND column_name='code') OR (table_name='position_master' AND column_name='code') OR (table_name='security_site_departments' AND column_name='department_master_id')) ORDER BY table_name, column_name");
    if (columns.length !== 3 || columns.some((row) => row.is_nullable !== 'NO')) throw new Error('MDG-01B required NOT NULL authority columns mismatch');
    const indexes = await prisma.$queryRawUnsafe("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('department_master_code_key','position_master_code_key','security_site_departments_department_master_id_idx','security_site_departments_security_site_id_department_master_id_key','security_site_departments_one_default_per_department_master_key')");
    if (indexes.length !== 5) throw new Error('MDG-01B index count mismatch');
    const fk = await prisma.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM pg_constraint WHERE conname='security_site_departments_department_master_id_fkey' AND contype='f'");
    if (Number(fk[0]?.count || 0) !== 1) throw new Error('MDG-01B Department Master FK missing');
    const missingCodes = await prisma.$queryRawUnsafe("SELECT (SELECT COUNT(*)::int FROM department_master WHERE code IS NULL OR BTRIM(code)='') AS department_missing, (SELECT COUNT(*)::int FROM position_master WHERE code IS NULL OR BTRIM(code)='') AS position_missing");
    if (Number(missingCodes[0]?.department_missing || 0) !== 0 || Number(missingCodes[0]?.position_missing || 0) !== 0) throw new Error('MDG-01B stable code coverage mismatch');
    const unresolved = await prisma.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM security_site_departments ssd LEFT JOIN department_master dm ON dm.id=ssd.department_master_id WHERE ssd.department_master_id IS NULL OR dm.id IS NULL");
    if (Number(unresolved[0]?.count || 0) !== 0) throw new Error('MDG-01B unresolved Department authority mapping');
    const mismatch = await prisma.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM security_site_departments ssd JOIN department_master dm ON dm.id=ssd.department_master_id WHERE LOWER(BTRIM(ssd.department_name)) <> dm.normalized_name");
    if (Number(mismatch[0]?.count || 0) !== 0) throw new Error('MDG-01B legacy Department snapshot mapping mismatch');
    const duplicateDefaults = await prisma.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM (SELECT department_master_id FROM security_site_departments WHERE is_default=TRUE GROUP BY department_master_id HAVING COUNT(*)>1) x");
    if (Number(duplicateDefaults[0]?.count || 0) !== 0) throw new Error('MDG-01B duplicate default Site authority');
    log('MDG_01B_PRODUCTION_MIGRATION_VERIFY=PASS');
    log('MASTER_CODE_COVERAGE=PASS');
    log('DEPARTMENT_SITE_AUTHORITY_COVERAGE=PASS');
    log('LEGACY_DEPARTMENT_SNAPSHOT_COMPATIBILITY=PASS');
    log('RAW_PERSONNEL_VALUES_EMITTED=false');
    return true;
  } finally { if (ownsClient) await prisma.$disconnect(); }
}

if (require.main === module) verify().catch((error)=>{ process.stderr.write(error.message+'\n'); process.exitCode=1; });
module.exports={verify};
