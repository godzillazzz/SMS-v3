process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('administrator safety integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const { createUserAccessService, SELF_ACCESS_MUTATION_FORBIDDEN, LAST_ADMIN_PROTECTION } = require('../../src/services/user-access.service');

  const ids = {
    primary: '10000000-0000-4000-8000-000000000001',
    secondary: '20000000-0000-4000-8000-000000000002',
    manager: '30000000-0000-4000-8000-000000000003',
    viewer: '40000000-0000-4000-8000-000000000004',
    operator: '50000000-0000-4000-8000-000000000005'
  };
  const allIds = Object.values(ids);

  async function createAccount({ id, role = 'ADMIN', accountStatus = 'ACTIVE', isActive = true, department = 'Safety' }) {
    return prisma.user.create({ data: {
      id,
      email: `${id.slice(0, 8)}@admin-safety.test`,
      passwordHash: 'not-used-by-administrator-safety-tests',
      displayName: `Safety ${id.slice(0, 4)}`,
      role,
      accountStatus,
      isActive,
      passwordResetRequired: false,
      department
    } });
  }

  async function tokenFor(id) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    return accessTokenFor(user);
  }

  async function cleanupFixtures() {
    await prisma.refreshSession.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.user.deleteMany({});
  }

  async function rejectedEvents(targetId, code) {
    return prisma.auditLog.findMany({ where: { entityType: 'UserAccessMutation', entityId: targetId }, orderBy: { createdAt: 'asc' } }).then((events) => events.filter((event) => event.metadata?.reasonCode === code));
  }

  test.beforeEach(cleanupFixtures);
  test.after(async () => { await cleanupFixtures(); await prisma.$disconnect(); });

  test('administrator self role mutation is denied, unchanged, and audited safely', async () => {
    await createAccount({ id: ids.primary });
    const response = await request(app).put(`/api/v1/users/${ids.primary}`).set('Authorization', `Bearer ${await tokenFor(ids.primary)}`).send({ role: 'VIEWER' });
    assert.equal(response.status, 403);
    assert.equal(response.body.details?.code, SELF_ACCESS_MUTATION_FORBIDDEN);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids.primary } })).role, 'ADMIN');
    const events = await rejectedEvents(ids.primary, SELF_ACCESS_MUTATION_FORBIDDEN);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].metadata.attemptedProtectedFields, ['role']);
    assert.equal(/password|token|cookie|authorization/i.test(JSON.stringify(events[0].metadata)), false);
  });

  test('administrator self suspension and deactivation are denied and audited', async () => {
    await createAccount({ id: ids.primary });
    const token = await tokenFor(ids.primary);
    for (const payload of [{ accountStatus: 'SUSPENDED' }, { isActive: false }]) {
      const response = await request(app).put(`/api/v1/users/${ids.primary}`).set('Authorization', `Bearer ${token}`).send(payload);
      assert.equal(response.status, 403);
      assert.equal(response.body.details?.code, SELF_ACCESS_MUTATION_FORBIDDEN);
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: ids.primary } });
    assert.equal(stored.accountStatus, 'ACTIVE');
    assert.equal(stored.isActive, true);
    assert.equal((await rejectedEvents(ids.primary, SELF_ACCESS_MUTATION_FORBIDDEN)).length, 2);
  });

  test('a no-op self update remains allowed without changing protected access', async () => {
    await createAccount({ id: ids.primary, department: 'Safety' });
    const response = await request(app).put(`/api/v1/users/${ids.primary}`).set('Authorization', `Bearer ${await tokenFor(ids.primary)}`).send({ department: 'Safety' });
    assert.equal(response.status, 200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: ids.primary } });
    assert.equal(stored.role, 'ADMIN');
    assert.equal(stored.accountStatus, 'ACTIVE');
    assert.equal(stored.isActive, true);
  });

  test('the final eligible administrator cannot be demoted, suspended, or deactivated', async () => {
    await createAccount({ id: ids.primary });
    await createAccount({ id: ids.operator, accountStatus: 'PENDING', isActive: false });
    const service = createUserAccessService();
    for (const input of [{ role: 'VIEWER' }, { accountStatus: 'SUSPENDED' }, { isActive: false }]) {
      await assert.rejects(() => service.updateUserAccount({ id: ids.primary, input, actorUserId: ids.operator, actorRole: 'ADMIN' }), (error) => error.statusCode === 409 && error.details?.code === LAST_ADMIN_PROTECTION);
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: ids.primary } });
    assert.equal(stored.role, 'ADMIN');
    assert.equal(stored.accountStatus, 'ACTIVE');
    assert.equal(stored.isActive, true);
    assert.equal((await rejectedEvents(ids.primary, LAST_ADMIN_PROTECTION)).length, 3);
  });

  test('one of two eligible administrators may modify the other while one remains', async () => {
    await createAccount({ id: ids.primary });
    await createAccount({ id: ids.secondary });
    const response = await request(app).put(`/api/v1/users/${ids.secondary}`).set('Authorization', `Bearer ${await tokenFor(ids.primary)}`).send({ role: 'VIEWER' });
    assert.equal(response.status, 200);
    const eligible = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false } });
    assert.equal(eligible, 1);
  });

  test('concurrent final-administrator mutations allow at most one to succeed', async () => {
    await createAccount({ id: ids.primary });
    await createAccount({ id: ids.secondary });
    await createAccount({ id: ids.operator, accountStatus: 'PENDING', isActive: false });
    const service = createUserAccessService();
    const results = await Promise.allSettled([
      service.updateUserAccount({ id: ids.primary, input: { role: 'VIEWER' }, actorUserId: ids.operator, actorRole: 'ADMIN' }),
      service.updateUserAccount({ id: ids.secondary, input: { role: 'VIEWER' }, actorUserId: ids.operator, actorRole: 'ADMIN' })
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(await prisma.user.count({ where: { role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false } }), 1);
  });

  test('manager and viewer roles cannot bypass the account safeguards', async () => {
    await createAccount({ id: ids.primary });
    await createAccount({ id: ids.manager, role: 'MANAGER' });
    await createAccount({ id: ids.viewer, role: 'VIEWER' });
    const managerResponse = await request(app).put(`/api/v1/users/${ids.primary}`).set('Authorization', `Bearer ${await tokenFor(ids.manager)}`).send({ role: 'VIEWER' });
    const viewerResponse = await request(app).put(`/api/v1/users/${ids.primary}`).set('Authorization', `Bearer ${await tokenFor(ids.viewer)}`).send({ role: 'VIEWER' });
    assert.equal(managerResponse.status, 403);
    assert.equal(viewerResponse.status, 403);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids.primary } })).role, 'ADMIN');
  });

  test('a rejected audit write still cannot permit the final-administrator mutation', async () => {
    await createAccount({ id: ids.primary });
    await createAccount({ id: ids.operator, accountStatus: 'PENDING', isActive: false });
    const service = createUserAccessService({ prismaClient: prisma, auditService: { log: async () => { throw new Error('audit unavailable'); } } });
    await assert.rejects(() => service.updateUserAccount({ id: ids.primary, input: { isActive: false }, actorUserId: ids.operator, actorRole: 'ADMIN' }), (error) => error.details?.code === LAST_ADMIN_PROTECTION);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ids.primary } })).isActive, true);
  });
}
