process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('audit log viewer integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');
  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');
  const ids = {
    admin: '72000000-0000-4000-8000-000000000001',
    manager: '72000000-0000-4000-8000-000000000002',
    viewer: '72000000-0000-4000-8000-000000000003'
  };
  const entityPrefix = 'audit-log-viewer-fixture-';

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: Object.values(ids) } }, { entityId: { startsWith: entityPrefix } }] } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  }

  async function tokenFor(id) {
    return accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id } }));
  }

  async function seed() {
    await cleanup();
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: 'audit-admin@test.local', passwordHash: 'hash', displayName: 'Audit Admin', role: 'ADMIN', accountStatus: 'ACTIVE', isActive: true, passwordResetRequired: false },
      { id: ids.manager, email: 'audit-manager@test.local', passwordHash: 'hash', displayName: 'Audit Manager', role: 'MANAGER', accountStatus: 'ACTIVE', isActive: true, passwordResetRequired: false },
      { id: ids.viewer, email: 'audit-viewer@test.local', passwordHash: 'hash', displayName: 'Audit Viewer', role: 'VIEWER', accountStatus: 'ACTIVE', isActive: true, passwordResetRequired: false }
    ] });
    await prisma.auditLog.createMany({ data: [
      { actorUserId: ids.admin, action: 'UPDATE', entityType: 'LeaveRequest', entityId: `${entityPrefix}leave`, metadata: { status: 'APPROVED', nested: { jwt: 'never-return' } }, createdAt: new Date('2026-08-10T16:59:00.000Z') },
      { actorUserId: ids.admin, action: 'CREATE', entityType: 'EmployeeLicenseDocument', entityId: `${entityPrefix}license`, metadata: { event: 'APPROVE', password: 'maskme' }, createdAt: new Date('2026-08-10T10:00:00.000Z') },
      { actorUserId: ids.manager, action: 'REFRESH', entityType: 'RefreshSession', entityId: `${entityPrefix}refresh`, metadata: { requestId: 'safe' }, createdAt: new Date('2026-08-10T11:00:00.000Z') },
      { actorUserId: null, action: 'DELETE', entityType: 'Employee', entityId: `${entityPrefix}missing-actor`, metadata: { reasonCode: 'REMOVED' }, createdAt: new Date('2026-08-10T09:00:00.000Z') }
    ] });
  }

  test.beforeEach(seed);
  test.after(async () => { await cleanup(); await prisma.$disconnect(); });

  test('ADMIN receives newest-first, paged, sanitized Audit Log records and default excludes technical noise', async () => {
    const response = await request(app).get('/api/v1/audit-events?pageSize=25').set('Authorization', `Bearer ${await tokenFor(ids.admin)}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.pageSize, 25);
    assert.equal(response.body.data.some((row) => row.entityId === `${entityPrefix}refresh`), false);
    assert.equal(response.body.data[0].entityId, `${entityPrefix}leave`);
    const license = response.body.data.find((row) => row.entityId === `${entityPrefix}license`);
    assert.equal(license.metadata.password, '[REDACTED]');
    const leave = response.body.data.find((row) => row.entityId === `${entityPrefix}leave`);
    assert.equal(leave.metadata.nested.jwt, '[REDACTED]');
    assert.equal(response.body.data.find((row) => row.entityId === `${entityPrefix}missing-actor`).actor, null);
  });

  test('filters, date bounds, and technical view are enforced by the endpoint', async () => {
    const token = await tokenFor(ids.admin);
    const from = await request(app).get(`/api/v1/audit-events?dateFrom=2026-08-10&dateTo=2026-08-10&actor=Audit%20Admin&entityType=LeaveRequest&action=UPDATE`).set('Authorization', `Bearer ${token}`);
    assert.equal(from.status, 200);
    assert.deepEqual(from.body.data.map((row) => row.entityId), [`${entityPrefix}leave`]);
    const technical = await request(app).get('/api/v1/audit-events?category=technical').set('Authorization', `Bearer ${token}`);
    assert.equal(technical.status, 200);
    assert.deepEqual(technical.body.data.map((row) => row.entityId), [`${entityPrefix}refresh`]);
    const search = await request(app).get('/api/v1/audit-events?search=license').set('Authorization', `Bearer ${token}`);
    assert.equal(search.status, 200);
    assert.deepEqual(search.body.data.map((row) => row.entityId), [`${entityPrefix}license`]);
    const invalid = await request(app).get('/api/v1/audit-events?pageSize=101').set('Authorization', `Bearer ${token}`);
    assert.equal(invalid.status, 400);
  });

  test('Audit Log endpoint remains ADMIN-only and read-only', async () => {
    assert.equal((await request(app).get('/api/v1/audit-events')).status, 401);
    assert.equal((await request(app).get('/api/v1/audit-events').set('Authorization', `Bearer ${await tokenFor(ids.manager)}`)).status, 403);
    assert.equal((await request(app).get('/api/v1/audit-events').set('Authorization', `Bearer ${await tokenFor(ids.viewer)}`)).status, 403);
    assert.equal((await request(app).post('/api/v1/audit-events').set('Authorization', `Bearer ${await tokenFor(ids.admin)}`)).status, 404);
    assert.equal((await request(app).delete('/api/v1/audit-events').set('Authorization', `Bearer ${await tokenFor(ids.admin)}`)).status, 404);
  });
}
