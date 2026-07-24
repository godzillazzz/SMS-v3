process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('PostgreSQL integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');
  const prisma = require('../../src/config/prisma');
  const employees = require('../../src/services/employee.service');
  const auth = require('../../src/services/auth.service');
  const app = require('../../src/app');
  const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const badActorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const employee = (suffix = '1') => ({ employeeCode: `TEST-${suffix}`, firstName: 'Test', lastName: `User${suffix}`, department: suffix === '2' ? 'HR' : 'Operations' });
  async function createUser(overrides = {}) { return prisma.user.create({ data: { id: actorId, email: 'gate3@example.test', passwordHash: await bcrypt.hash('test-password', 4), displayName: 'Gate 3 User', role: 'ADMIN', accountStatus: 'ACTIVE', passwordResetRequired: false, ...overrides } }); }
  async function cleanupFixtures() {
    await prisma.auditLog.deleteMany({ where: { actorUserId: actorId } });
    await prisma.refreshSession.deleteMany({ where: { userId: actorId } });
    await prisma.employee.deleteMany({ where: { employeeCode: { startsWith: 'TEST-' } } });
    await prisma.user.deleteMany({ where: { id: actorId } });
  }
  test.beforeEach(async () => { await cleanupFixtures(); await createUser(); });
  test.after(async () => { await cleanupFixtures(); await prisma.$disconnect(); });

  test('Prisma migrations are applied to the isolated test database', async () => { const rows = await prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations"'); assert.ok(rows.length >= 3); });
  test('real database creates, updates, and soft deletes an employee with transactional audit', async () => { const created = await employees.create(employee(), actorId); const updated = await employees.update(created.id, { department: 'HR' }, actorId); await employees.remove(created.id, actorId); const stored = await prisma.employee.findUnique({ where: { id: created.id } }); const logs = await prisma.auditLog.findMany({ where: { entityId: created.id }, orderBy: { createdAt: 'asc' } }); assert.equal(updated.department, 'HR'); assert.ok(stored.deletedAt); assert.equal(stored.isActive, false); assert.equal(logs.length, 3); });
  test('unique employeeCode constraint and foreign keys are enforced', async () => { await employees.create(employee(), actorId); await assert.rejects(() => employees.create(employee(), actorId), { code: 'P2002' }); await assert.rejects(() => prisma.auditLog.create({ data: { actorUserId: badActorId, action: 'CREATE', entityType: 'Test', entityId: 'x' } }), { code: 'P2003' }); });
  test('employee transaction rolls back when its audit insert fails', async () => { await assert.rejects(() => employees.create(employee('rollback'), badActorId)); assert.equal(await prisma.employee.count({ where: { employeeCode: 'TEST-rollback' } }), 0); });
  test('pagination, search, and filters operate against PostgreSQL', async () => { await employees.create(employee('1'), actorId); await employees.create(employee('2'), actorId); const result = await employees.list({ page: 1, pageSize: 1, search: 'User', department: 'Operations' }, 'ADMIN'); assert.equal(result.data.length, 1); assert.equal(result.meta.total, 1); });
  test('readiness endpoint reports database available and unavailable', async () => { assert.equal((await request(app).get('/ready')).status, 200); const original = prisma.$queryRaw; prisma.$queryRaw = async () => { throw new Error('test database unavailable'); }; assert.equal((await request(app).get('/ready')).status, 503); prisma.$queryRaw = original; });
  test('refresh tokens rotate, logout, logout-all, expiry, inactive user, and reuse are handled', async () => { const login = await auth.login('gate3@example.test', 'test-password', 'request-1', { ipAddress: '127.0.0.1' }); const refreshed = await auth.refresh(login.refreshToken, 'request-2', {}); assert.ok(refreshed.refreshToken); await assert.rejects(() => auth.refresh(login.refreshToken, 'request-3', {}), { message: auth.refreshFailure }); const user = await prisma.user.findUnique({ where: { id: actorId } }); assert.equal(user.tokenVersion, 1); const second = await auth.login('gate3@example.test', 'test-password', 'request-4', {}); await auth.logout(second.refreshToken, 'request-5'); await assert.rejects(() => auth.refresh(second.refreshToken, 'request-6', {}), { message: auth.refreshFailure }); const third = await auth.login('gate3@example.test', 'test-password', 'request-7', {}); await auth.logoutAll(actorId, 'request-8'); await assert.rejects(() => auth.refresh(third.refreshToken, 'request-9', {}), { message: auth.refreshFailure }); });
}
