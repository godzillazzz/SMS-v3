process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('CFG-04 Shift Type controls integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  const ids = {
    admin: '94040000-0000-4000-8000-000000000001',
    manager: '94040000-0000-4000-8000-000000000002',
    employee: '94040000-0000-4000-8000-000000000003'
  };
  const code = 'CFG04X';
  const workDates = [
    new Date(Date.UTC(2026, 11, 15)),
    new Date(Date.UTC(2026, 11, 16))
  ];
  const month = new Date(Date.UTC(2026, 11, 1));

  async function cleanup() {
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.scheduleApproval.deleteMany({ where: { month } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [ids.admin, ids.manager] } } });
    await prisma.shiftType.deleteMany({ where: { code } });
    await prisma.employee.deleteMany({ where: { id: ids.employee } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [ids.admin, ids.manager] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.manager] } } });
  }

  async function tokenFor(id) {
    return accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id } }));
  }

  test('CFG-04 governs Shift Type lifecycle without rewriting schedule history', async () => {
    await cleanup();
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: 'cfg04-admin@integration.test', passwordHash: 'unused', displayName: 'CFG04 Admin', role: 'ADMIN', isActive: true },
      { id: ids.manager, email: 'cfg04-manager@integration.test', passwordHash: 'unused', displayName: 'CFG04 Manager', role: 'MANAGER', isActive: true }
    ] });
    await prisma.employee.create({
      data: { id: ids.employee, employeeCode: 'CFG04-EMP', firstName: 'CFG04', lastName: 'Employee', displayName: 'CFG04 Employee', isActive: true }
    });

    const adminToken = await tokenFor(ids.admin);
    const managerToken = await tokenFor(ids.manager);

    try {
      const created = await request(app)
        .post('/api/v1/shift-types')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code, name: 'CFG04 Original', startTime: '08:00', endTime: '17:00', hours: 8, color: '#123456', isActive: true });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.code, code);
      assert.equal(created.body.data.isActive, true);
      const shiftTypeId = created.body.data.id;

      const initialAssignment = await request(app)
        .post('/api/v1/shifts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: ids.employee,
          shiftTypeId,
          workDate: '2026-12-15',
          licenseOverride: true,
          overrideReason: 'CFG04 integration override'
        });
      assert.equal(initialAssignment.status, 201);
      assert.equal(initialAssignment.body.data.startTime, '08:00');
      assert.equal(Number(initialAssignment.body.data.hours), 8);

      const changedCode = await request(app)
        .put(`/api/v1/shift-types/${shiftTypeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'CFG04Y' });
      assert.equal(changedCode.status, 400);

      const edited = await request(app)
        .put(`/api/v1/shift-types/${shiftTypeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'CFG04 Updated', startTime: '09:00', endTime: '18:00', hours: 9, color: '#654321', isActive: false });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.data.code, code);
      assert.equal(edited.body.data.name, 'CFG04 Updated');
      assert.equal(edited.body.data.isActive, false);

      const managerDefault = await request(app)
        .get('/api/v1/shift-types')
        .set('Authorization', `Bearer ${managerToken}`);
      assert.equal(managerDefault.status, 200);
      assert.equal(managerDefault.body.data.some((row) => row.id === shiftTypeId), false);

      const managerIncludeInactive = await request(app)
        .get('/api/v1/shift-types?includeInactive=true')
        .set('Authorization', `Bearer ${managerToken}`);
      assert.equal(managerIncludeInactive.status, 403);

      const adminIncludeInactive = await request(app)
        .get('/api/v1/shift-types?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(adminIncludeInactive.status, 200);
      const adminRow = adminIncludeInactive.body.data.find((row) => row.id === shiftTypeId);
      assert.equal(adminRow.isActive, false);

      const blockedAssignment = await request(app)
        .post('/api/v1/shifts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: ids.employee,
          shiftTypeId,
          workDate: '2026-12-16',
          licenseOverride: true,
          overrideReason: 'CFG04 integration override'
        });
      assert.equal(blockedAssignment.status, 409);
      assert.match(String(blockedAssignment.body?.message || blockedAssignment.text), /inactive/i);

      const historical = await prisma.shiftAssignment.findUniqueOrThrow({
        where: { workDate_employeeId: { workDate: workDates[0], employeeId: ids.employee } }
      });
      assert.equal(historical.shiftTypeId, shiftTypeId);
      assert.equal(historical.startTime, '08:00');
      assert.equal(historical.endTime, '17:00');
      assert.equal(Number(historical.hours), 8);

      const deleteReferenced = await request(app)
        .delete(`/api/v1/shift-types/${shiftTypeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(deleteReferenced.status, 409);

      const coreD = await prisma.shiftType.findUnique({ where: { code: 'D' } });
      assert.ok(coreD, 'seeded core D shift must exist');
      const deactivateCore = await request(app)
        .put(`/api/v1/shift-types/${coreD.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });
      assert.equal(deactivateCore.status, 400);
      assert.equal((await prisma.shiftType.findUniqueOrThrow({ where: { id: coreD.id } })).isActive, true);

      const audits = await prisma.auditLog.findMany({
        where: { actorUserId: ids.admin, entityType: 'ShiftType', entityId: shiftTypeId },
        select: { action: true },
        orderBy: { createdAt: 'asc' }
      });
      assert.deepEqual(audits.map((event) => event.action), ['CREATE', 'UPDATE']);
    } finally {
      await cleanup();
    }
  });

  test.after(async () => { await cleanup(); await prisma.$disconnect(); });
}
