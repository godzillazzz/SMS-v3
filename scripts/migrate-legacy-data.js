require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { loadLegacySource } = require('../src/services/legacy-migration/csv-source');
const { buildMigrationPlan } = require('../src/services/legacy-migration/transform');
const { importLegacyPlan } = require('../src/services/legacy-migration/importer');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeError(error) {
  if (error?.code && /^P\d{4}$/.test(error.code)) return `Prisma ${error.code}`;
  const name = String(error?.name || 'Error').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (name.startsWith('Prisma')) return `${name} during legacy import`;
  const message = String(error?.message || '').replace(/[\r\n]+/g, ' ').slice(0, 500);
  const safePatterns = [
    /^Use --source /,
    /^Apply mode /,
    /^Migration source /,
    /^Required migration file /,
    /^Unexpected CSV header schema /,
    /^(Employees|Users|Shift Types|Schedule|Employee Licenses|Leave|Quota|Schedule Approvals|Schedule Approval Log|Rules|Settings|User Audit Log|License Audit Log) row \d+:/,
    /^Legacy migration target tables /,
    /^Legacy import stage [a-z-]+ failed \([A-Za-z0-9_-]+\)\.$/,
    /^Target (already )?contains /,
    /^Post-import row-count verification /
  ];
  return safePatterns.some((pattern) => pattern.test(message)) ? message : `${name} during legacy import`;
}

async function main() {
  const sourceDir = argument('--source');
  if (!sourceDir) throw new Error('Use --source with the migration input directory.');
  const apply = process.argv.includes('--apply');
  const target = argument('--target');
  if (apply && process.env.LEGACY_MIGRATION_ALLOW_WRITE !== 'true') {
    throw new Error('Apply mode requires LEGACY_MIGRATION_ALLOW_WRITE=true.');
  }
  if (apply && !['local', 'staging'].includes(target)) {
    throw new Error('Apply mode requires --target local or --target staging; production is not permitted.');
  }
  if (apply && process.env.LEGACY_MIGRATION_TARGET_CONFIRMATION !== target) {
    throw new Error('Apply mode target confirmation does not match --target.');
  }

  const source = loadLegacySource(sourceDir);
  const plan = buildMigrationPlan(source);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ result: 'PASS', mode: 'DRY_RUN', summary: plan.summary }, null, 2)}\n`);
    return;
  }

  const prisma = new PrismaClient();
  try {
    const verification = await importLegacyPlan(prisma, plan);
    process.stdout.write(`${JSON.stringify({ result: 'PASS', mode: 'APPLY', verification }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`BLOCKED: ${safeError(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { safeError };
