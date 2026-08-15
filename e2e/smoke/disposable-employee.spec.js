'use strict';

const { randomUUID } = require('node:crypto');
const { test, expect } = require('../helpers/uat-test');
const { loginAs } = require('../helpers/uat-auth');
const { authenticatedRequest } = require('../helpers/uat-authenticated-request');
const {
  DISPOSABLE_UAT_EMPLOYEE_BASELINE,
  DISPOSABLE_UAT_EMPLOYEE_MUTATIONS,
  FIXTURE_EMPLOYEE_CODE,
  FIXTURE_LEGACY_EMPLOYEE_ID,
  FIXTURE_LEGACY_USER_ID,
  FIXTURE_SKILL_MARKER,
  FIXTURE_USER_EMAIL,
  assertDisposableUatEmployeeBaseline,
  prepareDisposableUatEmployee,
  resetDisposableUatEmployee
} = require('../../scripts/admin/disposable-uat-employee');

const destructiveFixtureEnabled = () =>
  process.env.UAT_MODE === 'authenticated'
  && process.env.UAT_DISPOSABLE_EMPLOYEE_ENABLED === 'true';

function createFixturePrisma() {
  if (!process.env.DATABASE_URL) throw new Error('UAT_EMPLOYEE_DATABASE_TARGET_INVALID');
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
}

async function exactFixtureEmployee(accessToken) {
  const response = await authenticatedRequest(`/api/v1/employees?page=1&pageSize=20&search=${encodeURIComponent(FIXTURE_EMPLOYEE_CODE)}`, { accessToken });
  expect(response.status).toBe(200);
  const exact = (response.payload?.data || []).filter((employee) => employee.employeeCode === FIXTURE_EMPLOYEE_CODE);
  expect(exact).toHaveLength(1);
  const employee = exact[0];
  expect(employee.legacyEmployeeId).toBe(FIXTURE_LEGACY_EMPLOYEE_ID);
  expect(employee.skill).toBe(FIXTURE_SKILL_MARKER);
  expect(employee.email).toBeNull();
  expect(employee.phone).toBeNull();
  return employee;
}

async function runLifecycle(accessToken, employeeId, type, changes = {}) {
  const effectiveDate = new Date().toISOString().slice(0, 10);
  const preflight = await authenticatedRequest(`/api/v1/employees/${employeeId}/lifecycle/preflight`, {
    accessToken,
    method: 'POST',
    data: { type, effectiveDate, changes }
  });
  expect(preflight.status, `${type} preflight must succeed.`).toBe(200);
  const analysis = preflight.payload?.data;
  expect(analysis?.employee?.id).toBe(employeeId);
  expect(analysis?.blockingIssues).toEqual([]);
  const mutation = await authenticatedRequest(`/api/v1/employees/${employeeId}/lifecycle`, {
    accessToken,
    method: 'POST',
    data: {
      type,
      effectiveDate,
      changes,
      reason: `Disposable UAT fixture ${type}`,
      expectedEmployeeUpdatedAt: analysis.expectedEmployeeUpdatedAt,
      expectedLifecycleSequence: analysis.latestLifecycleSequence,
      idempotencyKey: randomUUID(),
      acknowledgeWarnings: true
    }
  });
  expect(mutation.status, `${type} mutation must create one lifecycle event.`).toBe(201);
  return mutation.payload?.data?.event;
}

async function expectAuditEvidence(accessToken, eventIds, employeeId) {
  for (const eventId of eventIds) {
    const response = await authenticatedRequest(`/api/v1/audit-events?page=1&pageSize=10&entityType=EmployeeLifecycleEvent&search=${encodeURIComponent(eventId)}`, { accessToken });
    expect(response.status).toBe(200);
    expect((response.payload?.data || []).some((row) => row.entityType === 'EmployeeLifecycleEvent' && row.entityId === eventId)).toBe(true);
  }
  const employeeAudits = await authenticatedRequest(`/api/v1/audit-events?page=1&pageSize=25&entityType=Employee&search=${encodeURIComponent(employeeId)}`, { accessToken });
  expect(employeeAudits.status).toBe(200);
  expect((employeeAudits.payload?.data || []).filter((row) => row.entityType === 'Employee' && row.entityId === employeeId).length).toBeGreaterThanOrEqual(5);
}

