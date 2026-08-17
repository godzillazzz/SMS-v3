'use strict';

const { PrismaClient } = require('@prisma/client');

const BASE_YEAR = 2026;
const ROLES = Object.freeze(['ADMIN', 'MANAGER', 'VIEWER']);

function roleEmail(environment, role) {
  const value = String(environment[`UAT_${role}_EMAIL`] || '').trim();
  if (!value) {
    const error = new Error(`G03_1_AUTH_PERSONA_EMAIL_MISSING_${role}`);
    error.code = error.message;
    throw error;
  }
  return value;
}

function safeEvidence({ userRows, annualRows, otherYearRows }, role) {
  const user = userRows.length === 1 ? userRows[0] : undefined;
  const roleMatched = String(user?.role || '') === role;
  const employeeLinked = Boolean(user?.employee_id);
  const annual2026Rows = Number(annualRows?.[0]?.count || 0);
  const otherAnnualRows = Number(otherYearRows?.[0]?.count || 0);
  const summaryReadMode = employeeLinked ? 'LINKED_EXISTING_2026' : 'UNLINKED_NO_ENSURE';
  const authoritySafe = employeeLinked ? annual2026Rows === 1 : annual2026Rows === 0;
  return {
    userFoundExactlyOnce: userRows.length === 1,
    roleMatched,
    employeeLinked,
    annual2026Rows,
    otherAnnualRows,
    summaryReadMode,
    safe: userRows.length === 1 && roleMatched && authoritySafe && otherAnnualRows === 0
  };
}

async function runPreflight({ prisma = new PrismaClient({ log: [] }), environment = process.env } = {}) {
  let ownsClient = arguments.length === 0 || !arguments[0]?.prisma;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const ro = await tx.$queryRawUnsafe('SHOW transaction_read_only');
      if (String(ro?.[0]?.transaction_read_only || '').toLowerCase() !== 'on') {
        const error = new Error('G03_1_AUTH_PERSONA_PREFLIGHT_NOT_READ_ONLY');
        error.code = error.message;
        throw error;
      }

      const evidence = {};
      for (const role of ROLES) {
        const email = roleEmail(environment, role);
        const userRows = await tx.$queryRawUnsafe(
          'SELECT role, employee_id FROM users WHERE lower(email) = lower($1)',
          email
        );
        const employeeId = userRows.length === 1 ? userRows[0].employee_id : null;
        const annualRows = employeeId
          ? await tx.$queryRawUnsafe(
              `SELECT COUNT(*)::int AS count FROM leave_quotas
               WHERE employee_id = $1::uuid AND quota_year = $2 AND match_status = 'MATCHED'`,
              employeeId,
              BASE_YEAR
            )
          : [{ count: 0 }];
        const otherYearRows = employeeId
          ? await tx.$queryRawUnsafe(
              `SELECT COUNT(*)::int AS count FROM leave_quotas
               WHERE employee_id = $1::uuid AND quota_year IS NOT NULL AND quota_year <> $2`,
              employeeId,
              BASE_YEAR
            )
          : [{ count: 0 }];
        evidence[role] = safeEvidence({ userRows, annualRows, otherYearRows }, role);
      }

      const txid = await tx.$queryRawUnsafe('SELECT txid_current_if_assigned()::text AS txid');
      const transactionIdAssigned = txid?.[0]?.txid || null;
      if (transactionIdAssigned !== null) {
        const error = new Error('G03_1_AUTH_PERSONA_PREFLIGHT_TRANSACTION_ID_ASSIGNED');
        error.code = error.message;
        throw error;
      }
      const allSafe = ROLES.every((role) => evidence[role]?.safe === true);
      if (!allSafe) {
        const error = new Error('G03_1_AUTH_PERSONA_2026_AUTHORITY_UNSAFE');
        error.code = error.message;
        error.safeEvidence = evidence;
        throw error;
      }
      return { transactionReadOnly: 'on', transactionIdAssigned, baseYear: BASE_YEAR, roles: evidence, allSafe };
    }, { maxWait: 10000, timeout: 30000 });
  } finally {
    if (ownsClient) await prisma.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  runPreflight()
    .then((result) => {
      console.log('G03_1_AUTH_PERSONA_PREFLIGHT=' + JSON.stringify(result));
    })
    .catch((error) => {
      const safe = error?.safeEvidence ? JSON.stringify(error.safeEvidence) : '{}';
      console.error(`G03_1_AUTH_PERSONA_PREFLIGHT_FAILED code=${error?.code || error?.message || 'ERROR'} evidence=${safe}`);
      process.exitCode = 1;
    });
}

module.exports = { BASE_YEAR, ROLES, roleEmail, safeEvidence, runPreflight };
