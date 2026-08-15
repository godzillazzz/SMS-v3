'use strict';

const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { validateTargetScope } = require('../../e2e/helpers/uat-target-contract');

const FIXTURE_CLASS = 'DISPOSABLE_UAT_EMPLOYEE_V1';
const FIXTURE_CONFIRMATION = 'MUTATE_SMS_V3_DISPOSABLE_UAT_EMPLOYEE_V1';
const FIXTURE_EMPLOYEE_CODE = 'ZZZ-UAT-DISPOSABLE-V1';
const FIXTURE_LEGACY_EMPLOYEE_ID = 'UAT-DISPOSABLE-EMPLOYEE-V1';
const FIXTURE_USER_EMAIL = 'uat-disposable-employee-v1@example.invalid';
const FIXTURE_LEGACY_USER_ID = 'UAT-DISPOSABLE-EMPLOYEE-V1';
const FIXTURE_SKILL_MARKER = 'UAT_AUTOMATION_FIXTURE_V1';
const FIXTURE_HIRED_AT = new Date('2026-01-01T00:00:00.000Z');
const RESET_TRANSACTION_OPTIONS = { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 };

const DISPOSABLE_UAT_EMPLOYEE_BASELINE = Object.freeze({
  employeeCode: FIXTURE_EMPLOYEE_CODE,
  firstName: 'UAT',
  lastName: 'DisposableV1',
  displayName: 'UAT DisposableV1',
  department: 'UAT Fixture Alpha',
  jobTitle: 'UAT Fixture Officer',
  isActive: true,
  legacyEmployeeId: FIXTURE_LEGACY_EMPLOYEE_ID,
  skill: FIXTURE_SKILL_MARKER,
  hiredAt: FIXTURE_HIRED_AT
});

const DISPOSABLE_UAT_EMPLOYEE_MUTATIONS = Object.freeze({
  NAME_CHANGE: Object.freeze({ firstName: 'UAT', lastName: 'LifecycleV1', displayName: 'UAT LifecycleV1' }),
  DEPARTMENT_TRANSFER: Object.freeze({ department: 'UAT Fixture Beta' }),
  POSITION_CHANGE: Object.freeze({ jobTitle: 'UAT Fixture Supervisor' })
});

const ALLOWED_NAMES = new Set([
  DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName,
  DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.displayName
]);
const ALLOWED_DEPARTMENTS = new Set([
  DISPOSABLE_UAT_EMPLOYEE_BASELINE.department,
  DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.DEPARTMENT_TRANSFER.department
]);
const ALLOWED_POSITIONS = new Set([
  DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle,
  DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.POSITION_CHANGE.jobTitle
]);

