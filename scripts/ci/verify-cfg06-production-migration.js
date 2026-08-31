'use strict';

const { PrismaClient } = require('@prisma/client');

const requestTypes = Object.freeze([
  'EMPLOYEE_MASTER_CHANGE',
  'EMPLOYEE_REFERENCE_PHOTO',
  'LICENSE_DOCUMENT',
  'ATTENDANCE_DEVICE_REQUEST',
  'ATTENDANCE_ADJUSTMENT_REQUEST',
  'REGISTRATION_REQUEST',
  'USER_ACCESS',
  'LEAVE_REQUEST'
]);
const adminOnlyTypes = new Set([
  'EMPLOYEE_MASTER_CHANGE',
  'EMPLOYEE_REFERENCE_PHOTO',
  'LICENSE_DOCUMENT',
  'ATTENDANCE_DEVICE_REQUEST',
  'ATTENDANCE_ADJUSTMENT_REQUEST'
]);
const flexibleTypes = new Set(['REGISTRATION_REQUEST', 'USER_ACCESS', 'LEAVE_REQUEST']);

function parseJsonArray(value, label) {
  let parsed;
  try { parsed = JSON.parse(String(value)); }
  catch { throw new Error(`${label} is not valid JSON`); }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
  return parsed;
}

async function verify({ prisma = new PrismaClient(), log = console.log } = {}) {
  const ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    const keys = [];
    for (const type of requestTypes) {
      keys.push(
        `APPROVAL_POLICY.${type}.REVIEWER_ROLES`,
        `APPROVAL_POLICY.${type}.DUE_SOON_HOURS`,
        `APPROVAL_POLICY.${type}.OVERDUE_HOURS`
      );
    }
    keys.push(
      'APPROVAL_POLICY.LEAVE_REQUEST.ADDITIONAL_SUPERVISOR_ALIASES',
      'APPROVAL_POLICY.LEAVE_REQUEST.ADDITIONAL_MANAGER_ALIASES'
    );

    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true }
    });
    if (rows.length !== 26) throw new Error('CFG-06 approval policy key count mismatch');
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    if (byKey.size !== 26) throw new Error('CFG-06 approval policy key uniqueness mismatch');

    for (const type of requestTypes) {
      const rolesKey = `APPROVAL_POLICY.${type}.REVIEWER_ROLES`;
      const dueKey = `APPROVAL_POLICY.${type}.DUE_SOON_HOURS`;
      const overdueKey = `APPROVAL_POLICY.${type}.OVERDUE_HOURS`;
      if (!byKey.has(rolesKey) || !byKey.has(dueKey) || !byKey.has(overdueKey)) {
        throw new Error(`CFG-06 core keys missing for ${type}`);
      }
      const roles = parseJsonArray(byKey.get(rolesKey), rolesKey);
      if (!roles.includes('ADMIN')) throw new Error(`CFG-06 ADMIN authority missing for ${type}`);
      const expectedRoles = adminOnlyTypes.has(type) ? ['ADMIN'] : ['ADMIN', 'MANAGER'];
      if (JSON.stringify(roles) !== JSON.stringify(expectedRoles)) {
        throw new Error(`CFG-06 reviewer role default mismatch for ${type}`);
      }
      if (String(byKey.get(dueKey)) !== '24' || String(byKey.get(overdueKey)) !== '48') {
        throw new Error(`CFG-06 SLA default mismatch for ${type}`);
      }
    }

    for (const key of [
      'APPROVAL_POLICY.LEAVE_REQUEST.ADDITIONAL_SUPERVISOR_ALIASES',
      'APPROVAL_POLICY.LEAVE_REQUEST.ADDITIONAL_MANAGER_ALIASES'
    ]) {
      const aliases = parseJsonArray(byKey.get(key), key);
      if (aliases.length !== 0) throw new Error(`CFG-06 alias seed must be empty for ${key}`);
    }

    log('CFG06_PRODUCTION_MIGRATION_VERIFY=PASS');
    log('APPROVAL_POLICY_KEY_COUNT=26');
    log('APPROVAL_POLICY_REQUEST_TYPE_COUNT=8');
    log('APPROVAL_POLICY_ADMIN_ONLY_TYPE_COUNT=5');
    log('APPROVAL_POLICY_FLEXIBLE_TYPE_COUNT=3');
    log('APPROVAL_POLICY_DEFAULT_SLA=PASS');
    log('APPROVAL_POLICY_RAW_VALUES_EMITTED=false');
    return true;
  } finally {
    if (ownsClient) await prisma.$disconnect();
  }
}

if (require.main === module) {
  verify().catch((error) => {
    console.error(`CFG06 production migration verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { requestTypes, adminOnlyTypes, flexibleTypes, verify };
