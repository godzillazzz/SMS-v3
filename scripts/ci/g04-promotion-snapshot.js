'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({ log: [] });
const EXPECTED_MIGRATION = '202608170002_g04_private_registration_request';
const ACTIVATION_KEY = 'G03_1_MULTI_YEAR_WRITES_ENABLED';
const CORE_TABLES = [
  'users',
  'employees',
  'employee_lifecycle_events',
  'leave_quotas',
  'leave_requests',
  'shift_assignments',
  'employee_licenses',
  'employee_license_documents',
  'system_settings',
  '_prisma_migrations'
];

const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
const num = (value) => typeof value === 'bigint' ? Number(value) : Number(value || 0);
const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function localMigrationNames() {
  const root = path.join(process.cwd(), 'prisma', 'migrations');
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function fingerprint(tx, table) {
  if (![...CORE_TABLES, 'registration_requests'].includes(table)) fail('G04_PROMOTION_TABLE_NOT_ALLOWLISTED');
  const rows = await tx.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY to_jsonb(t)::text), '')) AS fp FROM ${table} t`);
  return sha(rows[0]?.fp || '');
}

async function readSnapshot(tx) {
  const counts = (await tx.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM registration_requests)::bigint AS registration_requests,
      (SELECT COUNT(*) FROM users)::bigint AS users,
      (SELECT COUNT(*) FROM employees)::bigint AS employees,
      (SELECT COUNT(*) FROM users WHERE employee_id IS NOT NULL)::bigint AS users_linked,
      (SELECT COUNT(*) FROM system_settings)::bigint AS system_settings,
      (SELECT COUNT(*) FROM leave_quotas)::bigint AS leave_quotas,
      (SELECT COUNT(*) FROM leave_requests)::bigint AS leave_requests,
      (SELECT COUNT(*) FROM shift_assignments)::bigint AS shift_assignments,
      (SELECT COUNT(*) FROM employee_licenses)::bigint AS employee_licenses,
      (SELECT COUNT(*) FROM employee_license_documents)::bigint AS license_documents,
      (SELECT COUNT(*) FROM refresh_sessions)::bigint AS refresh_sessions,
      (SELECT COUNT(*) FROM audit_logs)::bigint AS audit_logs,
      (SELECT COUNT(*) FROM employee_lifecycle_events)::bigint AS lifecycle_events,
      (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS migrations
  `))[0];

  const conflicts = (await tx.$queryRawUnsafe(`
    SELECT COUNT(*)::bigint AS conflicts FROM (
      SELECT employee_id FROM users WHERE employee_id IS NOT NULL GROUP BY employee_id HAVING COUNT(*) > 1
    ) q
  `))[0];

  const schema = (await tx.$queryRawUnsafe(`
    SELECT
      EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='registration_requests') AS table_present,
      EXISTS(SELECT 1 FROM pg_type WHERE typname='RegistrationRequestStatus' AND typtype='e') AS enum_present
  `))[0];

  const migrationRows = await tx.$queryRawUnsafe(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at, migration_name`);
  const applied = migrationRows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => String(row.migration_name));
  const local = localMigrationNames();
  const appliedSet = new Set(applied);
  const localSet = new Set(local);
  const pending = local.filter((name) => !appliedSet.has(name));
  const unexpected = applied.filter((name) => !localSet.has(name));
  const expectedApplied = migrationRows.filter((row) => String(row.migration_name) === EXPECTED_MIGRATION && row.finished_at && !row.rolled_back_at).length;

  const activationRows = await tx.$queryRawUnsafe(`SELECT value FROM system_settings WHERE key=$1`, ACTIVATION_KEY);
  const activationValue = activationRows.length === 1 ? String(activationRows[0].value) : null;

  const coreFingerprints = {};
  for (const table of CORE_TABLES) coreFingerprints[table] = await fingerprint(tx, table);
  const registrationFingerprint = await fingerprint(tx, 'registration_requests');

  return {
    counts: {
      registrationRequests: num(counts.registration_requests),
      users: num(counts.users),
      employees: num(counts.employees),
      usersLinkedToEmployee: num(counts.users_linked),
      linkageConflicts: num(conflicts.conflicts),
      systemSettings: num(counts.system_settings),
      leaveQuotas: num(counts.leave_quotas),
      leaveRequests: num(counts.leave_requests),
      shiftAssignments: num(counts.shift_assignments),
      employeeLicenses: num(counts.employee_licenses),
      licenseDocuments: num(counts.license_documents),
      refreshSessions: num(counts.refresh_sessions),
      auditLogs: num(counts.audit_logs),
      lifecycleEvents: num(counts.lifecycle_events),
      migrations: num(counts.migrations)
    },
    schema: { registrationRequests: Boolean(schema.table_present), registrationRequestStatus: Boolean(schema.enum_present) },
    migrations: { appliedCount: applied.length, candidateCount: local.length, expectedApplied, pending, unexpected },
    activation: { raw: activationValue, effective: activationValue === 'true' ? 'ACTIVE' : 'INACTIVE' },
    coreFingerprints,
    registrationFingerprint
  };
}

function assertPreconditions(snapshot) {
  if (!snapshot.schema.registrationRequests || !snapshot.schema.registrationRequestStatus) fail('G04_PROMOTION_SCHEMA_MISSING');
  if (snapshot.counts.migrations !== 18 || snapshot.migrations.appliedCount !== 18 || snapshot.migrations.candidateCount !== 18) fail('G04_PROMOTION_MIGRATION_COUNT_INVALID');
  if (snapshot.migrations.expectedApplied !== 1 || snapshot.migrations.pending.length !== 0 || snapshot.migrations.unexpected.length !== 0) fail('G04_PROMOTION_MIGRATION_STATE_INVALID');
  if (snapshot.activation.raw !== 'true' || snapshot.activation.effective !== 'ACTIVE') fail('G04_PROMOTION_G03_1_ACTIVATION_CHANGED');
  if (snapshot.counts.linkageConflicts !== 0) fail('G04_PROMOTION_LINKAGE_CONFLICT');
}

async function snapshot() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const ro = await tx.$queryRawUnsafe('SHOW transaction_read_only');
    const isolation = await tx.$queryRawUnsafe('SHOW transaction_isolation');
    if (String(ro[0]?.transaction_read_only).toLowerCase() !== 'on') fail('G04_PROMOTION_READ_ONLY_FAILED');
    const data = await readSnapshot(tx);
    const txid = await tx.$queryRawUnsafe('SELECT txid_current_if_assigned()::text AS txid');
    if (txid[0]?.txid !== null) fail('G04_PROMOTION_READ_ONLY_TXID_ASSIGNED');
    data.readOnly = { transactionReadOnly: 'on', isolation: String(isolation[0]?.transaction_isolation || ''), transactionIdAssigned: null };
    assertPreconditions(data);
    return data;
  }, { maxWait: 10000, timeout: 90000 });
}

async function main() {
  const mode = String(process.argv[2] || 'snapshot');
  const stateFile = process.env.G04_PROMOTION_STATE_FILE || '/tmp/g04-promotion-state.json';
  const current = await snapshot();
  if (mode === 'pre') {
    fs.writeFileSync(stateFile, JSON.stringify(current), { encoding: 'utf8', mode: 0o600 });
    console.log('G04_PROMOTION_PRE_SNAPSHOT=' + JSON.stringify({ counts: current.counts, schema: current.schema, migrations: current.migrations, activation: current.activation, readOnly: current.readOnly }));
    return;
  }
  if (mode !== 'post') fail('G04_PROMOTION_STATE_MODE_INVALID');
  const before = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (JSON.stringify(current.coreFingerprints) !== JSON.stringify(before.coreFingerprints)) fail('G04_PROMOTION_BUSINESS_WRITE_DETECTED_CORE_FINGERPRINT');
  if (current.counts.users !== before.counts.users || current.counts.employees !== before.counts.employees || current.counts.usersLinkedToEmployee !== before.counts.usersLinkedToEmployee || current.counts.linkageConflicts !== before.counts.linkageConflicts) fail('G04_PROMOTION_BUSINESS_WRITE_DETECTED_IDENTITY_COUNTS');
  if (current.counts.systemSettings !== before.counts.systemSettings || current.counts.migrations !== before.counts.migrations) fail('G04_PROMOTION_BUSINESS_WRITE_DETECTED_CONTROL_COUNTS');
  const registrationDelta = current.counts.registrationRequests - before.counts.registrationRequests;
  console.log('G04_PROMOTION_BUSINESS_WRITE_GUARD=PASS');
  console.log('G04_PROMOTION_REGISTRATION_REQUEST_DELTA=' + registrationDelta);
  console.log('G04_PROMOTION_REGISTRATION_REQUEST_CHANGED=' + (current.registrationFingerprint === before.registrationFingerprint ? 'NO' : 'YES_EXTERNAL_TRAFFIC_POSSIBLE'));
  console.log('G04_PROMOTION_POST_SNAPSHOT=' + JSON.stringify({ counts: current.counts, schema: current.schema, migrations: current.migrations, activation: current.activation, readOnly: current.readOnly }));
}

main().catch((error) => {
  console.error('G04_PROMOTION_STATE_FAILED=' + String(error.code || error.message || 'UNKNOWN'));
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect().catch(() => undefined));
