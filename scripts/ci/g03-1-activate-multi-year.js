'use strict';

const { PrismaClient } = require('@prisma/client');

const KEY = 'G03_1_MULTI_YEAR_WRITES_ENABLED';
const VALUE = 'true';
const DESCRIPTION = 'Protected release operation: G03.1 multi-year writes activation';
const prisma = new PrismaClient({ log: [] });

function classify(value, exists) {
  if (!exists) return 'MISSING';
  if (value === 'true') return 'TRUE';
  if (value === 'false') return 'FALSE';
  return 'MALFORMED';
}

async function main() {
  if (process.argv.length !== 2) throw new Error('ACTIVATION_ARGUMENTS_NOT_ALLOWED');

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const before = await tx.systemSetting.findUnique({
      where: { key: KEY },
      select: { value: true }
    });
    const preState = classify(before?.value, Boolean(before));

    if (before?.value === VALUE) {
      throw new Error('ACTIVATION_ALREADY_ACTIVE_RACE_REQUIRES_REVIEW');
    }

    let mutationType;
    if (!before) {
      await tx.systemSetting.create({
        data: { key: KEY, value: VALUE, description: DESCRIPTION },
        select: { key: true }
      });
      mutationType = 'CREATE';
    } else {
      await tx.systemSetting.update({
        where: { key: KEY },
        data: { value: VALUE },
        select: { key: true }
      });
      mutationType = 'UPDATE';
    }

    const inside = await tx.systemSetting.findUnique({
      where: { key: KEY },
      select: { value: true }
    });
    if (!inside || inside.value !== VALUE) throw new Error('ACTIVATION_TRANSACTION_READBACK_FAILED');

    return { preState, mutationType };
  }, { maxWait: 10000, timeout: 30000 });

  const after = await prisma.systemSetting.findUnique({
    where: { key: KEY },
    select: { value: true }
  });
  if (!after || after.value !== VALUE) throw new Error('ACTIVATION_POSTCOMMIT_READBACK_FAILED');

  console.log(`ACTIVATION_PRE_STATE=${result.preState}`);
  console.log(`ACTIVATION_MUTATION_TYPE=${result.mutationType}`);
  console.log('ACTIVATION_POST_STATE=TRUE');
  console.log('ACTIVATION_EFFECTIVE=ACTIVE');
  console.log('ACTIVATION_RAW_VALUE=true');
}

main()
  .finally(() => prisma.$disconnect().catch(() => undefined))
  .catch((error) => {
    console.error(`ACTIVATION_FAILED=${error?.message || 'ERROR'}`);
    process.exitCode = 1;
  });