function fixtureError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function dateKey(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

function parseDatabaseTarget(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(String(databaseUrl || ''));
  } catch {
    throw fixtureError('UAT_EMPLOYEE_DATABASE_TARGET_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw fixtureError('UAT_EMPLOYEE_DATABASE_TARGET_INVALID');
  return {
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, '')
  };
}

function assertExecutionContext(environment = process.env) {
  const mode = String(environment.UAT_DISPOSABLE_EMPLOYEE_MODE || '').trim();
  if (!['isolated-test', 'shared-approved'].includes(mode)) throw fixtureError('UAT_EMPLOYEE_EXECUTION_MODE_REQUIRED');
  const target = parseDatabaseTarget(environment.DATABASE_URL);
  if (mode === 'isolated-test') {
    const localHost = ['127.0.0.1', 'host.docker.internal'].includes(target.host);
    const localPort = target.port === '5433' || (target.port === '5432' && environment.TEST_DATABASE_RUNNER === 'docker-container-network');
    if (
      environment.NODE_ENV !== 'test'
      || environment.RUN_INTEGRATION_TESTS !== 'true'
      || target.database !== 'sms_v3_test'
      || !localHost
      || !localPort
    ) throw fixtureError('UAT_EMPLOYEE_DATABASE_TARGET_REJECTED');
    return { mode, targetClass: 'isolated-test' };
  }

  if (mode === 'shared-approved') {
    if (environment.GITHUB_ACTIONS !== 'true') throw fixtureError('UAT_EMPLOYEE_SHARED_EXECUTION_REJECTED');
    if (environment.UAT_MODE !== 'authenticated') throw fixtureError('UAT_EMPLOYEE_SHARED_EXECUTION_REJECTED');
    if (environment.UAT_DISPOSABLE_EMPLOYEE_CONFIRM !== FIXTURE_CONFIRMATION) throw fixtureError('UAT_EMPLOYEE_CONFIRMATION_REQUIRED');
    if (!/^dpl_[A-Za-z0-9]+$/.test(String(environment.UAT_EXPECTED_DEPLOYMENT_ID || ''))) throw fixtureError('UAT_EMPLOYEE_DEPLOYMENT_IDENTITY_REQUIRED');
    if (!/^[0-9a-f]{40}$/i.test(String(environment.UAT_SOURCE_SHA || ''))) throw fixtureError('UAT_EMPLOYEE_APPLICATION_IDENTITY_REQUIRED');
    if (!/^[0-9a-f]{40}$/i.test(String(environment.UAT_HARNESS_SHA || ''))) throw fixtureError('UAT_EMPLOYEE_HARNESS_IDENTITY_REQUIRED');
    let scope;
    try {
      const base = String(environment.UAT_BASE_URL || '');
      const host = new URL(base).hostname.toLowerCase();
      const targetMode = host === 'sms-v3-staging-ten.vercel.app' ? 'canonical' : 'candidate';
      scope = validateTargetScope(targetMode, base);
    } catch {
      throw fixtureError('UAT_EMPLOYEE_TARGET_SCOPE_REJECTED');
    }
    if (['127.0.0.1', 'localhost', 'host.docker.internal'].includes(target.host) || ['sms_v3_test', 'sms_v3_dev', 'smsv3_test'].includes(target.database)) {
      throw fixtureError('UAT_EMPLOYEE_SHARED_DATABASE_TARGET_INVALID');
    }
    return { mode, targetClass: 'shared-production', targetMode: scope.mode };
  }

  throw fixtureError('UAT_EMPLOYEE_EXECUTION_MODE_REQUIRED');
}

function assertEmployeeIdentity(employee) {
  if (!employee) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (
    employee.employeeCode !== FIXTURE_EMPLOYEE_CODE
    || employee.legacyEmployeeId !== FIXTURE_LEGACY_EMPLOYEE_ID
    || employee.skill !== FIXTURE_SKILL_MARKER
    || employee.email !== null
    || employee.phone !== null
    || dateKey(employee.hiredAt) !== dateKey(FIXTURE_HIRED_AT)
    || employee.deletedAt !== null
    || employee.deletedByUserId !== null
  ) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');

  const displayName = employee.displayName || `${employee.firstName} ${employee.lastName}`.trim();
  if (!ALLOWED_NAMES.has(displayName)) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (!ALLOWED_DEPARTMENTS.has(employee.department)) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (!ALLOWED_POSITIONS.has(employee.jobTitle)) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (typeof employee.isActive !== 'boolean') throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  return true;
}

function assertLinkedUserIdentity(user, employeeId) {
  if (!user) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (
    user.email !== FIXTURE_USER_EMAIL
    || user.legacyUserId !== FIXTURE_LEGACY_USER_ID
    || user.employeeId !== employeeId
    || user.role !== 'VIEWER'
  ) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (!ALLOWED_NAMES.has(user.displayName)) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (!ALLOWED_DEPARTMENTS.has(user.department)) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (!['ACTIVE', 'SUSPENDED'].includes(user.accountStatus)) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (typeof user.isActive !== 'boolean') throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  return true;
}

async function findFixtureRecords(client) {
  const [byCode, byLegacy, userByEmail, userByLegacy] = await Promise.all([
    client.employee.findUnique({ where: { employeeCode: FIXTURE_EMPLOYEE_CODE } }),
    client.employee.findUnique({ where: { legacyEmployeeId: FIXTURE_LEGACY_EMPLOYEE_ID } }),
    client.user.findUnique({ where: { email: FIXTURE_USER_EMAIL } }),
    client.user.findUnique({ where: { legacyUserId: FIXTURE_LEGACY_USER_ID } })
  ]);
  const employeeIds = new Set([byCode?.id, byLegacy?.id].filter(Boolean));
  const userIds = new Set([userByEmail?.id, userByLegacy?.id].filter(Boolean));
  if (employeeIds.size > 1 || userIds.size > 1) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  const employee = byCode || byLegacy || null;
  const user = userByEmail || userByLegacy || null;
  if (!employee && user) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  if (employee) assertEmployeeIdentity(employee);
  if (employee && user) assertLinkedUserIdentity(user, employee.id);
  if (employee && !user) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  return { employee, user };
}

async function dependencyCounts(client, employeeId) {
  const [leaveRequests, leaveQuotas, shiftAssignments, licenses, licenseDocuments] = await Promise.all([
    client.leaveRequest.count({ where: { employeeId } }),
    client.leaveQuota.count({ where: { employeeId } }),
    client.shiftAssignment.count({ where: { employeeId } }),
    client.employeeLicense.count({ where: { employeeId } }),
    client.employeeLicenseDocument.count({ where: { employeeId } })
  ]);
  return { leaveRequests, leaveQuotas, shiftAssignments, licenses, licenseDocuments };
}

function assertNoBusinessDependencies(counts) {
  if (Object.values(counts).some((count) => count !== 0)) throw fixtureError('UAT_EMPLOYEE_DEPENDENCY_MISMATCH');
}

function isExpectedLifecycleAudit(row, eventIds, employeeId) {
  if (row.entityType === 'EmployeeLifecycleEvent') {
    return row.action === 'CREATE' && eventIds.has(row.entityId);
  }
  if (row.entityType === 'Employee' && row.entityId === employeeId) {
    const lifecycleEventId = row.metadata && typeof row.metadata === 'object' ? row.metadata.lifecycleEventId : null;
    return row.action === 'UPDATE' && eventIds.has(lifecycleEventId);
  }
  if (row.entityType === 'DisposableUatEmployeeFixture' && row.entityId === employeeId) {
    return ['CREATE', 'UPDATE'].includes(row.action) && row.metadata?.fixtureClass === FIXTURE_CLASS;
  }
  return false;
}

async function assertResettableAuditScope(client, employeeId, events) {
  const eventIds = new Set(events.map((event) => event.id));
  const rows = await client.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'Employee', entityId: employeeId },
        { entityType: 'EmployeeLifecycleEvent', entityId: { in: [...eventIds] } },
        { entityType: 'DisposableUatEmployeeFixture', entityId: employeeId }
      ]
    },
    select: { id: true, action: true, entityType: true, entityId: true, metadata: true }
  });
  if (rows.some((row) => !isExpectedLifecycleAudit(row, eventIds, employeeId))) throw fixtureError('UAT_EMPLOYEE_AUDIT_SCOPE_MISMATCH');
  return rows;
}

