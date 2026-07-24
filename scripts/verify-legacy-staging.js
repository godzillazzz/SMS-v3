/* Aggregate-only verification for the controlled legacy staging migration. */
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const migrationName = '202607240001_legacy_sms_data_foundation';
const expected = {
  employees: 63,
  users: 39,
  shiftTypes: 6,
  shiftAssignments: 2193,
  employeeLicenses: 63,
  leaveRequests: 1,
  leaveQuotas: 68,
  scheduleApprovals: 4,
  scheduleApprovalEvents: 224,
  userAuditEvents: 70,
  licenseAuditEvents: 83,
  rules: 9,
  settings: 4
};

function safeFailure(error) {
  if (/^P\d{4}$/.test(error?.code || '')) return error.code;
  return 'VERIFICATION_ERROR';
}

async function appliedMigrations(prisma) {
  return prisma.$queryRawUnsafe(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name'
  );
}

async function verifyBefore(prisma) {
  const local = fs.readdirSync(path.resolve('prisma/migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const applied = (await appliedMigrations(prisma)).map((row) => row.migration_name);
  const pending = local.filter((name) => !applied.includes(name));
  const unexpected = applied.filter((name) => !local.includes(name));
  const [users, employees] = await Promise.all([
    prisma.user.count(),
    prisma.employee.count()
  ]);

  if (pending.length !== 1 || pending[0] !== migrationName || unexpected.length !== 0) {
    throw new Error('Unexpected migration state.');
  }
  if (users !== 1 || employees !== 1) {
    throw new Error('The staging database is not in the approved sample-only state.');
  }

  console.log('PRE_MIGRATION_STATE=PASS');
  console.log(`APPLIED_MIGRATION_COUNT=${applied.length}`);
  console.log('PENDING_MIGRATION_COUNT=1');
  console.log(`PENDING_MIGRATION=${migrationName}`);
  console.log(`BASE_USER_COUNT=${users}`);
  console.log(`BASE_EMPLOYEE_COUNT=${employees}`);
}

async function verifyAfter(prisma) {
  const applied = (await appliedMigrations(prisma)).map((row) => row.migration_name);
  if (!applied.includes(migrationName)) throw new Error('Migration is not applied.');

  const counts = {
    employees: await prisma.employee.count({ where: { legacyEmployeeId: { not: null } } }),
    users: await prisma.user.count({ where: { legacyUserId: { not: null } } }),
    shiftTypes: await prisma.shiftType.count(),
    shiftAssignments: await prisma.shiftAssignment.count(),
    employeeLicenses: await prisma.employeeLicense.count(),
    leaveRequests: await prisma.leaveRequest.count(),
    leaveQuotas: await prisma.leaveQuota.count(),
    scheduleApprovals: await prisma.scheduleApproval.count(),
    scheduleApprovalEvents: await prisma.scheduleApprovalEvent.count(),
    userAuditEvents: await prisma.legacyUserAuditEvent.count(),
    licenseAuditEvents: await prisma.legacyLicenseAuditEvent.count(),
    rules: await prisma.schedulingRule.count(),
    settings: await prisma.systemSetting.count()
  };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) throw new Error('Aggregate counts do not match.');

  const [security] = await prisma.$queryRawUnsafe(`
    SELECT
      count(*) FILTER (WHERE legacy_user_id IS NOT NULL AND password_reset_required = true)::int AS reset_required,
      count(*) FILTER (WHERE legacy_user_id IS NOT NULL AND password_hash LIKE '$2%')::int AS bcrypt_hashes
    FROM users
  `);
  const [references] = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM employee_licenses WHERE document_migration_status = 'LEGACY_REFERENCE_PENDING') AS license_pending,
      (SELECT count(*)::int FROM leave_requests WHERE attachment_migration_status = 'LEGACY_REFERENCE_PENDING') AS leave_pending,
      (SELECT count(*)::int FROM leave_quotas WHERE match_status LIKE '%UNMATCHED%') AS quota_unmatched,
      (SELECT count(*)::int FROM leave_quotas WHERE match_status LIKE '%DUPLICATE%') AS quota_duplicate
  `);
  const [integrity] = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*)::int FROM shift_assignments s LEFT JOIN employees e ON e.id = s.employee_id WHERE e.id IS NULL) +
      (SELECT count(*)::int FROM shift_assignments s LEFT JOIN shift_types t ON t.id = s.shift_type_id WHERE t.id IS NULL) +
      (SELECT count(*)::int FROM employee_licenses l LEFT JOIN employees e ON e.id = l.employee_id WHERE e.id IS NULL) +
      (SELECT count(*)::int FROM leave_requests l LEFT JOIN employees e ON e.id = l.employee_id WHERE e.id IS NULL) +
      (SELECT count(*)::int FROM leave_quotas q LEFT JOIN employees e ON e.id = q.employee_id WHERE q.employee_id IS NOT NULL AND e.id IS NULL)
      AS orphan_count
  `);
  const migrationAudit = await prisma.auditLog.count({
    where: { entityType: 'LegacyMigration', entityId: 'google-sheets-sms-import' }
  });
  const [totalUsers, totalEmployees] = await Promise.all([
    prisma.user.count(),
    prisma.employee.count()
  ]);

  if (
    security.reset_required !== 39 || security.bcrypt_hashes !== 39 ||
    references.license_pending !== 63 || references.leave_pending !== 1 ||
    references.quota_unmatched !== 4 || references.quota_duplicate !== 4 ||
    integrity.orphan_count !== 0 || migrationAudit !== 1 ||
    totalUsers !== 40 || totalEmployees !== 64
  ) throw new Error('Security or integrity verification failed.');

  console.log('POST_MIGRATION_STATE=PASS');
  console.log(`APPLIED_MIGRATION_COUNT=${applied.length}`);
  for (const [key, value] of Object.entries(counts)) console.log(`${key}=${value}`);
  console.log(`TOTAL_USERS=${totalUsers}`);
  console.log(`TOTAL_EMPLOYEES=${totalEmployees}`);
  console.log(`PASSWORD_RESET_REQUIRED=${security.reset_required}`);
  console.log(`BCRYPT_HASHES=${security.bcrypt_hashes}`);
  console.log(`LICENSE_REFERENCES_PENDING=${references.license_pending}`);
  console.log(`LEAVE_REFERENCES_PENDING=${references.leave_pending}`);
  console.log(`QUOTA_UNMATCHED=${references.quota_unmatched}`);
  console.log(`QUOTA_DUPLICATE=${references.quota_duplicate}`);
  console.log(`FK_ORPHANS=${integrity.orphan_count}`);
  console.log(`MIGRATION_AUDIT_COUNT=${migrationAudit}`);
}

