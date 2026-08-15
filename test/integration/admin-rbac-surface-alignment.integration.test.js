process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('administrative RBAC surface integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  const ids = {
    admin: '91000000-0000-4000-8000-000000000001',
    manager: '91000000-0000-4000-8000-000000000002',
    viewer: '91000000-0000-4000-8000-000000000003',
  };
  const months = [
    new Date(Date.UTC(2026, 8, 1)),
    new Date(Date.UTC(2026, 9, 1)),
    new Date(Date.UTC(2026, 10, 1))
  ];

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [ids.admin, ids.manager, ids.viewer] } } });
    await prisma.scheduleApproval.deleteMany({ where: { month: { in: months } } });
    await prisma.shiftType.deleteMany({ where: { code: 'RBAC_TEST' } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [ids.admin, ids.manager, ids.viewer] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.manager, ids.viewer] } } });
  }

  async function tokenFor(id) {
    return accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id } }));
  }

  test('mounted approval aliases and Shift Type writes enforce Admin-only policy and audit success', async () => {
    await cleanup();
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: 'rbac-admin@integration.test', passwordHash: 'unused', displayName: 'RBAC Admin', role: 'ADMIN', isActive: true },
      { id: ids.manager, email: 'rbac-manager@integration.test', passwordHash: 'unused', displayName: 'RBAC Manager', role: 'MANAGER', isActive: true },
      { id: ids.viewer, email: 'rbac-viewer@integration.test', passwordHash: 'unused', displayName: 'RBAC Viewer', role: 'VIEWER', isActive: true }
    ] });

      const tokens = {
      admin: await tokenFor(ids.admin),
      manager: await tokenFor(ids.manager),
      viewer: await tokenFor(ids.viewer)
    };

    try {
      for (const role of ['manager', 'viewer']) {
        const readResponse = await request(app).get('/api/v1/shift-types').set('Authorization', `Bearer ${tokens[role]}`);
        assert.equal(readResponse.status, 200, `${role} Shift Type read`);
      }
      for (const path of ['/api/v1/schedules/approve', '/api/v1/schedule-calendar/approve']) {
        for (const role of ['manager', 'viewer']) {
          const response = await request(app).post(path).set('Authorization', `Bearer ${tokens[role]}`).send({ month: '2026-09', note: `${role} attempt`, role: 'ADMIN' });
          assert.equal(response.status, 403, `${role} ${path}`);
        }
      }
      assert.equal(await prisma.scheduleApproval.count({ where: { month: months[0] } }), 0);

      const adminApproval = await request(app).post('/api/v1/schedules/approve').set('Authorization', `Bearer ${tokens.admin}`).send({ month: '2026-09', note: 'Admin approval' });
      assert.equal(adminApproval.status, 200);
      assert.equal(adminApproval.body.data.status, 'APPROVED');
      const aliasApproval = await request(app).post('/api/v1/schedule-calendar/approve').set('Authorization', `Bearer ${tokens.admin}`).send({ month: '2026-09', note: 'Alias approval' });
      assert.equal(aliasApproval.status, 200);

      const operationManager = await request(app).post('/api/v1/schedule/approve-month').set('Authorization', `Bearer ${tokens.manager}`).send({ month: '2026-10' });
      assert.equal(operationManager.status, 403);
      const operationAdmin = await request(app).post('/api/v1/schedule/approve-month').set('Authorization', `Bearer ${tokens.admin}`).send({ month: '2026-10' });
      assert.equal(operationAdmin.status, 200);

      const pending = await prisma.scheduleApproval.create({ data: { month: months[2], status: 'PENDING', revision: 1, changeType: 'TEST' } });
      const approvalUpdate = await request(app).put(`/api/v1/schedule-approvals/${pending.id}`).set('Authorization', `Bearer ${tokens.manager}`).send({ status: 'APPROVED' });
      assert.equal(approvalUpdate.status, 403);
      assert.equal((await prisma.scheduleApproval.findUniqueOrThrow({ where: { id: pending.id } })).status, 'PENDING');
      const approvalUpdateAdmin = await request(app).put(`/api/v1/schedule-approvals/${pending.id}`).set('Authorization', `Bearer ${tokens.admin}`).send({ status: 'APPROVED' });
      assert.equal(approvalUpdateAdmin.status, 200);

      const createPayload = { code: 'RBAC_TEST', name: 'RBAC Test Shift', startTime: '08:00', endTime: '17:00', hours: 8, color: '#123456' };
      const created = await request(app).post('/api/v1/shift-types').set('Authorization', `Bearer ${tokens.admin}`).send(createPayload);
      assert.equal(created.status, 201);
      assert.equal(created.body.data.code, createPayload.code);
      const shiftId = created.body.data.id;

      const auditAfterCreate = await prisma.auditLog.count({ where: { actorUserId: ids.admin, entityType: 'ShiftType', entityId: shiftId, action: 'CREATE' } });
      assert.equal(auditAfterCreate, 1);

      for (const role of ['manager', 'viewer']) {
        const deniedCreate = await request(app).post('/api/v1/shift-types').set('Authorization', `Bearer ${tokens[role]}`).send({ ...createPayload, code: `DENIED_${role.toUpperCase()}`, role: 'ADMIN' });
        assert.equal(deniedCreate.status, 403, `${role} create`);
      }

      const updated = await request(app).put(`/api/v1/shift-types/${shiftId}`).set('Authorization', `Bearer ${tokens.admin}`).send({ name: 'RBAC Updated Shift' });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.name, 'RBAC Updated Shift');
      for (const role of ['manager', 'viewer']) {
        const deniedUpdate = await request(app).put(`/api/v1/shift-types/${shiftId}`).set('Authorization', `Bearer ${tokens[role]}`).send({ name: `${role} must not update` });
        assert.equal(deniedUpdate.status, 403, `${role} update`);
      }

      const deletedByManager = await request(app).delete(`/api/v1/shift-types/${shiftId}`).set('Authorization', `Bearer ${tokens.manager}`);
      assert.equal(deletedByManager.status, 403);
      const deletedByViewer = await request(app).delete(`/api/v1/shift-types/${shiftId}`).set('Authorization', `Bearer ${tokens.viewer}`);
      assert.equal(deletedByViewer.status, 403);
      const deleted = await request(app).delete(`/api/v1/shift-types/${shiftId}`).set('Authorization', `Bearer ${tokens.admin}`);
      assert.equal(deleted.status, 204);

      const auditActions = await prisma.auditLog.findMany({ where: { actorUserId: ids.admin, entityType: 'ShiftType', entityId: shiftId }, select: { action: true }, orderBy: { createdAt: 'asc' } });
      assert.deepEqual(auditActions.map((event) => event.action), ['CREATE', 'UPDATE', 'DELETE']);
      assert.equal(await prisma.shiftType.findUnique({ where: { id: shiftId } }), null);
    } finally {
      await cleanup();
    }
  });

  test.after(async () => { await cleanup(); await prisma.$disconnect(); });
}