function baselineEmployeeData() {
  return {
    employeeCode: FIXTURE_EMPLOYEE_CODE,
    firstName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.firstName,
    lastName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.lastName,
    displayName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName,
    email: null,
    phone: null,
    department: DISPOSABLE_UAT_EMPLOYEE_BASELINE.department,
    jobTitle: DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle,
    hiredAt: FIXTURE_HIRED_AT,
    isActive: true,
    deletedAt: null,
    deletedByUserId: null,
    legacyEmployeeId: FIXTURE_LEGACY_EMPLOYEE_ID,
    skill: FIXTURE_SKILL_MARKER
  };
}

function baselineUserData(employeeId, passwordHash) {
  return {
    email: FIXTURE_USER_EMAIL,
    passwordHash,
    displayName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName,
    role: 'VIEWER',
    isActive: true,
    tokenVersion: 0,
    lastLoginAt: null,
    failedLoginCount: 0,
    legacyUserId: FIXTURE_LEGACY_USER_ID,
    employeeId,
    legacyRole: 'UAT_FIXTURE',
    accountStatus: 'ACTIVE',
    passwordResetRequired: false,
    employmentSuspendedAt: null,
    department: DISPOSABLE_UAT_EMPLOYEE_BASELINE.department,
    requestedAt: null,
    approvedByLegacyRef: null,
    approvedAt: null,
    rejectionReason: null,
    legacyUpdatedAt: null
  };
}

