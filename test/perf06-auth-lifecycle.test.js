process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';

let broadSyncCalls = 0;
let employeeSyncCalls = 0;
let userFindUniqueCalls = 0;
let suspendDuringEmployeeSync = false;

const users = [];
const sessions = [];
const audits = [];

function restoreArray(target, snapshot) {
  target.splice(0, target.length, ...structuredClone(snapshot));
}

const fakePrisma = {
  user: {
    findUnique: async ({ where }) => {
      userFindUniqueCalls += 1;
      return users.find((user) => user.id === where.id || user.email === where.email) || null;
    },
    update: async ({ where, data }) => {
      const user = users.find((item) => item.id === where.id);
      if (!user) {
        const error = new Error('missing user');
        error.code = 'P2025';
        throw error;
      }
      for (const [key, value] of Object.entries(data)) {
        user[key] = value && typeof value === 'object' && 'increment' in value ? user[key] + value.increment : value;
      }
      return { ...user };
    }
  },
  refreshSession: {
    create: async ({ data }) => {
      const row = { id: `session-${sessions.length + 1}`, revokedAt: null, lastUsedAt: null, ...data };
      sessions.push(row);
      return { ...row };
    },
    findUnique: async ({ where }) => {
      const session = sessions.find((item) => item.id === where.id || item.refreshTokenHash === where.refreshTokenHash);
      return session ? { ...session, user: { ...users.find((item) => item.id === session.userId) } } : null;
    },
    update: async ({ where, data }) => {
      const row = sessions.find((item) => item.id === where.id);
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }) => {
      const rows = sessions.filter((item) => item.userId === where.userId && (where.revokedAt !== null || item.revokedAt === null));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }
  },
  auditLog: {
    create: async ({ data }) => {
      audits.push(structuredClone(data));
      return data;
    }
  },
  $transaction: async (work) => {
    const userSnapshot = structuredClone(users);
    const sessionSnapshot = structuredClone(sessions);
    const auditSnapshot = structuredClone(audits);
    try {
      return await work(fakePrisma);
    } catch (error) {
      restoreArray(users, userSnapshot);
      restoreArray(sessions, sessionSnapshot);
      restoreArray(audits, auditSnapshot);
      throw error;
    }
  }
};

require.cache[require.resolve('../src/config/prisma')] = { exports: fakePrisma };
require.cache[require.resolve('../src/services/employee-lifecycle.service')] = {
  exports: {
    synchronizeDueLifecycleEventsForRequest: async () => {
      broadSyncCalls += 1;
      return { scanned: 0, applied: 0, failed: 0 };
    },
    synchronizeDueLifecycleEventsForEmployee: async (employeeId) => {
      employeeSyncCalls += 1;
      assert.equal(employeeId, EMPLOYEE_ID);
      if (suspendDuringEmployeeSync) {
        const user = users.find((item) => item.employeeId === employeeId);
        user.isActive = false;
        user.accountStatus = 'SUSPENDED';
        user.employmentSuspendedAt = new Date();
        return { scanned: 1, applied: 1, failed: 0 };
      }
      return { scanned: 0, applied: 0, failed: 0 };
    }
  }
};

delete require.cache[require.resolve('../src/services/auth.service')];
const auth = require('../src/services/auth.service');

async function resetState() {
  broadSyncCalls = 0;
  employeeSyncCalls = 0;
  userFindUniqueCalls = 0;
  suspendDuringEmployeeSync = false;
  sessions.splice(0);
  audits.splice(0);
  users.splice(0);
  users.push({
    id: USER_ID,
    employeeId: EMPLOYEE_ID,
    email: 'employee@example.com',
    passwordHash: await bcrypt.hash('correct-password', 4),
    displayName: 'Employee',
    department: 'Security',
    role: 'VIEWER',
    accountStatus: 'ACTIVE',
    passwordResetRequired: false,
    isActive: true,
    tokenVersion: 0,
    failedLoginCount: 0,
    lastLoginAt: null,
    employmentSuspendedAt: null
  });
}

test('PERF-06 password login skips broad lifecycle scan and avoids the duplicate User reread', async () => {
  await resetState();
  const result = await auth.login('employee@example.com', 'correct-password', 'perf06-password');

  assert.ok(result.accessToken);
  assert.ok(result.refreshToken);
  assert.equal(broadSyncCalls, 0);
  assert.equal(employeeSyncCalls, 1);
  assert.equal(userFindUniqueCalls, 1);
  assert.equal(sessions.length, 1);
  assert.equal(audits.at(-1).action, 'LOGIN');
});

test('PERF-06 targeted termination still fails closed before session issuance', async () => {
  await resetState();
  suspendDuringEmployeeSync = true;

  await assert.rejects(
    () => auth.login('employee@example.com', 'correct-password', 'perf06-termination'),
    { message: auth.genericFailure }
  );

  assert.equal(broadSyncCalls, 0);
  assert.equal(employeeSyncCalls, 1);
  assert.equal(userFindUniqueCalls, 1);
  assert.equal(users[0].accountStatus, 'SUSPENDED');
  assert.equal(users[0].isActive, false);
  assert.equal(sessions.length, 0);
  assert.equal(audits.at(-1).action, 'LOGIN_FAILED');
});

test('PERF-06 refresh skips the broad lifecycle scan while preserving targeted account-state synchronization', async () => {
  await resetState();
  const loginResult = await auth.login('employee@example.com', 'correct-password', 'perf06-refresh-seed');

  broadSyncCalls = 0;
  employeeSyncCalls = 0;
  userFindUniqueCalls = 0;

  const refreshed = await auth.refresh(loginResult.refreshToken, 'perf06-refresh');

  assert.ok(refreshed.accessToken);
  assert.ok(refreshed.refreshToken);
  assert.equal(broadSyncCalls, 0);
  assert.equal(employeeSyncCalls, 1);
  assert.equal(userFindUniqueCalls, 0);
  assert.equal(sessions.length, 2);
  assert.equal(audits.at(-1).action, 'REFRESH');
});

test('PERF-06 verified/passkey login uses the same targeted sync and authoritative transaction state', async () => {
  await resetState();
  const result = await auth.loginVerifiedUser(USER_ID, 'perf06-passkey', {}, { credentialId: 'credential-1' });

  assert.ok(result.accessToken);
  assert.equal(broadSyncCalls, 0);
  assert.equal(employeeSyncCalls, 1);
  assert.equal(userFindUniqueCalls, 1);
  assert.equal(sessions.length, 1);
  assert.equal(audits.at(-1).action, 'PASSKEY_LOGIN_SUCCESS');
});
