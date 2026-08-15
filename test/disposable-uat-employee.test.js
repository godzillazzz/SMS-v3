'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DISPOSABLE_UAT_EMPLOYEE_BASELINE,
  DISPOSABLE_UAT_EMPLOYEE_MUTATIONS,
  FIXTURE_CLASS,
  FIXTURE_CONFIRMATION,
  FIXTURE_EMPLOYEE_CODE,
  FIXTURE_LEGACY_EMPLOYEE_ID,
  FIXTURE_LEGACY_USER_ID,
  FIXTURE_SKILL_MARKER,
  FIXTURE_USER_EMAIL,
  assertEmployeeIdentity,
  assertExecutionContext,
  assertLinkedUserIdentity,
  prepareDisposableUatEmployee,
  resetDisposableUatEmployee
} = require('../scripts/admin/disposable-uat-employee');

const isolated = {
  NODE_ENV: 'test',
  RUN_INTEGRATION_TESTS: 'true',
  UAT_DISPOSABLE_EMPLOYEE_MODE: 'isolated-test',
  DATABASE_URL: ['postgresql:', '', 'fixture:fixture@127.0.0.1:5433', 'sms_v3_test'].join('/')
};

const shared = {
  GITHUB_ACTIONS: 'true',
  UAT_MODE: 'authenticated',
  UAT_DISPOSABLE_EMPLOYEE_MODE: 'shared-approved',
  UAT_DISPOSABLE_EMPLOYEE_CONFIRM: FIXTURE_CONFIRMATION,
  UAT_EXPECTED_DEPLOYMENT_ID: 'dpl_Example123',
  UAT_SOURCE_SHA: 'a'.repeat(40),
  UAT_HARNESS_SHA: 'b'.repeat(40),
  UAT_BASE_URL: 'https://sms-v3-staging-cjbcsf5qw-godzillazz.vercel.app',
  DATABASE_URL: ['postgresql:', '', 'fixture:fixture@db.synthetic.example:5432', 'postgres'].join('/')
};

function employeeFixture(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    employeeCode: FIXTURE_EMPLOYEE_CODE,
    firstName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.firstName,
    lastName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.lastName,
    displayName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName,
    email: null,
    phone: null,
    department: DISPOSABLE_UAT_EMPLOYEE_BASELINE.department,
    jobTitle: DISPOSABLE_UAT_EMPLOYEE_BASELINE.jobTitle,
    hiredAt: new Date('2026-01-01T00:00:00.000Z'),
    isActive: true,
    deletedAt: null,
    deletedByUserId: null,
    legacyEmployeeId: FIXTURE_LEGACY_EMPLOYEE_ID,
    skill: FIXTURE_SKILL_MARKER,
    ...overrides
  };
}

function userFixture(employeeId, overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    email: FIXTURE_USER_EMAIL,
    legacyUserId: FIXTURE_LEGACY_USER_ID,
    employeeId,
    displayName: DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName,
    department: DISPOSABLE_UAT_EMPLOYEE_BASELINE.department,
    role: 'VIEWER',
    isActive: true,
    accountStatus: 'ACTIVE',
    employmentSuspendedAt: null,
    ...overrides
  };
}

test('fixture identity is obviously synthetic, deterministic, and contains no real contact data', () => {
  assert.match(FIXTURE_EMPLOYEE_CODE, /^ZZZ-UAT-/);
  assert.match(FIXTURE_LEGACY_EMPLOYEE_ID, /^UAT-DISPOSABLE-/);
  assert.match(FIXTURE_SKILL_MARKER, /^UAT_AUTOMATION_FIXTURE_/);
  assert.equal(FIXTURE_USER_EMAIL.endsWith('.invalid'), true);
  assert.equal(DISPOSABLE_UAT_EMPLOYEE_BASELINE.displayName, 'UAT DisposableV1');
  assert.equal(DISPOSABLE_UAT_EMPLOYEE_MUTATIONS.NAME_CHANGE.displayName, 'UAT LifecycleV1');
});

test('isolated execution requires exact sms_v3_test local target and explicit test mode', () => {
  assert.deepEqual(assertExecutionContext(isolated), { mode: 'isolated-test', targetClass: 'isolated-test' });
  for (const environment of [
    { ...isolated, NODE_ENV: 'production' },
    { ...isolated, RUN_INTEGRATION_TESTS: 'false' },
    { ...isolated, DATABASE_URL: ['postgresql:', '', 'fixture:fixture@127.0.0.1:5433', 'postgres'].join('/') },
    { ...isolated, DATABASE_URL: ['postgresql:', '', 'fixture:fixture@db.synthetic.example:5432', 'sms_v3_test'].join('/') }
  ]) {
    assert.throws(() => assertExecutionContext(environment), { code: 'UAT_EMPLOYEE_DATABASE_TARGET_REJECTED' });
  }
});