async function resetInsideTransaction(tx, { actorUserId = null, faultInjector } = {}) {
  const { employee, user } = await findFixtureRecords(tx);
  if (!employee || !user) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  const counts = await dependencyCounts(tx, employee.id);
  assertNoBusinessDependencies(counts);
  const events = await tx.employeeLifecycleEvent.findMany({ where: { employeeId: employee.id }, orderBy: { sequence: 'asc' } });
  await assertResettableAuditScope(tx, employee.id, events);
  const eventIds = events.map((event) => event.id);

  if (eventIds.length) {
    await tx.auditLog.deleteMany({ where: { entityType: 'EmployeeLifecycleEvent', entityId: { in: eventIds } } });
    await tx.auditLog.deleteMany({ where: { entityType: 'Employee', entityId: employee.id } });
    await tx.employeeLifecycleEvent.deleteMany({ where: { employeeId: employee.id } });
  }
  await tx.refreshSession.deleteMany({ where: { userId: user.id } });
  await tx.authOtpChallenge.deleteMany({ where: { userId: user.id } });
  await tx.employee.update({ where: { id: employee.id }, data: baselineEmployeeData() });
  if (faultInjector) await faultInjector('after-employee-reset', { employeeId: employee.id, userId: user.id });
  await tx.user.update({
    where: { id: user.id },
    data: {
      displayName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName,
      department: DISPOSABLE_UAT_EMPLOYEE_BASELINE.department,
      role: 'VIEWER',
      isActive: true,
      tokenVersion: 0,
      lastLoginAt: null,
      failedLoginCount: 0,
      accountStatus: 'ACTIVE',
      passwordResetRequired: false,
      employmentSuspendedAt: null,
      requestedAt: null,
      approvedByLegacyRef: null,
      approvedAt: null,
      rejectionReason: null,
      legacyUpdatedAt: null
    }
  });
  await tx.auditLog.deleteMany({ where: { entityType: 'DisposableUatEmployeeFixture', entityId: employee.id } });
  await tx.auditLog.create({
    data: {
      actorUserId,
      action: 'UPDATE',
      entityType: 'DisposableUatEmployeeFixture',
      entityId: employee.id,
      metadata: { fixtureClass: FIXTURE_CLASS, employeeCode: FIXTURE_EMPLOYEE_CODE, baseline: 'RESTORED' }
    }
  });
  return { employeeId: employee.id, userId: user.id, counts, removedLifecycleEvents: eventIds.length };
}

async function prepareDisposableUatEmployee({ prismaClient, environment = process.env, actorUserId = null, faultInjector } = {}) {
  assertExecutionContext(environment);
  return prismaClient.$transaction(async (tx) => {
    const found = await findFixtureRecords(tx);
    if (found.employee) {
      await resetInsideTransaction(tx, { actorUserId, faultInjector });
      return assertDisposableUatEmployeeBaseline({ prismaClient: tx, environment, skipContextCheck: true });
    }

    const passwordHash = await bcrypt.hash(`${FIXTURE_CLASS}:${randomUUID()}`, 12);
    const employee = await tx.employee.create({ data: baselineEmployeeData() });
    await tx.user.create({ data: baselineUserData(employee.id, passwordHash) });
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'CREATE',
        entityType: 'DisposableUatEmployeeFixture',
        entityId: employee.id,
        metadata: { fixtureClass: FIXTURE_CLASS, employeeCode: FIXTURE_EMPLOYEE_CODE, baseline: 'CREATED' }
      }
    });
    return assertDisposableUatEmployeeBaseline({ prismaClient: tx, environment, skipContextCheck: true });
  }, RESET_TRANSACTION_OPTIONS);
}

