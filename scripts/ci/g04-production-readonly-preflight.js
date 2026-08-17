'use strict';
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({ log: [] });
const TARGET_MIGRATION = '202608170002_g04_private_registration_request';
const ACTIVATION_KEY = 'G03_1_MULTI_YEAR_WRITES_ENABLED';
const num = (v) => typeof v === 'bigint' ? Number(v) : Number(v || 0);
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function mapCounts(row) {
  return {
    users: num(row.user_count),
    employees: num(row.employee_count),
    leaveQuotas: num(row.leave_quota_count),
    leaveRequests: num(row.leave_request_count),
    shiftAssignments: num(row.shift_assignment_count),
    systemSettings: num(row.system_setting_count),
    employeeLicenses: num(row.employee_license_count),
    licenseDocuments: num(row.license_document_count),
    prismaMigrations: num(row.migration_count)
  };
}

(async () => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const ro = await tx.$queryRawUnsafe('SHOW transaction_read_only');
      const iso = await tx.$queryRawUnsafe('SHOW transaction_isolation');
      const transactionReadOnly = String(ro?.[0]?.transaction_read_only || '').toLowerCase();
      const isolation = String(iso?.[0]?.transaction_isolation || '').toLowerCase();
      if (transactionReadOnly !== 'on') throw new Error('READ_ONLY_ENFORCEMENT_FAILED');
      if (isolation !== 'repeatable read') throw new Error('ISOLATION_ENFORCEMENT_FAILED');

      const countSql = `SELECT
        (SELECT COUNT(*) FROM users)::bigint AS user_count,
        (SELECT COUNT(*) FROM employees)::bigint AS employee_count,
        (SELECT COUNT(*) FROM leave_quotas)::bigint AS leave_quota_count,
        (SELECT COUNT(*) FROM leave_requests)::bigint AS leave_request_count,
        (SELECT COUNT(*) FROM shift_assignments)::bigint AS shift_assignment_count,
        (SELECT COUNT(*) FROM system_settings)::bigint AS system_setting_count,
        (SELECT COUNT(*) FROM employee_licenses)::bigint AS employee_license_count,
        (SELECT COUNT(*) FROM employee_license_documents)::bigint AS license_document_count,
        (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS migration_count`;
      const beforeCounts = mapCounts((await tx.$queryRawUnsafe(countSql))[0]);

      const tableExists = (await tx.$queryRawUnsafe(`SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='registration_requests'
      ) AS value`))[0].value;
      const enumExists = (await tx.$queryRawUnsafe(`SELECT EXISTS (
        SELECT 1 FROM pg_type WHERE typname='RegistrationRequestStatus' AND typtype='e'
      ) AS value`))[0].value;
      const migrationApplied = (await tx.$queryRawUnsafe(`SELECT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      ) AS value`, TARGET_MIGRATION))[0].value;
      const migrationRows = await tx.$queryRawUnsafe(`SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
      const indexCollision = (await tx.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM pg_class
        WHERE relkind='i' AND relname IN (
          'registration_requests_email_key',
          'registration_requests_status_created_at_idx',
          'registration_requests_email_verified_at_status_idx',
          'registration_requests_matched_employee_id_idx'
        )`))[0];
      const fkTargets = (await tx.$queryRawUnsafe(`SELECT
        COUNT(*) FILTER (WHERE table_name='users' AND column_name='id' AND udt_name='uuid')::bigint AS users_uuid_id,
        COUNT(*) FILTER (WHERE table_name='employees' AND column_name='id' AND udt_name='uuid')::bigint AS employees_uuid_id
        FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','employees') AND column_name='id'`))[0];
      const genRandomUuid = (await tx.$queryRawUnsafe(`SELECT to_regprocedure('gen_random_uuid()') IS NOT NULL AS value`))[0].value;

      const userAgg = (await tx.$queryRawUnsafe(`SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE role::text='ADMIN')::bigint AS admin,
        COUNT(*) FILTER (WHERE role::text='MANAGER')::bigint AS manager,
        COUNT(*) FILTER (WHERE role::text='VIEWER')::bigint AS viewer,
        COUNT(*) FILTER (WHERE role::text NOT IN ('ADMIN','MANAGER','VIEWER'))::bigint AS other_role,
        COUNT(*) FILTER (WHERE is_active=true AND account_status::text='ACTIVE')::bigint AS active_users,
        COUNT(*) FILTER (WHERE is_active=false)::bigint AS inactive_users,
        COUNT(*) FILTER (WHERE account_status::text='PENDING')::bigint AS pending_users,
        COUNT(*) FILTER (WHERE employee_id IS NOT NULL)::bigint AS with_employee,
        COUNT(*) FILTER (WHERE employee_id IS NULL)::bigint AS without_employee
        FROM users`))[0];
      const accountStatuses = await tx.$queryRawUnsafe(`SELECT account_status::text AS status, COUNT(*)::bigint AS count
        FROM users GROUP BY account_status::text ORDER BY account_status::text`);

      const legacy = (await tx.$queryRawUnsafe(`WITH pending AS (
        SELECT u.*,
          EXISTS (SELECT 1 FROM auth_otp_challenges c WHERE c.user_id=u.id AND c.purpose::text='REGISTRATION') AS otp_any,
          EXISTS (SELECT 1 FROM auth_otp_challenges c WHERE c.user_id=u.id AND c.purpose::text='REGISTRATION' AND c.consumed_at IS NOT NULL) AS otp_consumed,
          EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type='RegistrationRequest' AND a.entity_id=u.id::text) AS audit_evidence
        FROM users u WHERE u.account_status::text='PENDING'
      ), approx AS (
        SELECT *, (otp_any OR audit_evidence) AS runtime_evidence
        FROM pending WHERE is_active=false AND requested_at IS NOT NULL
      )
      SELECT
        COUNT(*)::bigint AS candidates,
        COUNT(*) FILTER (WHERE employee_id IS NOT NULL)::bigint AS linked,
        COUNT(*) FILTER (WHERE employee_id IS NULL)::bigint AS unlinked,
        COUNT(*) FILTER (WHERE role::text='VIEWER')::bigint AS viewer,
        COUNT(*) FILTER (WHERE role::text IN ('ADMIN','MANAGER'))::bigint AS privileged,
        COUNT(*) FILTER (WHERE is_active=false)::bigint AS disabled,
        COUNT(*) FILTER (WHERE otp_consumed AND approved_at IS NULL)::bigint AS verified_not_approved,
        COUNT(*) FILTER (WHERE runtime_evidence)::bigint AS runtime_evidence,
        COUNT(*) FILTER (WHERE runtime_evidence AND employee_id IS NOT NULL)::bigint AS runtime_evidence_linked,
        COUNT(*) FILTER (WHERE runtime_evidence AND employee_id IS NULL)::bigint AS runtime_evidence_unlinked,
        COUNT(*) FILTER (WHERE runtime_evidence AND role::text IN ('ADMIN','MANAGER'))::bigint AS runtime_evidence_privileged,
        COUNT(*) FILTER (WHERE legacy_user_id IS NOT NULL)::bigint AS legacy_import_marker,
        COUNT(*) FILTER (WHERE NOT runtime_evidence)::bigint AS provenance_ambiguous,
        COUNT(*) FILTER (WHERE approved_at IS NOT NULL OR approved_by_legacy_ref IS NOT NULL OR rejection_reason IS NOT NULL)::bigint AS approval_state_anomaly,
        COUNT(*)::bigint AS occupied_email_blockers
      FROM approx`))[0];

      const email = (await tx.$queryRawUnsafe(`WITH exact_dupes AS (
          SELECT email FROM users GROUP BY email HAVING COUNT(*)>1
        ), normalized_dupes AS (
          SELECT lower(btrim(email)) AS normalized, COUNT(*)::bigint AS c
          FROM users GROUP BY lower(btrim(email)) HAVING COUNT(*)>1
        )
        SELECT
          (SELECT COUNT(*) FROM exact_dupes)::bigint AS exact_duplicate_groups,
          (SELECT COUNT(*) FROM normalized_dupes)::bigint AS normalized_duplicate_groups,
          (SELECT COALESCE(SUM(c),0) FROM normalized_dupes)::bigint AS normalized_duplicate_rows,
          (SELECT COUNT(*) FROM users WHERE email IS NULL OR btrim(email)='')::bigint AS blank_or_null,
          (SELECT COUNT(*) FROM users WHERE email <> lower(btrim(email)))::bigint AS noncanonical_email_rows
      `))[0];

      const linkage = (await tx.$queryRawUnsafe(`WITH multi AS (
          SELECT employee_id, COUNT(*)::bigint AS c FROM users
          WHERE employee_id IS NOT NULL GROUP BY employee_id HAVING COUNT(*)>1
        )
        SELECT
          (SELECT COUNT(*) FROM employees)::bigint AS employees_total,
          (SELECT COUNT(*) FROM employees WHERE is_active=true AND deleted_at IS NULL)::bigint AS employees_active_nondeleted,
          (SELECT COUNT(*) FROM users WHERE employee_id IS NOT NULL)::bigint AS users_linked_to_employees,
          (SELECT COUNT(DISTINCT employee_id) FROM users WHERE employee_id IS NOT NULL)::bigint AS employees_linked_to_users,
          (SELECT COUNT(*) FROM multi)::bigint AS employee_multi_user_groups,
          (SELECT COALESCE(SUM(c),0) FROM multi)::bigint AS users_in_multi_groups,
          (SELECT COUNT(*) FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.employee_id IS NOT NULL AND e.id IS NULL)::bigint AS missing_employee_links,
          (SELECT COUNT(*) FROM users u JOIN employees e ON e.id=u.employee_id WHERE e.is_active=false OR e.deleted_at IS NOT NULL)::bigint AS inactive_or_deleted_employee_links,
          (SELECT COUNT(*) FROM employees e WHERE e.is_active=true AND e.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id=e.id))::bigint AS available_active_employees
      `))[0];
      const uniqueEmployeeIndex = (await tx.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS count FROM pg_indexes
        WHERE schemaname='public' AND tablename='users' AND indexdef ILIKE 'CREATE UNIQUE INDEX%' AND indexdef ILIKE '%(employee_id)%'`))[0];

      const privileged = (await tx.$queryRawUnsafe(`SELECT
        COUNT(*) FILTER (WHERE role::text='ADMIN')::bigint AS admin,
        COUNT(*) FILTER (WHERE role::text='MANAGER')::bigint AS manager,
        COUNT(*) FILTER (WHERE role::text='VIEWER')::bigint AS viewer,
        COUNT(*) FILTER (WHERE role::text IN ('ADMIN','MANAGER') AND (account_status::text<>'ACTIVE' OR is_active=false))::bigint AS pending_or_disabled_privileged
        FROM users`))[0];

      const activationRows = await tx.$queryRawUnsafe(`SELECT value FROM system_settings WHERE key=$1`, ACTIVATION_KEY);
      const activation = activationRows.length === 1 && activationRows[0].value === 'true' ? 'ACTIVE' : activationRows.length === 0 ? 'MISSING_INACTIVE' : 'INACTIVE_OR_MALFORMED';

      const fingerprintSql = `SELECT
        md5(COALESCE((SELECT string_agg(md5(concat_ws('|',id::text,lower(btrim(email)),display_name,coalesce(department,''),role::text,account_status::text,is_active::text,coalesce(requested_at::text,''),coalesce(approved_at::text,''))), ',' ORDER BY id::text) FROM users),'')) AS user_business,
        md5(COALESCE((SELECT string_agg(md5(concat_ws('|',id::text,coalesce(employee_id::text,''))), ',' ORDER BY id::text) FROM users),'')) AS user_employee,
        md5(COALESCE((SELECT string_agg(md5(concat_ws('|',id::text,employee_code,first_name,last_name,coalesce(email,''),coalesce(department,''),coalesce(job_title,''),is_active::text,coalesce(deleted_at::text,''))), ',' ORDER BY id::text) FROM employees),'')) AS employee_business`;
      const fpBefore = (await tx.$queryRawUnsafe(fingerprintSql))[0];
      const preFingerprints = {
        user: sha256(fpBefore.user_business),
        userEmployee: sha256(fpBefore.user_employee),
        employee: sha256(fpBefore.employee_business)
      };

      const afterCounts = mapCounts((await tx.$queryRawUnsafe(countSql))[0]);
      const fpAfter = (await tx.$queryRawUnsafe(fingerprintSql))[0];
      const postFingerprints = {
        user: sha256(fpAfter.user_business),
        userEmployee: sha256(fpAfter.user_employee),
        employee: sha256(fpAfter.employee_business)
      };
      const txid = await tx.$queryRawUnsafe('SELECT txid_current_if_assigned()::text AS txid');

      return {
        piiOutputRows: 0,
        readOnly: {
          transactionReadOnly,
          isolation,
          transactionIdAssigned: txid?.[0]?.txid || null,
          beforeCounts,
          afterCounts,
          countsEqual: JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
          fingerprintsEqual: JSON.stringify(preFingerprints) === JSON.stringify(postFingerprints),
          insert: 0, update: 0, delete: 0, ddl: 0
        },
        schema: {
          registrationRequestsTable: Boolean(tableExists),
          registrationRequestStatusEnum: Boolean(enumExists),
          g04MigrationApplied: Boolean(migrationApplied),
          appliedMigrationCount: migrationRows.length,
          appliedMigrationIdentity: sha256(JSON.stringify(migrationRows.map(r => r.migration_name))),
          g04IndexNameCollisions: num(indexCollision.count),
          usersUuidId: num(fkTargets.users_uuid_id),
          employeesUuidId: num(fkTargets.employees_uuid_id),
          genRandomUuidAvailable: Boolean(genRandomUuid)
        },
        users: {
          total: num(userAgg.total), admin: num(userAgg.admin), manager: num(userAgg.manager), viewer: num(userAgg.viewer), otherRole: num(userAgg.other_role),
          activeUsers: num(userAgg.active_users), inactiveUsers: num(userAgg.inactive_users), disabledUsers: num(userAgg.inactive_users), pendingUsers: num(userAgg.pending_users),
          usersWithEmployeeId: num(userAgg.with_employee), usersWithoutEmployeeId: num(userAgg.without_employee),
          accountStatuses: Object.fromEntries(accountStatuses.map(r => [String(r.status), num(r.count)])),
          verificationState: 'NOT_STORED_ON_USER'
        },
        legacyRegistration: {
          provenanceRule: 'PENDING + is_active=false + requested_at IS NOT NULL; strong evidence requires REGISTRATION OTP or RegistrationRequest audit',
          legacyPendingCandidates: num(legacy.candidates), linked: num(legacy.linked), unlinked: num(legacy.unlinked), viewer: num(legacy.viewer), privileged: num(legacy.privileged),
          disabledInactive: num(legacy.disabled), verifiedNotApproved: num(legacy.verified_not_approved), strongRuntimeEvidence: num(legacy.runtime_evidence),
          strongRuntimeEvidenceLinked: num(legacy.runtime_evidence_linked), strongRuntimeEvidenceUnlinked: num(legacy.runtime_evidence_unlinked),
          strongRuntimeEvidencePrivileged: num(legacy.runtime_evidence_privileged), legacyImportMarker: num(legacy.legacy_import_marker),
          provenanceAmbiguous: num(legacy.provenance_ambiguous), approvalStateAnomaly: num(legacy.approval_state_anomaly),
          occupiedEmailApprovalBlockers: num(legacy.occupied_email_blockers)
        },
        email: {
          duplicateExactGroups: num(email.exact_duplicate_groups), duplicateNormalizedGroups: num(email.normalized_duplicate_groups),
          duplicateNormalizedRows: num(email.normalized_duplicate_rows), blankOrNull: num(email.blank_or_null), nonCanonicalRows: num(email.noncanonical_email_rows)
        },
        userEmployee: {
          employeesTotal: num(linkage.employees_total), employeesActiveNonDeleted: num(linkage.employees_active_nondeleted),
          usersLinkedToEmployees: num(linkage.users_linked_to_employees), employeesLinkedToUsers: num(linkage.employees_linked_to_users),
          employeeMultiUserGroups: num(linkage.employee_multi_user_groups), usersInMultiGroups: num(linkage.users_in_multi_groups),
          missingEmployeeLinks: num(linkage.missing_employee_links), inactiveOrDeletedEmployeeLinks: num(linkage.inactive_or_deleted_employee_links),
          availableActiveEmployees: num(linkage.available_active_employees), uniqueEmployeeIndexCount: num(uniqueEmployeeIndex.count)
        },
        privileged: {
          admin: num(privileged.admin), manager: num(privileged.manager), viewer: num(privileged.viewer),
          pendingOrDisabledPrivileged: num(privileged.pending_or_disabled_privileged),
          legacyRegistrationPrivilegedEvidence: num(legacy.runtime_evidence_privileged)
        },
        activation,
        fingerprints: preFingerprints
      };
    }, { maxWait: 10000, timeout: 60000 });

    console.log('G04_PRODUCTION_READONLY_PREFLIGHT=' + JSON.stringify(result));
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
})().catch((error) => {
  console.error('G04_PRODUCTION_READONLY_PREFLIGHT_FAILED=' + (error?.code || error?.name || 'ERROR'));
  process.exitCode = 1;
});