test('shared mode is fail-closed behind GitHub Actions, authenticated UAT, exact release identities, target scope, and confirmation', () => {
  assert.deepEqual(assertExecutionContext(shared), { mode: 'shared-approved', targetClass: 'shared-production', targetMode: 'candidate' });
  const invalid = [
    { ...shared, GITHUB_ACTIONS: 'false' },
    { ...shared, UAT_MODE: 'technical' },
    { ...shared, UAT_DISPOSABLE_EMPLOYEE_CONFIRM: '' },
    { ...shared, UAT_EXPECTED_DEPLOYMENT_ID: 'wrong' },
    { ...shared, UAT_SOURCE_SHA: 'wrong' },
    { ...shared, UAT_HARNESS_SHA: 'wrong' },
    { ...shared, UAT_BASE_URL: 'https://example.com' },
    { ...shared, UAT_BASE_URL: 'http://sms-v3-staging-cjbcsf5qw-godzillazz.vercel.app' },
    { ...shared, DATABASE_URL: ['postgresql:', '', 'fixture:fixture@127.0.0.1:5433', 'sms_v3_test'].join('/') }
  ];
  for (const environment of invalid) assert.throws(() => assertExecutionContext(environment));
  assert.throws(() => assertExecutionContext({}), { code: 'UAT_EMPLOYEE_EXECUTION_MODE_REQUIRED' });
});

test('employee identity requires multiple immutable markers and only permits defined synthetic lifecycle states', () => {
  const baseline = employeeFixture();
  assert.equal(assertEmployeeIdentity(baseline), true);
  assert.equal(assertEmployeeIdentity(employeeFixture({ firstName: 'UAT', lastName: 'LifecycleV1', displayName: 'UAT LifecycleV1' })), true);
  assert.equal(assertEmployeeIdentity(employeeFixture({ department: 'UAT Fixture Beta' })), true);
  assert.equal(assertEmployeeIdentity(employeeFixture({ jobTitle: 'UAT Fixture Supervisor' })), true);
  assert.equal(assertEmployeeIdentity(employeeFixture({ isActive: false })), true);

  for (const bad of [
    employeeFixture({ employeeCode: 'EMP-001' }),
    employeeFixture({ legacyEmployeeId: 'REAL-001' }),
    employeeFixture({ skill: 'Officer' }),
    employeeFixture({ email: 'person@example.test' }),
    employeeFixture({ phone: '0800000000' }),
    employeeFixture({ hiredAt: new Date('2025-01-01T00:00:00.000Z') }),
    employeeFixture({ deletedAt: new Date() }),
    employeeFixture({ displayName: 'Arbitrary Person' }),
    employeeFixture({ department: 'Real Department' }),
    employeeFixture({ jobTitle: 'Real Position' })
  ]) assert.throws(() => assertEmployeeIdentity(bad), { code: 'UAT_EMPLOYEE_IDENTITY_MISMATCH' });
});

test('linked synthetic User identity is exact and cannot reuse an operator or arbitrary user', () => {
  const employee = employeeFixture();
  assert.equal(assertLinkedUserIdentity(userFixture(employee.id), employee.id), true);
  for (const bad of [
    userFixture(employee.id, { email: 'uat-admin@example.test' }),
    userFixture(employee.id, { legacyUserId: 'other' }),
    userFixture('33333333-3333-4333-8333-333333333333'),
    userFixture(employee.id, { role: 'ADMIN' }),
    userFixture(employee.id, { displayName: 'Other User' }),
    userFixture(employee.id, { department: 'Real Department' }),
    userFixture(employee.id, { accountStatus: 'PENDING' })
  ]) assert.throws(() => assertLinkedUserIdentity(bad, employee.id), { code: 'UAT_EMPLOYEE_IDENTITY_MISMATCH' });
});

test('destructive fixture APIs expose no employee-id selector parameter', () => {
  assert.equal(prepareDisposableUatEmployee.length, 0);
  assert.equal(resetDisposableUatEmployee.length, 0);
  assert.doesNotMatch(prepareDisposableUatEmployee.toString(), /where:\s*\{\s*id:\s*employeeId\s*\}/);
  assert.doesNotMatch(resetDisposableUatEmployee.toString(), /where:\s*\{\s*id:\s*employeeId\s*\}/);
});

test('safe errors contain codes only and do not echo database targets', () => {
  const unsafeTarget = ['postgresql:', '', 'private-user:private-password@db.private.example:5432', 'private'].join('/');
  try {
    assertExecutionContext({ ...isolated, DATABASE_URL: unsafeTarget });
    assert.fail('expected target rejection');
  } catch (error) {
    assert.equal(error.code, 'UAT_EMPLOYEE_DATABASE_TARGET_REJECTED');
    assert.equal(String(error.message).includes('private-user'), false);
    assert.equal(String(error.message).includes('private-password'), false);
    assert.equal(String(error.message).includes('db.private.example'), false);
  }
});
