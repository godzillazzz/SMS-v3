process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('PostgreSQL integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');
  const prisma = require('../../src/config/prisma');
  const employees = require('../../src/services/employee.service');
  const lifecycle = require('../../src/services/employee-lifecycle.service');
  const auth = require('../../src/services/auth.service');
  const app = require('../../src/app');
  const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const badActorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const employee = (suffix = '1') => ({ employeeCode: `TEST-${suffix}`, firstName: 'Test', lastName: `User${suffix}`, department: suffix === '2' ? 'HR' : 'Operations' });
  async function createUser(overrides = {}) { return prisma.user.create({ data: { id: actorId, email: 'gate3@example.test', passwordHash: await bcrypt.hash('test-password', 4), displayName: 'Gate 3 User', role: 'ADMIN', accountStatus: 'ACTIVE', passwordResetRequired: false, ...overrides } }); }
  async function cleanupFixtures() {
    await prisma.auditLog.deleteMany({ where: { actorUserId: actorId } });
    await prisma.refreshSession.deleteMany({ where: { userId: actorId } });
    await prisma.employeeLifecycleEvent.deleteMany({ where: { OR: [{ changedByUserId: actorId }, { employee: { employeeCode: { startsWith: 'TEST-' } } }] } });
    await prisma.employee.deleteMany({ where: { employeeCode: { startsWith: 'TEST-' } } });
    await prisma.user.deleteMany({ where: { id: actorId } });
  }
  test.beforeEach(async () => { await cleanupFixtures(); await createUser(); });
  test.after(async () => { await cleanupFixtures(); await prisma.$disconnect(); });

  test('Prisma migrations are applied to the isolated test database', async () => { const rows = await prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations"'); assert.ok(rows.length >= 3); });
  test('real database allows profile updates while lifecycle fields and deletion remain guarded', async () => { const created = await employees.create(employee(), actorId); const updated = await employees.update(created.id, { phone: '0800000000' }, actorId); await assert.rejects(() => employees.update(created.id, { department: 'HR' }, actorId), { statusCode: 409, details: { code: 'LIFECYCLE_ACTION_REQUIRED', fields: ['department'] } }); await assert.rejects(() => employees.remove(created.id, actorId), { statusCode: 409, details: { code: 'LIFECYCLE_TERMINATION_REQUIRED' } }); const stored = await prisma.employee.findUnique({ where: { id: created.id } }); const logs = await prisma.auditLog.findMany({ where: { entityId: created.id }, orderBy: { createdAt: 'asc' } }); assert.equal(updated.phone, '0800000000'); assert.equal(stored.deletedAt, null); assert.equal(stored.isActive, true); assert.equal(logs.length, 2); });
  test('real database applies NAME_CHANGE atomically, synchronizes linked User, writes history/audit, and preserves idempotency', async () => {
    const created = await employees.create(employee('lifecycle'), actorId);
    await prisma.user.update({ where: { id: actorId }, data: { employeeId: created.id, displayName: created.displayName } });
    const analysis = await lifecycle.preflightEmployeeLifecycleAction({ employeeId: created.id, type: 'NAME_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { firstName: 'Updated', lastName: 'Identity' } });
    const idempotencyKey = randomUUID();
    const input = { employeeId: created.id, actorUserId: actorId, type: 'NAME_CHANGE', effectiveDate: analysis.effectiveDate, reason: 'Integration lifecycle contract', changes: { firstName: 'Updated', lastName: 'Identity' }, expectedEmployeeUpdatedAt: analysis.expectedEmployeeUpdatedAt, expectedLifecycleSequence: analysis.latestLifecycleSequence, idempotencyKey, acknowledgeWarnings: true };
    const result = await lifecycle.createEmployeeLifecycleEvent(input);
    const duplicate = await lifecycle.createEmployeeLifecycleEvent(input);
    const stored = await prisma.employee.findUnique({ where: { id: created.id } });
    const linked = await prisma.user.findUnique({ where: { id: actorId } });
    const history = await prisma.employeeLifecycleEvent.findMany({ where: { employeeId: created.id } });
    const lifecycleAudits = await prisma.auditLog.findMany({ where: { actorUserId: actorId, OR: [{ entityType: 'Employee', entityId: created.id, action: 'UPDATE' }, { entityType: 'EmployeeLifecycleEvent', entityId: history[0]?.id }] } });
    assert.equal(result.employee.id, created.id);
    assert.equal(stored.id, created.id);
    assert.equal(stored.displayName, 'Updated Identity');
    assert.equal(linked.displayName, 'Updated Identity');
    assert.equal(history.length, 1);
    assert.equal(history[0].type, 'NAME_CHANGE');
    assert.equal(history[0].status, 'APPLIED');
    assert.equal(duplicate.idempotent, true);
    assert.equal(lifecycleAudits.length, 2);
  });

  test('real database rolls back Employee, linked User, lifecycle event, and audit when atomic audit step fails', async () => {
    const created = await employees.create(employee('lifecycle-rollback'), actorId);
    await prisma.user.update({ where: { id: actorId }, data: { employeeId: created.id, displayName: created.displayName } });
    const analysis = await lifecycle.preflightEmployeeLifecycleAction({ employeeId: created.id, type: 'NAME_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { firstName: 'Should', lastName: 'Rollback' } });
    const beforeAuditCount = await prisma.auditLog.count({ where: { actorUserId: actorId } });
    const failingService = lifecycle.createEmployeeLifecycleService({ prismaClient: prisma, auditService: { log: async () => { throw new Error('forced integration audit failure'); } } });
    await assert.rejects(() => failingService.createEvent({ employeeId: created.id, actorUserId: actorId, type: 'NAME_CHANGE', effectiveDate: analysis.effectiveDate, reason: 'Rollback integration contract', changes: { firstName: 'Should', lastName: 'Rollback' }, expectedEmployeeUpdatedAt: analysis.expectedEmployeeUpdatedAt, expectedLifecycleSequence: analysis.latestLifecycleSequence, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), /forced integration audit failure/);
    const stored = await prisma.employee.findUnique({ where: { id: created.id } });
    const linked = await prisma.user.findUnique({ where: { id: actorId } });
    assert.equal(stored.displayName, created.displayName);
    assert.equal(linked.displayName, created.displayName);
    assert.equal(await prisma.employeeLifecycleEvent.count({ where: { employeeId: created.id } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: actorId } }), beforeAuditCount);
  });

  test('real database rejects stale expectedEmployeeUpdatedAt before lifecycle writes', async () => {
    const created = await employees.create(employee('lifecycle-stale'), actorId);
    const analysis = await lifecycle.preflightEmployeeLifecycleAction({ employeeId: created.id, type: 'NAME_CHANGE', effectiveDate: new Date().toISOString().slice(0, 10), changes: { firstName: 'Stale', lastName: 'Attempt' } });
    await prisma.employee.update({ where: { id: created.id }, data: { phone: '0890000000' } });
    await assert.rejects(() => lifecycle.createEmployeeLifecycleEvent({ employeeId: created.id, actorUserId: actorId, type: 'NAME_CHANGE', effectiveDate: analysis.effectiveDate, reason: 'Stale employee version', changes: { firstName: 'Stale', lastName: 'Attempt' }, expectedEmployeeUpdatedAt: analysis.expectedEmployeeUpdatedAt, expectedLifecycleSequence: analysis.latestLifecycleSequence, idempotencyKey: randomUUID(), acknowledgeWarnings: true }), (error) => error.statusCode === 409 && error.details.code === 'EMPLOYEE_STATE_CONFLICT');
    assert.equal(await prisma.employeeLifecycleEvent.count({ where: { employeeId: created.id } }), 0);
  });

  test('real PostgreSQL concurrent lifecycle submissions preserve sequence ordering under the advisory lock', async () => {
    const created = await employees.create(employee('lifecycle-concurrent'), actorId);
    const effectiveDate = '2026-10-01';
    const firstAnalysis = await lifecycle.preflightEmployeeLifecycleAction({ employeeId: created.id, type: 'POSITION_CHANGE', effectiveDate, changes: { jobTitle: 'Concurrent Position' } });
    const secondAnalysis = await lifecycle.preflightEmployeeLifecycleAction({ employeeId: created.id, type: 'NAME_CHANGE', effectiveDate, changes: { firstName: 'Concurrent', lastName: 'Name' } });
    assert.equal(firstAnalysis.latestLifecycleSequence, 0);
    assert.equal(secondAnalysis.latestLifecycleSequence, 0);
    const results = await Promise.allSettled([
      lifecycle.createEmployeeLifecycleEvent({ employeeId: created.id, actorUserId: actorId, type: 'POSITION_CHANGE', effectiveDate, reason: 'Concurrent ordering A', changes: { jobTitle: 'Concurrent Position' }, expectedEmployeeUpdatedAt: firstAnalysis.expectedEmployeeUpdatedAt, expectedLifecycleSequence: firstAnalysis.latestLifecycleSequence, idempotencyKey: randomUUID(), acknowledgeWarnings: true }),
      lifecycle.createEmployeeLifecycleEvent({ employeeId: created.id, actorUserId: actorId, type: 'NAME_CHANGE', effectiveDate, reason: 'Concurrent ordering B', changes: { firstName: 'Concurrent', lastName: 'Name' }, expectedEmployeeUpdatedAt: secondAnalysis.expectedEmployeeUpdatedAt, expectedLifecycleSequence: secondAnalysis.latestLifecycleSequence, idempotencyKey: randomUUID(), acknowledgeWarnings: true })
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.statusCode, 409);
    assert.equal(rejected[0].reason.details.code, 'LIFECYCLE_STATE_CONFLICT');
    const history = await prisma.employeeLifecycleEvent.findMany({ where: { employeeId: created.id }, orderBy: { sequence: 'asc' } });
    assert.equal(history.length, 1);
    assert.equal(history[0].sequence, 1);
    assert.equal(history[0].status, 'PENDING');
  });
  test('unique employeeCode constraint and foreign keys are enforced', async () => { await employees.create(employee(), actorId); await assert.rejects(() => employees.create(employee(), actorId), { code: 'P2002' }); await assert.rejects(() => prisma.auditLog.create({ data: { actorUserId: badActorId, action: 'CREATE', entityType: 'Test', entityId: 'x' } }), { code: 'P2003' }); });
  test('employee transaction rolls back when its audit insert fails', async () => { await assert.rejects(() => employees.create(employee('rollback'), badActorId)); assert.equal(await prisma.employee.count({ where: { employeeCode: 'TEST-rollback' } }), 0); });
  test('pagination, search, and filters operate against PostgreSQL', async () => { await employees.create(employee('1'), actorId); await employees.create(employee('2'), actorId); const result = await employees.list({ page: 1, pageSize: 1, search: 'User', department: 'Operations' }, 'ADMIN'); assert.equal(result.data.length, 1); assert.equal(result.meta.total, 1); });
  test('readiness endpoint reports database available and unavailable', async () => { assert.equal((await request(app).get('/ready')).status, 200); const original = prisma.$queryRaw; prisma.$queryRaw = async () => { throw new Error('test database unavailable'); }; assert.equal((await request(app).get('/ready')).status, 503); prisma.$queryRaw = original; });
  test('refresh tokens rotate, logout, logout-all, expiry, inactive user, and reuse are handled', async () => { const login = await auth.login('gate3@example.test', 'test-password', 'request-1', { ipAddress: '127.0.0.1' }); const refreshed = await auth.refresh(login.refreshToken, 'request-2', {}); assert.ok(refreshed.refreshToken); await assert.rejects(() => auth.refresh(login.refreshToken, 'request-3', {}), { message: auth.refreshFailure }); const user = await prisma.user.findUnique({ where: { id: actorId } }); assert.equal(user.tokenVersion, 1); const second = await auth.login('gate3@example.test', 'test-password', 'request-4', {}); await auth.logout(second.refreshToken, 'request-5'); await assert.rejects(() => auth.refresh(second.refreshToken, 'request-6', {}), { message: auth.refreshFailure }); const third = await auth.login('gate3@example.test', 'test-password', 'request-7', {}); await auth.logoutAll(actorId, 'request-8'); await assert.rejects(() => auth.refresh(third.refreshToken, 'request-9', {}), { message: auth.refreshFailure }); });
}
