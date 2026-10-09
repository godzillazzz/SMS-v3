process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('UAT recovery role isolation requires disposable DB', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Disposable sms_v3_test database required');
  const request = require('supertest');
  const bcrypt = require('bcryptjs');
  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { roles, getRoleApiMatrix } = require('../../e2e/uat-v3/role-matrix');
  const users = roles.map((role, index) => ({ id: `95000000-0000-4000-8000-00000000000${index + 1}`, role, email: `uat-recovery-${role.toLowerCase()}@example.test` }));
  const tokens = {};
  const password = 'synthetic-disposable-uat-only';
  test.before(async () => {
    const passwordHash = await bcrypt.hash(password, 4);
    await prisma.user.createMany({ data: users.map((u) => ({ ...u, passwordHash, displayName: `Synthetic ${u.role}`, isActive: true, accountStatus: 'ACTIVE' })) });
  });
  test.after(async () => {
    const ids = users.map((u) => u.id);
    await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });
  for (const user of users) test(`${user.role}: real isolated login and GET authorization matrix`, async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password, clientType: 'browser' });
    assert.equal(login.status, 200); assert.equal(login.body.user.role, user.role); assert.equal(login.body.user.id, user.id);
    tokens[user.role] = login.body.accessToken;
    for (const route of getRoleApiMatrix(user.role)) {
      const response = await request(app).get(route.path).set('Authorization', `Bearer ${tokens[user.role]}`);
      assert.equal(response.status, route.expectedStatus, `${user.role} ${route.label}`);
    }
  });
  test('anonymous/invalid auth is rejected and four subject tokens are distinct', async () => {
    assert.equal(new Set(Object.values(tokens)).size, 4);
    assert.equal((await request(app).get('/api/v1/approval-center/summary')).status, 401);
    assert.equal((await request(app).get('/api/v1/approval-center/summary').set('Authorization', 'Bearer invalid-uat-token')).status, 401);
    assert.equal((await request(app).get('/api/v1/audit-events').set('Authorization', `Bearer ${tokens.VIEWER}`)).status, 403);
  });
}