test('V3 ADMIN: disposable employee full lifecycle is reversible and isolated', async ({ page }) => {
  test.skip(!destructiveFixtureEnabled(), 'Disposable employee mutation requires separate shared-data approval and explicit UAT enablement.');
  test.setTimeout(240_000);

  const prisma = createFixturePrisma();
  let prepared = false;
  try {
    await prepareDisposableUatEmployee({ prismaClient: prisma, environment: process.env });
    prepared = true;
    const { accessToken } = await loginAs(page, 'ADMIN');
    let employee = await exactFixtureEmployee(accessToken);
    const employeeId = employee.id;

    expect(employee.displayName).toBe(DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName);
    expect(employee.department).toBe(DISPOSABLE_UAT_EMPLOYEE_BASELINE.department);
    expect(employee.jobTitle).toBe(DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle);
    expect(employee.isActive).toBe(true);

    const eventIds = [];
    eventIds.push((await runLifecycle(accessToken, employeeId, 'NAME_CHANGE', {
      firstName: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.firstName,
      lastName: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.lastName
    })).id);
    employee = await exactFixtureEmployee(accessToken);
    expect(employee.displayName).toBe(DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.displayName);

    eventIds.push((await runLifecycle(accessToken, employeeId, 'DEPARTMENT_TRANSFER', {
      department: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.DEPARTMENT_TRANSFER.department
    })).id);
    employee = await exactFixtureEmployee(accessToken);
    expect(employee.department).toBe(DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.DEPARTMENT_TRANSFER.department);

    eventIds.push((await runLifecycle(accessToken, employeeId, 'POSITION_CHANGE', {
      jobTitle: DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.POSITION_CHANGE.jobTitle
    })).id);
    employee = await exactFixtureEmployee(accessToken);
    expect(employee.jobTitle).toBe(DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.POSITION_CHANGE.jobTitle);

    eventIds.push((await runLifecycle(accessToken, employeeId, 'EMPLOYMENT_TERMINATION')).id);
    employee = await exactFixtureEmployee(accessToken);
    expect(employee.isActive).toBe(false);
    let linked = await prisma.user.findUnique({ where: { email: FIXTURE_USER_EMAIL } });
    expect(linked?.legacyUserId).toBe(FIXTURE_LEGACY_USER_ID);
    expect(linked?.employeeId).toBe(employeeId);
    expect(linked?.isActive).toBe(false);
    expect(linked?.accountStatus).toBe('SUSPENDED');
    expect(linked?.employmentSuspendedAt).not.toBeNull();

    eventIds.push((await runLifecycle(accessToken, employeeId, 'REHIRE', {
      department: DISPOSABLE_UAT_EMPLOYEE_BASELINE.department,
      jobTitle: DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle
    })).id);
    employee = await exactFixtureEmployee(accessToken);
    expect(employee.isActive).toBe(true);
    linked = await prisma.user.findUnique({ where: { email: FIXTURE_USER_EMAIL } });
    expect(linked?.isActive).toBe(true);
    expect(linked?.accountStatus).toBe('ACTIVE');
    expect(linked?.employmentSuspendedAt).toBeNull();
    expect(linked?.department).toBe(DISPOSABLE_UAT_EMPLOYEE_BASELINE.department);

    const history = await authenticatedRequest(`/api/v1/employees/${employeeId}/lifecycle?page=1&pageSize=25`, { accessToken });
    expect(history.status).toBe(200);
    const ordered = [...(history.payload?.data || [])].sort((left, right) => left.sequence - right.sequence);
    expect(ordered.map((row) => row.type)).toEqual([
      'NAME_CHANGE',
      'DEPARTMENT_TRANSFER',
      'POSITION_CHANGE',
      'EMPLOYMENT_TERMINATION',
      'REHIRE'
    ]);
    expect(ordered.map((row) => row.status)).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED', 'APPLIED']);
    expect(ordered.map((row) => row.id)).toEqual(eventIds);
    await expectAuditEvidence(accessToken, eventIds, employeeId);
  } finally {
    if (prepared) await resetDisposableUatEmployee({ prismaClient: prisma, environment: process.env });
    if (prepared) await assertDisposableUatEmployeeBaseline({ prismaClient: prisma, environment: process.env });
    await prisma.$disconnect();
  }
});