async function verifyMigrated(prisma) {
  const applied = (await appliedMigrations(prisma)).map((row) => row.migration_name);
  if (applied.length !== 6 || !applied.includes(migrationName)) throw new Error('Migration is not applied.');
  const targetCounts = await Promise.all([
    prisma.shiftType.count(),
    prisma.shiftAssignment.count(),
    prisma.employeeLicense.count(),
    prisma.leaveRequest.count(),
    prisma.leaveQuota.count(),
    prisma.scheduleApproval.count(),
    prisma.scheduleApprovalEvent.count(),
    prisma.schedulingRule.count(),
    prisma.systemSetting.count(),
    prisma.legacyUserAuditEvent.count(),
    prisma.legacyLicenseAuditEvent.count()
  ]);
  const [users, employees] = await Promise.all([prisma.user.count(), prisma.employee.count()]);
  if (targetCounts.some((count) => count !== 0) || users !== 1 || employees !== 1) {
    throw new Error('Post-migration staging state is not clean.');
  }
  console.log('MIGRATION_STATUS=PASS');
  console.log(`APPLIED_MIGRATION_COUNT=${applied.length}`);
  console.log('LEGACY_TARGET_TABLES_EMPTY=PASS');
  console.log(`BASE_USER_COUNT=${users}`);
  console.log(`BASE_EMPLOYEE_COUNT=${employees}`);
}

async function main() {
  const mode = process.argv[2];
  if (!['before', 'migrated', 'after'].includes(mode)) throw new Error('Invalid mode.');
  const prisma = new PrismaClient();
  try {
    if (mode === 'before') await verifyBefore(prisma);
    else if (mode === 'migrated') await verifyMigrated(prisma);
    else await verifyAfter(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`LEGACY_STAGING_VERIFICATION=FAIL:${safeFailure(error)}`);
  process.exitCode = 1;
});
