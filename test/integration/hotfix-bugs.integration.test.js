process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('hotfix bugs integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  const adminId = '90000000-0000-4000-8000-000000000001';
  const managerId = '90000000-0000-4000-8000-000000000002';
  const empId = '90000000-0000-4000-8000-000000000003';
  const monthStr = '2026-08';
  const monthDate = new Date(Date.UTC(2026, 7, 1));

  async function tokenFor(id) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    return accessTokenFor(user);
  }

  const dTypeId = '10000000-0000-4000-8000-000000000101';
  const alTypeId = '20000000-0000-4000-8000-000000000102';
  const nTypeId = '30000000-0000-4000-8000-000000000103';

  async function setupFixtures() {
    await cleanupFixtures();
    await prisma.user.createMany({
      data: [
        { id: adminId, email: 'hotfix-admin@test.local', passwordHash: 'hash', displayName: 'Hotfix Admin', role: 'ADMIN', isActive: true },
        { id: managerId, email: 'hotfix-manager@test.local', passwordHash: 'hash', displayName: 'Hotfix Manager', role: 'MANAGER', isActive: true }
      ]
    });
    await prisma.employee.create({
      data: { id: empId, employeeCode: 'TEST-HOTFIX', firstName: 'Hotfix', lastName: 'Employee', isActive: true }
    });
    await prisma.shiftType.createMany({
      data: [
        { id: dTypeId, code: 'D', name: 'Day', startTime: '08:00', endTime: '17:00', hours: 8 },
        { id: alTypeId, code: 'AL', name: 'Annual Leave', startTime: '08:00', endTime: '17:00', hours: 8 },
        { id: nTypeId, code: 'N', name: 'Night', startTime: '20:00', endTime: '05:00', hours: 8 }
      ],
      skipDuplicates: true
    });
  }

  async function cleanupFixtures() {
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: empId } });
    await prisma.scheduleApproval.deleteMany({ where: { month: monthDate } });
    await prisma.employee.deleteMany({ where: { id: empId } });
    await prisma.shiftType.deleteMany({ where: { id: { in: [dTypeId, alTypeId, nTypeId] } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [adminId, managerId] } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [adminId, managerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, managerId] } } });
  }

  test('Bug 1 — Integration: Schedule Approval & Revision Workflow with DB', async () => {
    await setupFixtures();
    const adminToken = await tokenFor(adminId);
    const managerToken = await tokenFor(managerId);

    try {
      const dType = await prisma.shiftType.findFirstOrThrow({ where: { code: 'D' } });
      const alType = await prisma.shiftType.findFirstOrThrow({ where: { code: 'AL' } });

      // 1. Create a non-AL shift for 2026-08-01 -> Schedule status initialized to PENDING (rev 1)
      const shiftRes = await request(app)
        .post('/api/v1/shifts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: empId,
          shiftTypeId: dType.id,
          workDate: '2026-08-01',
          licenseOverride: true,
          overrideReason: 'Testing schedule workflow'
        });
      assert.equal(shiftRes.status, 201);

      let appr = await prisma.scheduleApproval.findFirst({ where: { month: monthDate } });
      assert.equal(appr.status, 'PENDING');
      assert.equal(appr.revision, 1);

      // 2. Manager attempts approval -> 403 Forbidden
      const mgrApprove = await request(app)
        .post('/api/v1/schedule/approve-month')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ month: monthStr, note: 'Manager approve' });
      assert.equal(mgrApprove.status, 403);

      // 3. Admin approves pending schedule -> 200 OK, revision becomes 2
      const adminApprove = await request(app)
        .post('/api/v1/schedule/approve-month')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ month: monthStr, note: 'Admin approve' });
      assert.equal(adminApprove.status, 200);
      assert.equal(adminApprove.body.data.status, 'APPROVED');
      assert.equal(adminApprove.body.data.revision, 2);

      // 4. Repeated Admin approve click -> Idempotent, revision remains 2
      const repeatApprove = await request(app)
        .post('/api/v1/schedule/approve-month')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ month: monthStr, note: 'Admin approve repeat' });
      assert.equal(repeatApprove.status, 200);
      assert.equal(repeatApprove.body.data.status, 'APPROVED');
      assert.equal(repeatApprove.body.data.revision, 2);

      // 5. AL-only change -> Preserves APPROVED status and revision 2
      const alRes = await request(app)
        .post('/api/v1/shifts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: empId,
          shiftTypeId: alType.id,
          workDate: '2026-08-02'
        });
      assert.equal(alRes.status, 201);

      appr = await prisma.scheduleApproval.findFirst({ where: { month: monthDate } });
      assert.equal(appr.status, 'APPROVED');
      assert.equal(appr.revision, 2);

      // 6. Meaningful non-AL edit -> Resets status to PENDING, preserves revision 2
      const nonAlEdit = await request(app)
        .post('/api/v1/shifts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          employeeId: empId,
          shiftTypeId: dType.id,
          workDate: '2026-08-03',
          licenseOverride: true,
          overrideReason: 'Testing schedule workflow'
        });
      assert.equal(nonAlEdit.status, 201);

      appr = await prisma.scheduleApproval.findFirst({ where: { month: monthDate } });
      assert.equal(appr.status, 'PENDING');
      assert.equal(appr.revision, 2);

      // 7. Admin re-approves -> Status becomes APPROVED, revision increments to 3
      const reApprove = await request(app)
        .post('/api/v1/schedule/approve-month')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ month: monthStr, note: 'Re-approved' });
      assert.equal(reApprove.status, 200);
      assert.equal(reApprove.body.data.status, 'APPROVED');
      assert.equal(reApprove.body.data.revision, 3);

    } finally {
      await cleanupFixtures();
    }
  });
}
