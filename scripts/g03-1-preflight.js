'use strict';

const prisma = require('../src/config/prisma');
const { classifyG031Data } = require('../src/services/g03-1-preflight.service');

(async () => {
  try {
    const result = await classifyG031Data(prisma);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.classification === 'SAFE_FOR_G03_1_CUTOVER' ? 0 : 2;
  } catch (error) {
    process.stderr.write(`G03.1 preflight failed: ${error?.message || 'unknown error'}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
})();
