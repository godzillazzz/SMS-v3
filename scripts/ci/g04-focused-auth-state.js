'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { writeRoleSessions } = require('../../e2e/helpers/uat-session');

const prisma = new PrismaClient({ log: [] });
const STATE_FILE = process.env.G04_AUTH_STATE_FILE || '/tmp/g04-focused-auth-state.json';
const APP_ROOT = process.env.UAT_APPLICATION_ROOT || path.resolve('application-under-test');
const EXPECTED_MIGRATION = '202608170002_g04_private_registration_request';
const ACTIVATION_KEY = 'G03_1_MULTI_YEAR_WRITES_ENABLED';
const ROLES = ['ADMIN', 'MANAGER', 'VIEWER'];
const TABLES = [
  'users',
  'employees',
  'registration_requests',
  'refresh_sessions',
  'audit_logs',
  'employee_lifecycle_events',
  'leave_quotas',
  'leave_requests',
  'shift_assignments',
  'employee_licenses',
  'employee_license_documents',
  'system_settings'
];

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const num = (value) => typeof value === 'bigint' ? Number(value) : Number(value || 0);
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function bangkokDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function candidateMigrationNames() {
  const root = path.join(APP_ROOT, 'prisma', 'migrations');
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function tableFingerprint(tx, table) {
  if (!TABLES.includes(table)) fail('G04_AUTH_TABLE_NOT_ALLOWLISTED');
  const rows = await tx.$queryRawUnsafe(
    `SELECT md5(COALESCE(string_agg(md5(to_jsonb(t)::text), ',' ORDER BY to_jsonb(t)::text), '')) AS fp FROM ${table} t`
  );
  return hash(rows[0]?.fp || '');
}

async function readSnapshot(tx) {
  const countsRow = (await tx.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM users)::bigint AS users,
      (SELECT COUNT(*) FROM employees)::bigint AS employees,
      (SELECT COUNT(*) FROM registration_requests)::bigint AS registration_requests,
      (SELECT COUNT(*) FROM refresh_sessions)::bigint AS refresh_sessions,
      (SELECT COUNT(*) FROM audit_logs)::bigint AS audit_logs,
      (SELECT COUNT(*) FROM employee_lifecycle_events)::bigint AS lifecycle_events,
      (SELECT COUNT(*) FROM leave_quotas)::bigint AS leave_quotas,
      (SELECT COUNT(*) FROM leave_requests)::bigint AS leave_requests,
      (SELECT COUNT(*) FROM shift_assignments)::bigint AS shift_assignments,
      (SELECT COUNT(*) FROM employee_licenses)::bigint AS employee_licenses,
      (SELECT COUNT(*) FROM employee_license_documents)::bigint AS license_documents,
      (SELECT COUNT(*) FROM system_settings)::bigint AS system_settings,
      (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS migrations
  `))[0];

  const links = (await tx.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE employee_id IS NOT NULL)::bigint AS linked_users,
      COUNT(DISTINCT employee_id) FILTER (WHERE employee_id IS NOT NULL)::bigint AS linked_employees,
      (
        SELECT COUNT(*) FROM (
          SELECT employee_id FROM users WHERE employee_id IS NOT NULL GROUP BY employee_id HAVING COUNT(*) > 1
        ) conflicts
      )::bigint AS linkage_conflicts
    FROM users
  `))[0];

  const due = (await tx.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS due FROM employee_lifecycle_events WHERE status = 'PENDING' AND effective_date <= $1::date`,
    bangkokDate()
  ))[0];

  const migrationRows = await tx.$queryRawUnsafe(
    `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at, migration_name`
  );
  const applied = migrationRows
    .filter((row) => row.finished_at && !row.rolled_back_at)
    .map((row) => String(row.migration_name));
  const local = candidateMigrationNames();
  const appliedSet = new Set(applied);
  const localSet = new Set(local);
  const pending = local.filter((name) => !appliedSet.has(name));
  const unexpected = applied.filter((name) => !localSet.has(name));
  const expectedApplied = migrationRows.filter((row) => String(row.migration_name) === EXPECTED_MIGRATION && row.finished_at && !row.rolled_back_at).length;

  const schema = (await tx.$queryRawUnsafe(`
    SELECT
      EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='registration_requests') AS table_present,
      EXISTS(SELECT 1 FROM pg_type WHERE typname='RegistrationRequestStatus' AND typtype='e') AS enum_present
  `))[0];
  const activationRows = await tx.$queryRawUnsafe(`SELECT value FROM system_settings WHERE key=$1`, ACTIVATION_KEY);

  const fingerprints = {};
  for (const table of TABLES) fingerprints[table] = await tableFingerprint(tx, table);

  return {
    counts: {
      users: num(countsRow.users),
      employees: num(countsRow.employees),
      registrationRequests: num(countsRow.registration_requests),
      refreshSessions: num(countsRow.refresh_sessions),
      auditLogs: num(countsRow.audit_logs),
      lifecycleEvents: num(countsRow.lifecycle_events),
      leaveQuotas: num(countsRow.leave_quotas),
      leaveRequests: num(countsRow.leave_requests),
      shiftAssignments: num(countsRow.shift_assignments),
      systemSettings: num(countsRow.system_settings),
      employeeLicenses: num(countsRow.employee_licenses),
      licenseDocuments: num(countsRow.license_documents),
      migrations: num(countsRow.migrations)
    },
    links: {
      usersLinkedToEmployee: num(links.linked_users),
      employeesLinkedToUser: num(links.linked_employees),
      conflicts: num(links.linkage_conflicts)
    },
    dueLifecycleEvents: num(due.due),
    activation: activationRows.length === 1 && activationRows[0].value === 'true' ? 'ACTIVE' : 'INACTIVE',
    schema: {
      registrationRequests: Boolean(schema.table_present),
      registrationRequestStatus: Boolean(schema.enum_present)
    },
    migrations: {
      appliedCount: applied.length,
      candidateCount: local.length,
      expectedApplied,
      pending,
      unexpected
    },
    fingerprints
  };
}

async function fixtureRows(tx) {
  const emails = ROLES.map((role) => String(process.env[`UAT_${role}_EMAIL`] || '').trim().toLowerCase());
  if (emails.some((email) => !email)) fail('G04_AUTH_FIXTURE_EMAIL_MISSING');
  return tx.$queryRawUnsafe(`
    SELECT id::text, lower(email) AS email, role::text, password_hash, token_version,
           is_active, account_status::text, password_reset_required, employee_id::text
    FROM users
    WHERE lower(email) IN ($1, $2, $3)
  `, ...emails);
}

async function readOnly({ includeFixtures = false } = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const readOnly = await tx.$queryRawUnsafe('SHOW transaction_read_only');
    const isolation = await tx.$queryRawUnsafe('SHOW transaction_isolation');
    if (String(readOnly[0]?.transaction_read_only).toLowerCase() !== 'on') fail('G04_AUTH_READ_ONLY_FAILED');
    const snapshot = await readSnapshot(tx);
    const fixtures = includeFixtures ? await fixtureRows(tx) : [];
    const txid = await tx.$queryRawUnsafe('SELECT txid_current_if_assigned()::text AS txid');
    if (txid[0]?.txid !== null) fail('G04_AUTH_READ_ONLY_TXID_ASSIGNED');
    snapshot.readOnly = {
      transactionReadOnly: 'on',
      isolation: String(isolation[0]?.transaction_isolation || ''),
      transactionIdAssigned: null
    };
    return { snapshot, fixtures };
  }, { maxWait: 10000, timeout: 90000 });
}

function assertCore(snapshot) {
  if (snapshot.counts.registrationRequests !== 0) fail('G04_AUTH_REGISTRATION_REQUEST_NOT_EMPTY');
  if (snapshot.counts.migrations !== 18 || snapshot.migrations.appliedCount !== 18 || snapshot.migrations.candidateCount !== 18) fail('G04_AUTH_MIGRATION_COUNT_INVALID');
  if (snapshot.migrations.expectedApplied !== 1 || snapshot.migrations.pending.length !== 0 || snapshot.migrations.unexpected.length !== 0) fail('G04_AUTH_MIGRATION_STATE_INVALID');
  if (!snapshot.schema.registrationRequests || !snapshot.schema.registrationRequestStatus) fail('G04_AUTH_SCHEMA_MISSING');
  if (snapshot.links.conflicts !== 0) fail('G04_AUTH_LINKAGE_CONFLICT');
  if (snapshot.dueLifecycleEvents !== 0) fail('G04_AUTH_DUE_LIFECYCLE_EVENT_PRESENT');
  if (snapshot.activation !== 'ACTIVE') fail('G04_AUTH_G03_1_ACTIVATION_CHANGED');
  if (snapshot.readOnly.transactionReadOnly !== 'on' || snapshot.readOnly.isolation.toLowerCase() !== 'repeatable read') fail('G04_AUTH_SNAPSHOT_NOT_READ_ONLY');
}

function parseRuntimeAuthConfig() {
  const file = process.env.G04_RUNTIME_ENV_FILE;
  if (!file || !fs.existsSync(file)) fail('G04_AUTH_RUNTIME_ENV_FILE_MISSING');
  const parsed = dotenv.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed.JWT_SECRET || parsed.JWT_SECRET.length < 32) fail('G04_AUTH_JWT_SECRET_MISSING');
  if ((parsed.JWT_ALGORITHM || 'HS256') !== 'HS256') fail('G04_AUTH_JWT_ALGORITHM_UNEXPECTED');
  return {
    secret: parsed.JWT_SECRET,
    algorithm: 'HS256',
    issuer: parsed.JWT_ISSUER || 'smsv3-api',
    audience: parsed.JWT_AUDIENCE || 'smsv3-clients'
  };
}

async function verifyFixturesAndMint(fixtures) {
  if (fixtures.length !== 3) fail('G04_AUTH_FIXTURE_COUNT_INVALID');
  const authConfig = parseRuntimeAuthConfig();
  const sessions = {};
  for (const role of ROLES) {
    const email = String(process.env[`UAT_${role}_EMAIL`] || '').trim().toLowerCase();
    const password = String(process.env[`UAT_${role}_PASSWORD`] || '');
    if (!password) fail('G04_AUTH_FIXTURE_PASSWORD_MISSING');
    const row = fixtures.find((candidate) => String(candidate.email) === email);
    if (!row) fail(`G04_AUTH_${role}_FIXTURE_NOT_FOUND`);
    if (String(row.role) !== role) fail(`G04_AUTH_${role}_ROLE_MISMATCH`);
    if (row.is_active !== true || String(row.account_status) !== 'ACTIVE' || row.password_reset_required === true) fail(`G04_AUTH_${role}_NOT_ACTIVE`);
    if (!(await bcrypt.compare(password, String(row.password_hash)))) fail(`G04_AUTH_${role}_PASSWORD_MISMATCH`);
    const accessToken = jwt.sign({
      sub: String(row.id),
      email,
      role,
      tokenVersion: Number(row.token_version)
    }, authConfig.secret, {
      algorithm: authConfig.algorithm,
      issuer: authConfig.issuer,
      audience: authConfig.audience,
      expiresIn: '10m'
    });
    sessions[role] = { accessToken, user: { id: String(row.id), email, displayName: `G04 UAT ${role}`, role } };
  }
  writeRoleSessions(sessions);
  console.log('G04_AUTH_FIXTURE_CREDENTIALS=VALID');
  console.log('G04_AUTH_SESSION_SOURCE=READ_ONLY_MINTED_JWT');
  console.log('G04_AUTH_LOGIN_ENDPOINT_CALLS=0');
}

async function main() {
  const mode = String(process.argv[2] || '').toLowerCase();
  if (!['pre', 'check'].includes(mode)) fail('G04_AUTH_STATE_MODE_INVALID');
  const { snapshot, fixtures } = await readOnly({ includeFixtures: mode === 'pre' });
  assertCore(snapshot);
  if (mode === 'pre') {
    await verifyFixturesAndMint(fixtures);
    fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
    console.log('G04_AUTH_PRE_SNAPSHOT=' + JSON.stringify({ counts: snapshot.counts, links: snapshot.links, dueLifecycleEvents: snapshot.dueLifecycleEvents, activation: snapshot.activation, schema: snapshot.schema, migrations: snapshot.migrations, readOnly: snapshot.readOnly }));
    return;
  }
  const before = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (JSON.stringify(snapshot.counts) !== JSON.stringify(before.counts)) fail('G04_FOCUSED_AUTH_BUSINESS_WRITE_DETECTED_COUNTS');
  if (JSON.stringify(snapshot.links) !== JSON.stringify(before.links)) fail('G04_FOCUSED_AUTH_BUSINESS_WRITE_DETECTED_LINKS');
  if (JSON.stringify(snapshot.fingerprints) !== JSON.stringify(before.fingerprints)) fail('G04_FOCUSED_AUTH_BUSINESS_WRITE_DETECTED_FINGERPRINTS');
  if (snapshot.dueLifecycleEvents !== before.dueLifecycleEvents) fail('G04_FOCUSED_AUTH_BUSINESS_WRITE_DETECTED_LIFECYCLE');
  console.log('G04_AUTH_ZERO_WRITE_GUARD=PASS');
  console.log('G04_AUTH_POST_SNAPSHOT=' + JSON.stringify({ counts: snapshot.counts, links: snapshot.links, dueLifecycleEvents: snapshot.dueLifecycleEvents, activation: snapshot.activation, schema: snapshot.schema, migrations: snapshot.migrations, readOnly: snapshot.readOnly }));
}

main()
  .catch((error) => {
    console.error('G04_FOCUSED_AUTH_STATE_FAILED=' + String(error.code || error.message || 'UNKNOWN'));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
