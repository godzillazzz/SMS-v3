process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('leave approval transaction reliability integration suite requires RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('Integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  const ids = {
    targetEmployee: 'd2028000-0000-4000-8000-000000000029',
    approverEmployee: 'd2028000-0000-4000-8000-000000000005',
    approverUser: 'd2028000-0000-4000-8000-000000000105',
    leave: 'd2028000-0000-4000-8000-000000000305',
    quota: 'd2028000-0000-4000-8000-000000000405',
    createdShiftType: 'd2028000-0000-4000-8000-000000000205'
  };
  const workDate = new Date('2026-05-12T00:00:00.000Z');
  const fp = (label) => crypto.createHash('sha256').update(`p2028:${label}:${crypto.randomUUID()}`).digest('hex');
  let createdAlShiftType = false;

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: ids.approverUser }, { entityType: 'LeaveRequest', entityId: ids.leave }] } });
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: { in: [ids.targetEmployee, ids.approverEmployee] } } });
    await prisma.leaveRequest.deleteMany({ where: { id: ids.leave } });
    await prisma.leaveQuota.deleteMany({ where: { OR: [{ id: ids.quota }, { employeeId: { in: [ids.targetEmployee, ids.approverEmployee] } }] } });
    await prisma.refreshSession.deleteMany({ where: { userId: ids.approverUser } });
    await prisma.user.deleteMany({ where: { id: ids.approverUser } });
    await prisma.employee.deleteMany({ where: { id: { in: [ids.targetEmployee, ids.approverEmployee] } } });
    if (createdAlShiftType) {
      await prisma.shiftType.deleteMany({ where: { id: ids.createdShiftType } });
      createdAlShiftType = false;
    }
  }

  async function ensureAlShiftType() {
    const existing = await prisma.shiftType.findUnique({ where: { code: 'AL' } });
    if (existing) return existing;
    createdAlShiftType = true;
    return prisma.shiftType.create({ data: { id: ids.createdShiftType, code: 'AL', name: 'Annual Leave', startTime: '08:00', endTime: '17:00', hours: 8, color: '#64748B' } });
  }

  async function seed({ selfApproval = false } = {}) {
    await cleanup();
    const target = await prisma.employee.create({ data: { id: ids.targetEmployee, employeeCode: 'EMP029', firstName: 'ชยรบ', lastName: 'วัดแก้ว', displayName: 'ชยรบ วัดแก้ว', department: 'AN6', jobTitle: 'Security Guard', isActive: true } });
    const approver = await prisma.employee.create({ data: { id: ids.approverEmployee, employeeCode: 'EMP005', firstName: 'อัคเดช', lastName: 'ชาริดา', displayName: 'อัคเดช ชาริดา', department: 'AN6', jobTitle: 'Team Leader', isActive: true } });
    const user = await prisma.user.create({ data: { id: ids.approverUser, email: 'p2028-manager@integration.test', passwordHash: 'unused', displayName: 'P2028 Manager', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', employeeId: approver.id } });
    await ensureAlShiftType();
    const leaveEmployee = selfApproval ? approver : target;
    await prisma.leaveQuota.create({ data: { id: ids.quota, sourceFingerprint: fp('quota'), employeeId: leaveEmployee.id, quotaYear: 2026, employeeNameSnapshot: leaveEmployee.displayName, sickLeave: 30, personalLeave: 3, vacationLeave: 1, matchStatus: 'MATCHED' } });
    await prisma.leaveRequest.create({ data: { id: ids.leave, sourceFingerprint: fp('leave'), employeeId: leaveEmployee.id, requestedAt: new Date('2026-05-01T00:00:00.000Z'), employeeNameSnapshot: leaveEmployee.displayName, departmentSnapshot: leaveEmployee.department, leaveType: 'VACATION', startDate: workDate, endDate: workDate, dayCount: 1, reason: 'P2028 reliability fixture', status: 'PENDING', createdByUserId: null } });
    return { target, approver, user };
  }

  async function approve(token) {
    return request(app).put(`/api/v1/leave-requests/${ids.leave}`).set('Authorization', `Bearer ${token}`).send({ status: 'APPROVED' });
  }

  test('exact EMP029 logical state approves retroactively and cannot double-apply', async () => {
    const fixture = await seed();
    try {
      const token = accessTokenFor(fixture.user);
      const response = await approve(token);
      assert.equal(response.status, 200);
      assert.equal(response.body.data.status, 'APPROVED');
      const repeat = await approve(token);
      assert.equal(repeat.status, 409);
      const leave = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: ids.leave } });
      const shifts = await prisma.shiftAssignment.findMany({ where: { employeeId: ids.targetEmployee, workDate }, include: { shiftType: true } });
      const quota = await prisma.leaveQuota.findUniqueOrThrow({ where: { id: ids.quota } });
      const approvedUsage = await prisma.leaveRequest.count({ where: { id: ids.leave, status: 'APPROVED' } });
      const audits = await prisma.auditLog.count({ where: { entityType: 'LeaveRequest', entityId: ids.leave, action: 'UPDATE' } });
      assert.equal(leave.status, 'APPROVED');
      assert.equal(shifts.length, 1);
      assert.equal(shifts[0].shiftType.code, 'AL');
      assert.equal(shifts[0].source, 'LEAVE_APPROVAL');
      assert.equal(Number(quota.vacationLeave), 1);
      assert.equal(approvedUsage, 1);
      assert.equal(audits, 1);
    } finally {
      await cleanup();
    }
  });

  test('Manager self-approval remains blocked without any approval side effect', async () => {
    const fixture = await seed({ selfApproval: true });
    try {
      const response = await approve(accessTokenFor(fixture.user));
      assert.equal(response.status, 400);
      assert.equal(await prisma.leaveRequest.count({ where: { id: ids.leave, status: 'PENDING' } }), 1);
      assert.equal(await prisma.shiftAssignment.count({ where: { employeeId: ids.approverEmployee, workDate } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { entityType: 'LeaveRequest', entityId: ids.leave } }), 0);
    } finally {
      await cleanup();
    }
  });

  test.after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
}
