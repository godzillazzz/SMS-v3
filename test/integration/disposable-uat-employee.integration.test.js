'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const {
  DISPOSABLE_UAT_EMPLOYEE_BASELINE,
  DISPOSABLE_UAT_EMPLOYEE_MUTATIONS,
  FIXTURE_CLASS,
  FIXTURE_EMPLOYEE_CODE,
  FIXTURE_LEGACY_EMPLOYEE_ID,
  FIXTURE_USER_EMAIL,
  assertDisposableUatEmployeeBaseline,
  prepareDisposableUatEmployee,
  resetDisposableUatEmployee
} = require('../../scripts/admin/disposable-uat-employee');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('Disposable UAT Employee PostgreSQL integration is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  const target = new URL(process.env.DATABASE_URL || '');
  const dbName = target.pathname.replace(/^\//, '');
  const approvedHost = ['127.0.0.1', 'host.docker.internal'].includes(target.hostname);
  const approvedPort = target.port === '5433' || (target.port === '5432' && process.env.TEST_DATABASE_RUNNER === 'docker-container-network');
  if (dbName !== 'sms_v3_test' || !approvedHost || !approvedPort) {
    throw new Error('Disposable UAT Employee integration requires the isolated sms_v3_test database.');
  }

  const applicationRoot = path.resolve(String(process.env.UAT_APPLICATION_ROOT || ''));
  const expectedApplicationSha = String(process.env.UAT_APPLICATION_SHA_UNDER_TEST || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedApplicationSha)) throw new Error('Disposable UAT Employee integration requires an exact application SHA.');
  const applicationHead = execFileSync('git', ['-C', applicationRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim().toLowerCase();
  if (applicationHead !== expectedApplicationSha) throw new Error('Disposable UAT Employee application checkout identity mismatch.');

  const prisma = require(path.join(applicationRoot, 'src/config/prisma'));
  const lifecycle = require(path.join(applicationRoot, 'src/services/employee-lifecycle.service'));
  const actorId = 'd1a00000-0000-4000-8000-000000000001';
  const unrelatedEmployeeId = 'd1a00000-0000-4000-8000-000000000002';
  const unrelatedUserId = 'd1a00000-0000-4000-8000-000000000003';
  const unrelatedEventId = 'd1a00000-0000-4000-8000-000000000004';
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    RUN_INTEGRATION_TESTS: 'true',
    UAT_DISPOSABLE_EMPLOYEE_MODE: 'isolated-test'
  };

  async function cleanupKnownRows() {
    const fixture = await prisma.employee.findUnique({ where: { employeeCode: FIXTURE_EMPLOYEE_CODE } });
    if (fixture) {
      const fixtureEvents = await prisma.employeeLifecycleEvent.findMany({ where: { employeeId: fixture.id }, select: { id: true } });
      const fixtureEventIds = fixtureEvents.map((row) => row.id);
      if (fixtureEventIds.length) await prisma.auditLog.deleteMany({ where: { entityType: 'EmployeeLifecycleEvent', entityId: { in: fixtureEventIds } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: 'Employee', entityId: fixture.id }, { entityType: 'DisposableUatEmployeeFixture', entityId: fixture.id }] } });
      await prisma.employeeLifecycleEvent.deleteMany({ where: { employeeId: fixture.id } });
      const fixtureUser = await prisma.user.findUnique({ where: { email: FIXTURE_USER_EMAIL } });
      if (fixtureUser) {
        await prisma.refreshSession.deleteMany({ where: { userId: fixtureUser.id } });
        await prisma.authOtpChallenge.deleteMany({ where: { userId: fixtureUser.id } });
        await prisma.user.delete({ where: { id: fixtureUser.id } });
      }
      await prisma.employee.delete({ where: { id: fixture.id } });
    }

    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: actorId }, { entityId: { in: [unrelatedEmployeeId, unrelatedEventId] } }] } });
    await prisma.employeeLifecycleEvent.deleteMany({ where: { OR: [{ employeeId: unrelatedEmployeeId }, { changedByUserId: actorId }] } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [actorId, unrelatedUserId] } } });
    await prisma.authOtpChallenge.deleteMany({ where: { userId: { in: [actorId, unrelatedUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [unrelatedUserId, actorId] } } });
    await prisma.employee.deleteMany({ where: { id: unrelatedEmployeeId } });
  }

  async function seedUnrelatedProtectionRows() {
    await prisma.user.create({
      data: {
        id: actorId,
        email: 'uat-disposable-actor-v1@example.invalid',
        passwordHash: await bcrypt.hash(`actor-${randomUUID()}`, 4),
        displayName: 'UAT Disposable Actor',
        role: 'ADMIN',
        isActive: true,
        accountStatus: 'ACTIVE',
        passwordResetRequired: false,
        employeeId: null,
        legacyUserId: 'UAT-DISPOSABLE-ACTOR-V1'
      }
    });
    await prisma.employee.create({
      data: {
        id: unrelatedEmployeeId,
        employeeCode: 'ZZZ-UAT-UNRELATED-GUARD-V1',
        firstName: 'UAT',
        lastName: 'UnrelatedGuard',
        displayName: 'UAT UnrelatedGuard',
        department: 'UAT Guard Department',
        jobTitle: 'UAT Guard Position',
        isActive: true,
        legacyEmployeeId: 'UAT-UNRELATED-GUARD-V1',
        skill: 'UAT_UNRELATED_GUARD_V1'
      }
    });
    await prisma.user.create({
      data: {
        id: unrelatedUserId,
        email: 'uat-unrelated-guard-v1@example.invalid',
        passwordHash: await bcrypt.hash(`unrelated-${randomUUID()}`, 4),
        displayName: 'UAT UnrelatedGuard',
        role: 'VIEWER',
        isActive: true,
        accountStatus: 'ACTIVE',
        passwordResetRequired: false,
        employeeId: unrelatedEmployeeId,
        legacyUserId: 'UAT-UNRELATED-USER-GUARD-V1',
        department: 'UAT Guard Department'
      }
    });
    const snapshot = {
      employee: {
        firstName: 'UAT', lastName: 'UnrelatedGuard', displayName: 'UAT UnrelatedGuard',
        department: 'UAT Guard Department', jobTitle: 'UAT Guard Position', isActive: true, employmentStatus: 'ACTIVE'
      },
      user: {
        id: unrelatedUserId, displayName: 'UAT UnrelatedGuard', department: 'UAT Guard Department',
        isActive: true, accountStatus: 'ACTIVE', employmentSuspendedAt: null
      }
    };
    await prisma.employeeLifecycleEvent.create({
      data: {
        id: unrelatedEventId,
        employeeId: unrelatedEmployeeId,
        sequence: 1,
        type: 'NAME_CHANGE',
        status: 'APPLIED',
        effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
        oldValue: snapshot,
        newValue: snapshot,
        reason: 'Unrelated protection marker',
        changedByUserId: actorId,
        idempotencyKey: 'd1a00000-0000-4000-8000-000000000005',
        expectedEmployeeUpdatedAt: new Date(),
        appliedAt: new Date()
      }
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: actorId,
        action: 'CREATE',
        entityType: 'UnrelatedUatGuard',
        entityId: unrelatedEmployeeId,
        metadata: { marker: 'UNCHANGED' }
      }
    });
  }

  async function fixtureRecords() {
    const employee = await prisma.employee.findUnique({ where: { employeeCode: FIXTURE_EMPLOYEE_CODE } });
    assert.ok(employee);
    assert.equal(employee.legacyEmployeeId, FIXTURE_LEGACY_EMPLOYEE_ID);
    const user = await prisma.user.findUnique({ where: { email: FIXTURE_USER_EMAIL } });
    assert.ok(user);
    assert.equal(user.employeeId, employee.id);
    return { employee, user };
  }

  async function executeLifecycle(type, changes = {}) {
    const { employee } = await fixtureRecords();
    const effectiveDate = new Date().toISOString().slice(0, 10);
    const analysis = await lifecycle.preflightEmployeeLifecycleAction({ employeeId: employee.id, type, effectiveDate, changes });
    assert.deepEqual(analysis.blockingIssues, []);
    return lifecycle.createEmployeeLifecycleEvent({
      employeeId: employee.id,
      actorUserId: actorId,
      type,
      effectiveDate,
      reason: `Disposable fixture ${type}`,
      changes,
      expectedEmployeeUpdatedAt: analysis.expectedEmployeeUpdatedAt,
      expectedLifecycleSequence: analysis.latestLifecycleSequence,
      idempotencyKey: randomUUID(),
      acknowledgeWarnings: true
    });
  }

  async function unrelatedSnapshot() {
    const employee = await prisma.employee.findUnique({ where: { id: unrelatedEmployeeId } });
    const user = await prisma.user.findUnique({ where: { id: unrelatedUserId } });
    const lifecycleRows = await prisma.employeeLifecycleEvent.findMany({ where: { employeeId: unrelatedEmployeeId }, orderBy: { sequence: 'asc' } });
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'UnrelatedUatGuard', entityId: unrelatedEmployeeId }, orderBy: { id: 'asc' } });
    return {
      employee: { id: employee.id, employeeCode: employee.employeeCode, displayName: employee.displayName, department: employee.department, jobTitle: employee.jobTitle, isActive: employee.isActive },
      user: { id: user.id, email: user.email, displayName: user.displayName, department: user.department, isActive: user.isActive, accountStatus: user.accountStatus },
      lifecycle: lifecycleRows.map((row) => ({ id: row.id, sequence: row.sequence, type: row.type, status: row.status })),
      audits: audits.map((row) => ({ id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId, metadata: row.metadata }))
    };
  }

  test.before(async () => {
    await cleanupKnownRows();
    await seedUnrelatedProtectionRows();
  });

  test.after(async () => {
    await cleanupKnownRows();
    await prisma.$disconnect();
  });

  test('prepare is deterministic and idempotent and arbitrary employeeId input cannot redirect the fixture', async () => {
    const unrelatedBefore = await unrelatedSnapshot();
    const first = await prepareDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    const second = await prepareDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId, employeeId: unrelatedEmployeeId });
    assert.equal(first.fixtureClass, FIXTURE_CLASS);
    assert.equal(first.employeeCode, FIXTURE_EMPLOYEE_CODE);
    assert.deepEqual(second, first);
    assert.deepEqual(await unrelatedSnapshot(), unrelatedBefore);
    assert.equal(await prisma.employee.count({ where: { employeeCode: FIXTURE_EMPLOYEE_CODE } }), 1);
    assert.equal(await prisma.user.count({ where: { email: FIXTURE_USER_EMAIL } }), 1);
    const { employee } = await fixtureRecords();
    assert.equal(await prisma.auditLog.count({ where: { entityType: 'DisposableUatEmployeeFixture', entityId: employee.id } }), 1);
  });

  test('full lifecycle uses real Production application service, preserves linked User semantics/history/audit, and reset restores exact baseline', async () => {
    await prepareDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    const unrelatedBefore = await unrelatedSnapshot();
    let rows = await fixtureRecords();
    assert.equal(rows.employee.isActive, true);
    assert.equal(rows.user.accountStatus, 'ACTIVE');

    await executeLifecycle('NAME_CHANGE', { firstName: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.firstName, lastName: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.lastName });
    rows = await fixtureRecords();
    assert.equal(rows.employee.displayName, DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.displayName);
    assert.equal(rows.user.displayName, DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.displayName);

    await executeLifecycle('DEPARTMENT_TRANSFER', { department: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.DEPARTMENT_TRANSFER.department });
    rows = await fixtureRecords();
    assert.equal(rows.employee.department, DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.DEPARTMENT_TRANSFER.department);
    assert.equal(rows.user.department, DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.DEPARTMENT_TRANSFER.department);

    await executeLifecycle('POSITION_CHANGE', { jobTitle: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.POSITION_CHANGE.jobTitle });
    rows = await fixtureRecords();
    assert.equal(rows.employee.jobTitle, DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.POSITION_CHANGE.jobTitle);

    await executeLifecycle('EMPLOYMENT_TERMINATION');
    rows = await fixtureRecords();
    assert.equal(rows.employee.isActive, false);
    assert.equal(rows.user.isActive, false);
    assert.equal(rows.user.accountStatus, 'SUSPENDED');
    assert.ok(rows.user.employmentSuspendedAt);
    assert.equal(rows.user.tokenVersion, 1);

    await executeLifecycle('REHIRE', { department: DISPOSABLE_UAT_EMPLOYEE_BASELINE.department, jobTitle: DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle });
    rows = await fixtureRecords();
    assert.equal(rows.employee.isActive, true);
    assert.equal(rows.employee.department, DISPOSABLE_UAT_EMPLOYEE_BASELINE.department);
    assert.equal(rows.employee.jobTitle, DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle);
    assert.equal(rows.user.isActive, true);
    assert.equal(rows.user.accountStatus, 'ACTIVE');
    assert.equal(rows.user.employmentSuspendedAt, null);
    assert.equal(rows.user.department, DISPOSABLE_UAT_EMPLOYEE_BASELINE.department);
    assert.equal(rows.user.tokenVersion, 2);

    const history = await prisma.employeeLifecycleEvent.findMany({ where: { employeeId: rows.employee.id }, orderBy: { sequence: 'asc' } });
    assert.deepEqual(history.map((row) => [row.sequence, row.type, row.status]), [
      [1, 'NAME_CHANGE', 'APPLIED'],
      [2, 'DEPARTMENT_TRANSFER', 'APPLIED'],
      [3, 'POSITION_CHANGE', 'APPLIED'],
      [4, 'EMPLOYMENT_TERMINATION', 'APPLIED'],
      [5, 'REHIRE', 'APPLIED']
    ]);
    const eventIds = history.map((row) => row.id);
    const lifecycleAudits = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'Employee', entityId: rows.employee.id },
          { entityType: 'EmployeeLifecycleEvent', entityId: { in: eventIds } }
        ]
      }
    });
    assert.equal(lifecycleAudits.length, 10);
    assert.equal(lifecycleAudits.filter((row) => row.entityType === 'Employee').length, 5);
    assert.equal(lifecycleAudits.filter((row) => row.entityType === 'EmployeeLifecycleEvent').length, 5);
    assert.deepEqual(await unrelatedSnapshot(), unrelatedBefore);

    const maxSyntheticRows = 2 + 1 + history.length + lifecycleAudits.length;
    assert.equal(maxSyntheticRows, 18);

    await resetDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    const baseline = await assertDisposableUatEmployeeBaseline({ prismaClient: prisma, environment });
    assert.equal(baseline.state, 'ACTIVE_BASELINE');
    assert.equal(baseline.lifecycleEvents, 0);
    rows = await fixtureRecords();
    assert.equal(rows.employee.displayName, DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName);
    assert.equal(rows.employee.department, DISPOSABLE_UAT_EMPLOYEE_BASELINE.department);
    assert.equal(rows.employee.jobTitle, DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle);
    assert.equal(rows.employee.isActive, true);
    assert.equal(rows.user.displayName, DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName);
    assert.equal(rows.user.department, DISPOSABLE_UAT_EMPLOYEE_BASELINE.department);
    assert.equal(rows.user.accountStatus, 'ACTIVE');
    assert.equal(rows.user.tokenVersion, 0);
    assert.equal(await prisma.auditLog.count({ where: { entityType: 'DisposableUatEmployeeFixture', entityId: rows.employee.id } }), 1);
    assert.deepEqual(await unrelatedSnapshot(), unrelatedBefore);
  });

  test('reset recovers after a partial lifecycle and is idempotent when called twice', async () => {
    await prepareDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    await executeLifecycle('NAME_CHANGE', { firstName: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.firstName, lastName: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.lastName });
    await executeLifecycle('DEPARTMENT_TRANSFER', { department: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.DEPARTMENT_TRANSFER.department });
    await resetDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    const first = await assertDisposableUatEmployeeBaseline({ prismaClient: prisma, environment });
    await resetDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    const second = await assertDisposableUatEmployeeBaseline({ prismaClient: prisma, environment });
    assert.deepEqual(second, first);
  });

  test('identity mismatch and business dependency fail closed without touching unrelated data', async () => {
    await prepareDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    const unrelatedBefore = await unrelatedSnapshot();
    const { employee } = await fixtureRecords();
    await prisma.employee.update({ where: { id: employee.id }, data: { skill: 'TAMPERED' } });
    await assert.rejects(
      () => resetDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId }),
      { code: 'UAT_EMPLOYEE_IDENTITY_MISMATCH' }
    );
    await prisma.employee.update({ where: { id: employee.id }, data: { skill: 'UAT_AUTOMATION_FIXTURE_V1' } });
    await resetDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });

    const quotaId = randomUUID();
    await prisma.leaveQuota.create({
      data: {
        id: quotaId,
        sourceFingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        employeeId: employee.id,
        employeeNameSnapshot: DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName,
        sickLeave: 0,
        personalLeave: 0,
        vacationLeave: 0,
        matchStatus: 'MATCHED'
      }
    });
    await assert.rejects(
      () => resetDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId }),
      { code: 'UAT_EMPLOYEE_DEPENDENCY_MISMATCH' }
    );
    await prisma.leaveQuota.delete({ where: { id: quotaId } });
    await resetDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    assert.deepEqual(await unrelatedSnapshot(), unrelatedBefore);
  });

  test('reset is atomic: injected failure after Employee write rolls the whole reset back and a retry converges to baseline', async () => {
    await prepareDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    await executeLifecycle('POSITION_CHANGE', { jobTitle: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.POSITION_CHANGE.jobTitle });
    const before = await fixtureRecords();
    assert.equal(before.employee.jobTitle, DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.POSITION_CHANGE.jobTitle);
    await assert.rejects(
      () => resetDisposableUatEmployee({
        prismaClient: prisma,
        environment,
        actorUserId: actorId,
        faultInjector: async (stage) => {
          if (stage === 'after-employee-reset') throw new Error('synthetic reset fault');
        }
      }),
      /synthetic reset fault/
    );
    const afterFailure = await fixtureRecords();
    assert.equal(afterFailure.employee.jobTitle, DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.POSITION_CHANGE.jobTitle);
    assert.equal(await prisma.employeeLifecycleEvent.count({ where: { employeeId: afterFailure.employee.id } }), 1);
    await resetDisposableUatEmployee({ prismaClient: prisma, environment, actorUserId: actorId });
    await assertDisposableUatEmployeeBaseline({ prismaClient: prisma, environment });
  });
}
