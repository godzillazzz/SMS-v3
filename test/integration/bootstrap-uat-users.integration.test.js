process.env.NODE_ENV = 'test';
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('UAT bootstrap integration is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  const target = new URL(process.env.DATABASE_URL || '');
  if (target.pathname.replace(/^\//, '') !== 'sms_v3_test') throw new Error('UAT bootstrap integration requires the isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const { CONFIRMATION, provisionUatUsers, readBootstrapConfig } = require('../../scripts/admin/bootstrap-uat-users');
  const marker = crypto.randomBytes(8).toString('hex');
  const environment = {
    UAT_BOOTSTRAP_CONFIRM: CONFIRMATION,
    UAT_ADMIN_EMAIL: `uat-bootstrap-admin-${marker}@example.test`,
    UAT_ADMIN_PASSWORD: 'test-only-admin-password',
    UAT_MANAGER_EMAIL: `uat-bootstrap-manager-${marker}@example.test`,
    UAT_MANAGER_PASSWORD: 'test-only-manager-password',
    UAT_VIEWER_EMAIL: `uat-bootstrap-viewer-${marker}@example.test`,
    UAT_VIEWER_PASSWORD: 'test-only-viewer-password'
  };
  const emails = [environment.UAT_ADMIN_EMAIL, environment.UAT_MANAGER_EMAIL, environment.UAT_VIEWER_EMAIL];

  test.after(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  test('Prisma bootstrap creates only three standalone UAT users and is idempotent', async () => {
    const config = readBootstrapConfig(environment);
    const created = await provisionUatUsers({ prismaClient: prisma, config });
    assert.deepEqual(created.map((entry) => entry.action), ['CREATE', 'CREATE', 'CREATE']);

    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { email: true, role: true, employeeId: true, isActive: true, accountStatus: true, passwordResetRequired: true, passwordHash: true },
      orderBy: { email: 'asc' }
    });
    assert.equal(users.length, 3);
    assert.ok(users.every((user) => user.employeeId === null && user.isActive && user.accountStatus === 'ACTIVE' && !user.passwordResetRequired));
    assert.ok(users.every((user) => !Object.values(environment).includes(user.passwordHash)));
    assert.deepEqual(Object.fromEntries(users.map((user) => [user.email, user.role])), {
      [environment.UAT_ADMIN_EMAIL]: 'ADMIN',
      [environment.UAT_MANAGER_EMAIL]: 'MANAGER',
      [environment.UAT_VIEWER_EMAIL]: 'VIEWER'
    });

    const repeated = await provisionUatUsers({ prismaClient: prisma, config });
    assert.deepEqual(repeated.map((entry) => entry.action), ['EXISTS', 'EXISTS', 'EXISTS']);
  });
}
