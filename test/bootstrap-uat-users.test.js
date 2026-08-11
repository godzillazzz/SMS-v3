const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONFIRMATION,
  databaseErrorCode,
  provisionUatUsers,
  readBootstrapConfig
} = require('../scripts/admin/bootstrap-uat-users');

const environment = {
  UAT_BOOTSTRAP_CONFIRM: CONFIRMATION,
  UAT_ADMIN_EMAIL: 'uat-admin@sms-v3.example.test',
  UAT_ADMIN_PASSWORD: 'admin-password',
  UAT_MANAGER_EMAIL: 'uat-manager@sms-v3.example.test',
  UAT_MANAGER_PASSWORD: 'manager-password',
  UAT_VIEWER_EMAIL: 'uat-viewer@sms-v3.example.test',
  UAT_VIEWER_PASSWORD: 'viewer-password'
};

function createFakePrisma(existing = []) {
  const users = existing.map((user) => ({ ...user }));
  const calls = { create: 0, update: 0, transaction: 0 };
  const user = {
    async findUnique({ where }) {
      return users.find((entry) => entry.email === where.email) || null;
    },
    async create({ data }) {
      calls.create += 1;
      const created = { id: `uat-${calls.create}`, tokenVersion: 0, failedLoginCount: 0, ...data };
      users.push(created);
      return created;
    },
    async update({ where, data }) {
      calls.update += 1;
      const target = users.find((entry) => entry.id === where.id);
      Object.assign(target, data, { tokenVersion: target.tokenVersion + (data.tokenVersion?.increment || 0) });
      return target;
    }
  };
  return {
    user,
    users,
    calls,
    async $transaction(callback) {
      calls.transaction += 1;
      return callback({ user });
    }
  };
}

const hashPassword = async (password) => `hashed:${Buffer.from(password).toString('base64url')}`;
const verifyPassword = async (password, hash) => hash === `hashed:${Buffer.from(password).toString('base64url')}`;

test('bootstrap blocks missing confirmation and credentials before database access', () => {
  assert.throws(() => readBootstrapConfig({}), { code: 'UAT_BOOTSTRAP_CONFIRMATION_REQUIRED' });
  assert.throws(() => readBootstrapConfig({ UAT_BOOTSTRAP_CONFIRM: CONFIRMATION }), /UAT_BOOTSTRAP_CONFIGURATION_MISSING/);
});

test('bootstrap database diagnostics remain category-only', () => {
  assert.equal(databaseErrorCode({ code: 'P1000' }), 'DATABASE_AUTH_FAILED');
  assert.equal(databaseErrorCode({ code: 'P1001' }), 'DATABASE_UNREACHABLE');
  assert.equal(databaseErrorCode({ message: 'postgresql://unsafe' }), 'UAT_BOOTSTRAP_FAILED');
});

test('dry-run reports three creates with zero writes', async () => {
  const prisma = createFakePrisma();
  const results = await provisionUatUsers({ prismaClient: prisma, config: readBootstrapConfig(environment, ['--dry-run']), hashPassword, verifyPassword });
  assert.deepEqual(results.map((result) => result.action), ['CREATE', 'CREATE', 'CREATE']);
  assert.deepEqual(prisma.calls, { create: 0, update: 0, transaction: 0 });
});

test('bootstrap creates exactly three standalone active users with intended roles', async () => {
  const prisma = createFakePrisma([{ id: 'operational', email: 'person@example.test', displayName: 'Operational User', role: 'VIEWER', employeeId: 'employee-id' }]);
  const results = await provisionUatUsers({ prismaClient: prisma, config: readBootstrapConfig(environment), hashPassword, verifyPassword });
  assert.deepEqual(results.map((result) => result.action), ['CREATE', 'CREATE', 'CREATE']);
  assert.equal(prisma.calls.create, 3);
  assert.equal(prisma.calls.update, 0);
  assert.equal(prisma.users.length, 4);
  assert.deepEqual(prisma.users.slice(1).map((user) => [user.role, user.employeeId, user.isActive, user.accountStatus, user.passwordResetRequired]), [
    ['ADMIN', null, true, 'ACTIVE', false],
    ['MANAGER', null, true, 'ACTIVE', false],
    ['VIEWER', null, true, 'ACTIVE', false]
  ]);
  assert.equal(prisma.users[0].email, 'person@example.test');
  assert.ok(prisma.users.slice(1).every((user) => user.passwordHash !== environment[`UAT_${user.role}_PASSWORD`]));
});

test('existing correct UAT users are idempotent and conflicting identities block before writes', async () => {
  const existing = [];
  for (const [index, account] of readBootstrapConfig(environment).accounts.entries()) {
    existing.push({
      id: `existing-${index}`,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      isActive: true,
      accountStatus: 'ACTIVE',
      passwordResetRequired: false,
      employeeId: null,
      passwordHash: await hashPassword(account.password),
      tokenVersion: 0,
      failedLoginCount: 0
    });
  }
  const prisma = createFakePrisma(existing);
  const results = await provisionUatUsers({ prismaClient: prisma, config: readBootstrapConfig(environment), hashPassword, verifyPassword });
  assert.deepEqual(results.map((result) => result.action), ['EXISTS', 'EXISTS', 'EXISTS']);
  assert.equal(prisma.calls.create, 0);
  assert.equal(prisma.calls.update, 0);

  const conflicting = createFakePrisma([{ ...existing[0], displayName: 'Operational Admin' }]);
  await assert.rejects(
    provisionUatUsers({ prismaClient: conflicting, config: readBootstrapConfig(environment), hashPassword, verifyPassword }),
    { code: 'UAT_BOOTSTRAP_ACCOUNT_CONFLICT' }
  );
  assert.equal(conflicting.calls.create, 0);
  assert.equal(conflicting.calls.update, 0);
});
