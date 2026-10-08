const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('roster source response requires an explicit disposable database', { skip: true }, () => {});
} else {
  const target = new URL(process.env.DATABASE_URL || '');
  const allowed = process.env.NODE_ENV === 'test' && target.pathname === '/sms_v3_test'
    && target.hostname === '127.0.0.1'
    && (target.port === '5433' || (target.port === '5432' && process.env.TEST_DATABASE_RUNNER === 'docker-container-network'));
  if (!allowed || process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('An isolated roster test database without Production credentials is required.');
  const request = require('supertest');
  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  test('Calendar GET exposes persisted source without changing shifts or approved snapshots', async () => {
    const marker = randomUUID();
    let user, employee, approval;
    try {
      user = await prisma.user.create({ data: { email: `roster-${marker}@example.test`, displayName: 'Roster fixture', passwordHash: 'test-only-hash', role: 'ADMIN' } });
      employee = await prisma.employee.create({ data: { employeeCode: `SRC-${marker}`, firstName: 'Source', lastName: 'Fixture', department: `source-${marker}`, isActive: true } });
      const month = new Date(Date.UTC(2300 + parseInt(marker.slice(0, 4), 16) % 6000, 0, 1));
      const approvedAt = new Date('2026-01-01T00:00:00Z');
      approval = await prisma.scheduleApproval.create({ data: { month, revision: 3, status: 'APPROVED', approvedByLegacyRef: user.id, approvedAt } });
      const off = await prisma.shiftType.findFirstOrThrow({ where: { code: 'OFF' } });
      const sources = ['SMS_V3', 'AUTO', 'LEAVE_APPROVAL'];
      await prisma.shiftAssignment.createMany({ data: sources.map((source, index) => ({ employeeId: employee.id, shiftTypeId: off.id, workDate: new Date(Date.UTC(month.getUTCFullYear(), 0, index + 1)), source, employeeNameSnapshot: 'Source Fixture', departmentSnapshot: employee.department, hours: 0, remark: 'Manual batch edit' })) });
      const before = await prisma.shiftAssignment.findMany({ where: { employeeId: employee.id }, orderBy: { workDate: 'asc' } });
      const approvalBefore = await prisma.scheduleApproval.findUniqueOrThrow({ where: { id: approval.id } });
      const response = await request(app).get('/api/v1/schedule-calendar')
        .set('Authorization', `Bearer ${accessTokenFor(user)}`)
        .query({ month: `${month.getUTCFullYear()}-01`, department: employee.department });
      assert.equal(response.status, 200);
      const row = response.body.data.employees.find(row => row.id === employee.id);
      assert.ok(row, 'fixture employee must be present');
      assert.deepEqual(row.shifts.map(shift => shift.source), sources);
      assert.deepEqual(await prisma.shiftAssignment.findMany({ where: { employeeId: employee.id }, orderBy: { workDate: 'asc' } }), before);
      assert.deepEqual(await prisma.scheduleApproval.findUniqueOrThrow({ where: { id: approval.id } }), approvalBefore);
      assert.equal(await prisma.scheduleApproval.count({ where: { month } }), 1);
    } finally {
      if (employee) await prisma.shiftAssignment.deleteMany({ where: { employeeId: employee.id } });
      if (approval) await prisma.scheduleApproval.delete({ where: { id: approval.id } });
      if (employee) await prisma.employee.delete({ where: { id: employee.id } });
      if (user) await prisma.user.delete({ where: { id: user.id } });
      await prisma.$disconnect();
    }
  });
}
