'use strict';

const { createSupabaseAttendanceDeviceSelfieStorage } = require('../../src/services/attendance-device-selfie-storage.service');
const prisma = require('../../src/config/prisma');
const audit = require('../../src/services/audit.service');

async function main() {
  const olderThanMs = Number(process.env.ATTENDANCE_SELFIE_ORPHAN_OLDER_THAN_MS || 60 * 60 * 1000);
  const limit = Number(process.env.ATTENDANCE_SELFIE_ORPHAN_LIMIT || 1000);
  const storage = createSupabaseAttendanceDeviceSelfieStorage({ prisma, audit });
  const result = await storage.reconcileOrphans({ olderThanMs, limit });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error?.details?.code || error?.message || 'RECONCILIATION_FAILED'}\n`); process.exitCode = 1; });

module.exports = { main };
