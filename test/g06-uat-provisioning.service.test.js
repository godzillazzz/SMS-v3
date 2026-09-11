'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

require.cache[require.resolve('../src/config/prisma')] = { exports: {} };
const personnelMasterPath = require.resolve('../src/services/personnel-master.service');
require.cache[personnelMasterPath] = { exports: { assertActiveValue: async (_client, kind, value) => kind === 'department' ? 'UAT-PREVIEW' : value } };
const {
  G06_UAT_EMPLOYEE_CODE,
  G06_UAT_EMAIL,
  G06_UAT_ROLE,
  assertPreviewOnly,
  createG06UatProvisioningService
} = require('../src/services/g06-uat-provisioning.service');

const PREVIEW_ENV = {
  VERCEL_ENV: 'preview',
  VERCEL_URL: 'sms-v3-staging-g06-preview.vercel.app'
};

function baseEmployee(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    employeeCode: G06_UAT_EMPLOYEE_CODE,
    firstName: 'G06',
    lastName: 'Preview UAT',
    displayName: 'G06 Preview UAT',
    department: 'UAT-PREVIEW',
    jobTitle: 'Officer',
    isActive: true,
    deletedAt: null,
    ...overrides
  };
}

function baseUser(overrides = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    email: G06_UAT_EMAIL,
    displayName: 'G06 Preview UAT',
    role: G06_UAT_ROLE,
    employeeId: '11111111-1111-4111-8111-111111111111',
    isActive: true,
    accountStatus: 'ACTIVE',
    passwordResetRequired: false,
    ...overrides
  };
}

function harness({ existing = null, failOnUserCreate = false } = {}) {
  const calls = [];
  const audits = [];
  const state = { employees: [], users: [] };
  const tx = {
    employee: {
      findUnique: async ({ where }) => {
        calls.push(['employee.findUnique', where]);
        return existing || state.employees.find((row) => row.employeeCode === where.employeeCode) || null;
      },
      create: async ({ data }) => {
        calls.push(['employee.create', data]);
        const row = baseEmployee({ ...data, id: '11111111-1111-4111-8111-111111111111', deletedAt: null });
        state.employees.push(row);
        return row;
      }
    },
    user: {
      findUnique: async ({ where }) => {
        calls.push(['user.findUnique', where]);
        return state.users.find((row) => row.email === where.email) || null;
      },
      create: async ({ data }) => {
        calls.push(['user.create', data]);
        if (failOnUserCreate) throw new Error('simulated user creation failure');
        const row = baseUser({ ...data, id: '22222222-2222-4222-8222-222222222222' });
        state.users.push(row);
        return row;
      }
    }
  };
  const prismaClient = {
    $transaction: async (callback) => {
      const employeeSnapshot = [...state.employees];
      const userSnapshot = [...state.users];
      try {
        return await callback(tx);
      } catch (error) {
        state.employees = employeeSnapshot;
        state.users = userSnapshot;
        throw error;
      }
    }
  };
  const service = createG06UatProvisioningService({
    prismaClient,
    auditService: { log: async (entry) => { audits.push(entry); } },
    hashPassword: async (password) => { calls.push(['hashPassword', password]); return 'bcrypt-hash-only'; },
    generatePassword: () => { calls.push(['generatePassword']); return 'x'.repeat(20); },
    environment: PREVIEW_ENV,
    verifyDatabaseTarget: () => { calls.push(['verifyPreviewDatabaseTarget']); return { required: true, matched: true }; },
    clock: () => new Date('2026-09-11T00:00:00.000Z')
  });
  return { service, calls, audits, state, prismaClient };
}

test('Preview-only guard allows verified Preview and denies Production before any query', () => {
  let verified = 0;
  assert.deepEqual(assertPreviewOnly({ environment: PREVIEW_ENV, verifyDatabaseTarget: () => { verified += 1; } }), { environment: 'preview', productionDenied: true, databaseTarget: 'verified' });
  assert.equal(verified, 1);
  assert.throws(() => assertPreviewOnly({ environment: { ...PREVIEW_ENV, VERCEL_ENV: 'production' }, verifyDatabaseTarget: () => { throw new Error('must not run'); } }), (error) => error.statusCode === 403 && error.details?.code === 'G06_UAT_PREVIEW_ONLY');
  assert.throws(() => assertPreviewOnly({ environment: { ...PREVIEW_ENV, VERCEL_TARGET_ENV: 'production' }, verifyDatabaseTarget: () => { throw new Error('must not run'); } }), (error) => error.statusCode === 403);
});

test('successful provisioning is atomic, allowlisted, linked, and returns only a one-time temporary password', async () => {
  const { service, calls, audits } = harness();
  const result = await service.provision({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  assert.equal(result.created, true);
  assert.equal(result.employee.employeeCode, G06_UAT_EMPLOYEE_CODE);
  assert.equal(result.employee.accountLinked, true);
  assert.equal(result.account.role, G06_UAT_ROLE);
  assert.equal(result.account.employeeId, result.employee.id);
  assert.equal(result.temporaryPassword, 'x'.repeat(20));
  assert.equal(result.provisioningPath, 'GOVERNED_PREVIEW_ONLY');
  assert.equal(result.otpPublicFlowChanged, false);
  assert.equal(calls.filter(([name]) => name === 'employee.create').length, 1);
  assert.equal(calls.filter(([name]) => name === 'user.create').length, 1);
  assert.equal(calls.filter(([name]) => name === 'verifyPreviewDatabaseTarget').length, 1);
  assert.equal(audits.length, 3);
  const auditText = JSON.stringify(audits);
  for (const forbidden of ['password', 'token', 'cookie', 'secret', 'passwordHash']) assert.equal(auditText.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  assert.equal(Object.prototype.hasOwnProperty.call(result.account, 'passwordHash'), false);
});

test('duplicate guard returns existing safe state without generating a credential or writing', async () => {
  const existing = { ...baseEmployee(), user: baseUser() };
  const { service, calls, audits } = harness({ existing });
  const result = await service.provision({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  assert.equal(result.created, false);
  assert.equal(result.duplicate, true);
  assert.equal(result.temporaryPassword, null);
  assert.equal(calls.some(([name]) => name === 'generatePassword'), false);
  assert.equal(calls.some(([name]) => name === 'employee.create'), false);
  assert.equal(calls.some(([name]) => name === 'user.create'), false);
  assert.equal(audits.length, 0);
});

test('transaction failure rolls back the staged Employee and leaves no orphan state', async () => {
  const { service, state } = harness({ failOnUserCreate: true });
  await assert.rejects(() => service.provision({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), /simulated user creation failure/);
  assert.deepEqual(state.employees, []);
  assert.deepEqual(state.users, []);
});

test('missing actor authority is rejected before provisioning', async () => {
  const { service, calls } = harness();
  await assert.rejects(() => service.provision({}), (error) => error.statusCode === 401 && error.details?.code === 'G06_UAT_ACTOR_REQUIRED');
  assert.equal(calls.some(([name]) => name === 'employee.create'), false);
});
