'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('CFG-03 Leave Type Master integration suite requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  const ids = {
    admin: 'a8030000-0000-4000-8000-000000000001',
    viewer: 'a8030000-0000-4000-8000-000000000002',
    employee: 'b8030000-0000-4000-8000-000000000001'
  };
  const customCode = 'CFG03_TRAINING';

  function bangkokDateOffset(days) {
    const now = new Date();
    const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const utcDate = new Date(Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth(), bangkok.getUTCDate() + days));
    return utcDate.toISOString().slice(0, 10);
  }

  async function cleanup() {
    await prisma.leaveAttachment.deleteMany({ where: { leaveRequest: { employeeId: ids.employee } } });
    const leaveIds = (await prisma.leaveRequest.findMany({ where: { employeeId: ids.employee }, select: { id: true } })).map((row) => row.id);
    if (leaveIds.length) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'LeaveRequest', entityId: { in: leaveIds } } });
    }
    await prisma.leaveRequest.deleteMany({ where: { employeeId: ids.employee } });

    const custom = await prisma.leaveTypeMaster.findUnique({ where: { code: customCode }, select: { id: true } });
    if (custom) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'LeaveTypeMaster', entityId: custom.id } });
      await prisma.leaveTypeMaster.delete({ where: { id: custom.id } });
    }

    await prisma.refreshSession.deleteMany({ where: { userId: { in: [ids.admin, ids.viewer] } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [ids.admin, ids.viewer] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.viewer] } } });
    await prisma.employee.deleteMany({ where: { id: ids.employee } });
  }

  async function seed() {
    await cleanup();
    await prisma.employee.create({
      data: {
        id: ids.employee,
        employeeCode: 'CFG03-E',
        firstName: 'CFG03',
        lastName: 'Employee',
        displayName: 'CFG03 Employee',
        department: 'Security',
        jobTitle: 'Officer',
        isActive: true
      }
    });
    await prisma.user.createMany({
      data: [
        {
          id: ids.admin,
          email: 'cfg03-admin@integration.test',
          passwordHash: 'unused',
          displayName: 'CFG03 Admin',
          role: 'ADMIN',
          isActive: true
        },
        {
          id: ids.viewer,
          email: 'cfg03-viewer@integration.test',
          passwordHash: 'unused',
          displayName: 'CFG03 Viewer',
          role: 'VIEWER',
          isActive: true,
          employeeId: ids.employee
        }
      ]
    });
  }

  async function tokens() {
    return {
      admin: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })),
      viewer: accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id: ids.viewer } }))
    };
  }

  test('CFG-03 Admin creates custom NONE-bucket type, request snapshots it, rename does not rewrite history, inactive blocks new requests', async () => {
    await seed();
    const token = await tokens();

    const createdType = await request(app)
      .post('/api/v1/leave-types')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({
        code: customCode,
        name: 'ลาฝึกอบรม',
        quotaBucket: 'NONE',
        sortOrder: 70
      });
    assert.equal(createdType.status, 201);
    assert.equal(createdType.body.data.code, customCode);
    assert.equal(createdType.body.data.quotaBucket, 'NONE');
    assert.equal(createdType.body.data.isSystem, false);

    const futureOne = bangkokDateOffset(20);
    const leaveCreate = await request(app)
      .post('/api/v1/leave-requests')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({
        employeeId: ids.employee,
        leaveType: customCode,
        startDate: futureOne,
        endDate: futureOne,
        substitute: 'CFG03 Substitute',
        reason: 'training'
      });
    assert.equal(leaveCreate.status, 201);
    assert.equal(leaveCreate.body.data.leaveType, customCode);
    assert.equal(leaveCreate.body.data.leaveTypeNameSnapshot, 'ลาฝึกอบรม');
    assert.equal(leaveCreate.body.data.leaveQuotaBucketSnapshot, 'NONE');

    assert.equal(await prisma.leaveQuota.count({ where: { employeeId: ids.employee } }), 0, 'NONE bucket must not auto-create annual quota');

    const rename = await request(app)
      .put('/api/v1/leave-types/' + createdType.body.data.id)
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ name: 'ลาฝึกอบรมภายนอก', isActive: false });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.data.name, 'ลาฝึกอบรมภายนอก');
    assert.equal(rename.body.data.isActive, false);

    const persisted = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveCreate.body.data.id } });
    assert.equal(persisted.leaveType, customCode);
    assert.equal(persisted.leaveTypeNameSnapshot, 'ลาฝึกอบรม', 'historical display name snapshot must not change after master rename');
    assert.equal(persisted.leaveQuotaBucketSnapshot, 'NONE');

    const futureTwo = bangkokDateOffset(22);
    const blocked = await request(app)
      .post('/api/v1/leave-requests')
      .set('Authorization', 'Bearer ' + token.admin)
      .send({
        employeeId: ids.employee,
        leaveType: customCode,
        startDate: futureTwo,
        endDate: futureTwo,
        substitute: 'CFG03 Substitute',
        reason: 'inactive should block'
      });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.details?.code, 'LEAVE_TYPE_INACTIVE');

    const viewerList = await request(app)
      .get('/api/v1/leave-types')
      .set('Authorization', 'Bearer ' + token.viewer);
    assert.equal(viewerList.status, 200);
    assert.equal(viewerList.body.data.some((row) => row.code === customCode), false, 'inactive types must be hidden from non-Admin selection');

    const adminList = await request(app)
      .get('/api/v1/leave-types?includeInactive=true')
      .set('Authorization', 'Bearer ' + token.admin);
    assert.equal(adminList.status, 200);
    assert.equal(adminList.body.data.some((row) => row.code === customCode && row.isActive === false), true);

    const createAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'LeaveTypeMaster', entityId: createdType.body.data.id, action: 'CREATE' }
    });
    const updateAudit = await prisma.auditLog.findFirst({
      where: { entityType: 'LeaveTypeMaster', entityId: createdType.body.data.id, action: 'UPDATE' }
    });
    assert.ok(createAudit);
    assert.ok(updateAudit);

    await cleanup();
  });

  test('CFG-03 core quota bucket is immutable while name/active governance remains available', async () => {
    await seed();
    const token = await tokens();

    const core = await prisma.leaveTypeMaster.findUniqueOrThrow({ where: { code: 'SICK' } });
    const blocked = await request(app)
      .put('/api/v1/leave-types/' + core.id)
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ quotaBucket: 'PERSONAL' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.details?.code, 'CORE_LEAVE_TYPE_QUOTA_BUCKET_IMMUTABLE');

    const renamed = await request(app)
      .put('/api/v1/leave-types/' + core.id)
      .set('Authorization', 'Bearer ' + token.admin)
      .send({ name: core.name, isActive: true, sortOrder: core.sortOrder });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.code, 'SICK');
    assert.equal(renamed.body.data.quotaBucket, 'SICK');

    await cleanup();
  });
}