async function resetDisposableUatEmployee({ prismaClient, environment = process.env, actorUserId = null, faultInjector } = {}) {
  assertExecutionContext(environment);
  return prismaClient.$transaction(async (tx) => {
    await resetInsideTransaction(tx, { actorUserId, faultInjector });
    return assertDisposableUatEmployeeBaseline({ prismaClient: tx, environment, skipContextCheck: true });
  }, RESET_TRANSACTION_OPTIONS);
}

async function assertDisposableUatEmployeeBaseline({ prismaClient, environment = process.env, skipContextCheck = false } = {}) {
  if (!skipContextCheck) assertExecutionContext(environment);
  const { employee, user } = await findFixtureRecords(prismaClient);
  if (!employee || !user) throw fixtureError('UAT_EMPLOYEE_IDENTITY_MISMATCH');
  const counts = await dependencyCounts(prismaClient, employee.id);
  assertNoBusinessDependencies(counts);
  const eventCount = await prismaClient.employeeLifecycleEvent.count({ where: { employeeId: employee.id } });
  const baselineMatches =
    employee.firstName === DISPOSABLE_UAT_EMPLOYEE_BASELINE.firstName
    && employee.lastName === DISPOSABLE_UAT_EMPLOYEE_BASELINE.lastName
    && employee.displayName === DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName
    && employee.department === DISPOSABLE_UAT_EMPLOYEE_BASELINE.department
    && employee.jobTitle === DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle
    && employee.isActive === true
    && user.displayName === DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName
    && user.department === DISPOSABLE_UAT_EMPLOYEE_BASELINE.department
    && user.isActive === true
    && user.accountStatus === 'ACTIVE'
    && user.employmentSuspendedAt === null
    && user.tokenVersion === 0
    && eventCount === 0;
  if (!baselineMatches) throw fixtureError('UAT_EMPLOYEE_BASELINE_MISMATCH');
  return {
    fixtureClass: FIXTURE_CLASS,
    employeeCode: FIXTURE_EMPLOYEE_CODE,
    state: 'ACTIVE_BASELINE',
    linkedUser: true,
    lifecycleEvents: eventCount,
    dependencies: counts
  };
}

function createPrismaClient(databaseUrl) {
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function resolveActorUserId(client, environment) {
  const email = String(environment.UAT_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return null;
  const user = await client.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user || user.role !== 'ADMIN') throw fixtureError('UAT_EMPLOYEE_ACTOR_IDENTITY_MISMATCH');
  return user.id;
}

async function main() {
  const command = String(process.argv[2] || '').trim().toLowerCase();
  if (!['prepare', 'reset', 'assert'].includes(command)) throw fixtureError('UAT_EMPLOYEE_COMMAND_INVALID');
  let prisma;
  try {
    assertExecutionContext(process.env);
    prisma = createPrismaClient(process.env.DATABASE_URL);
    const actorUserId = await resolveActorUserId(prisma, process.env);
    const result = command === 'prepare'
      ? await prepareDisposableUatEmployee({ prismaClient: prisma, actorUserId })
      : command === 'reset'
        ? await resetDisposableUatEmployee({ prismaClient: prisma, actorUserId })
        : await assertDisposableUatEmployeeBaseline({ prismaClient: prisma });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error?.code || 'UAT_EMPLOYEE_FIXTURE_FAILED');
    process.exitCode = 1;
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

if (require.main === module) main();

module.exports = {
  DISPOSABLE_UAT_EMPLOYEE_BASELINE,
  DISPOSABLE_UAT_EMPLOYEE_MUTATIONS,
  FIXTURE_CLASS,
  FIXTURE_CONFIRMATION,
  FIXTURE_EMPLOYEE_CODE,
  FIXTURE_LEGACY_EMPLOYEE_ID,
  FIXTURE_LEGACY_USER_ID,
  FIXTURE_SKILL_MARKER,
  FIXTURE_USER_EMAIL,
  assertDisposableUatEmployeeBaseline,
  assertEmployeeIdentity,
  assertExecutionContext,
  assertLinkedUserIdentity,
  dependencyCounts,
  prepareDisposableUatEmployee,
  resetDisposableUatEmployee
};
