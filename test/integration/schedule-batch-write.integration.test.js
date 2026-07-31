const { randomUUID } = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('schedule batch database integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (process.env.NODE_ENV !== 'test') throw new Error('Schedule batch integration tests require NODE_ENV=test.');

  let databaseName;
  try {
    databaseName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
  } catch {
    throw new Error('Schedule batch integration tests require a valid test database URL.');
  }
  if (databaseName !== 'sms_v3_test') throw new Error('Schedule batch integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  const runToken = randomUUID();
  const runMarker = `sbw-${runToken}`;
  const createdIds = {
    user: new Set(),
    employee: new Set(),
    shiftAssignment: new Set(),
    scheduleApproval: new Set(),
    auditLog: new Set()
  };

  function monthFor(marker, attempt) {
    const offset = Number.parseInt(marker.slice(attempt * 6, attempt * 6 + 6), 16);
    const year = 2000 + (offset % 7000);
    const month = (offset % 12) + 1;
    return new Date(Date.UTC(year, month - 1, 1));
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  async function reserveScheduleApproval(userId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const month = monthFor(runToken, attempt);
      try {
        const approval = await prisma.scheduleApproval.create({
          data: {
            month,
            status: 'PENDING',
            revision: 0,
            changedByLegacyRef: userId,
            changeType: 'INTEGRATION_TEST_RESERVATION',
            approvalNote: runMarker
          }
        });
        createdIds.scheduleApproval.add(approval.id);
        return month;
      } catch (error) {
        if (error.code !== 'P2002' || attempt === 4) throw error;
      }
    }
    throw new Error('Unable to reserve an isolated schedule approval month.');
  }

  async function cleanupFixtures() {
    const ids = (name) => [...createdIds[name]];
    const deleteTracked = async (model, name) => {
      const trackedIds = ids(name);
      if (trackedIds.length > 0) await model.deleteMany({ where: { id: { in: trackedIds } } });
    };

    await deleteTracked(prisma.auditLog, 'auditLog');
    await deleteTracked(prisma.shiftAssignment, 'shiftAssignment');
    await deleteTracked(prisma.scheduleApproval, 'scheduleApproval');
    await deleteTracked(prisma.employee, 'employee');
    await deleteTracked(prisma.user, 'user');

    for (const [model, name] of [
      [prisma.auditLog, 'auditLog'],
      [prisma.shiftAssignment, 'shiftAssignment'],
      [prisma.scheduleApproval, 'scheduleApproval'],
      [prisma.employee, 'employee'],
      [prisma.user, 'user']
    ]) {
      const trackedIds = ids(name);
      if (trackedIds.length > 0) assert.equal(await model.count({ where: { id: { in: trackedIds } } }), 0, `${name} fixtures for ${runMarker} were not cleaned up`);
    }
  }

  async function setupFixtures() {
    const user = await prisma.user.create({
      data: {
        email: `${runMarker}@example.test`,
        passwordHash: 'integration-test-hash',
        displayName: `Schedule Batch ${runMarker}`,
        role: 'ADMIN'
      }
    });
    createdIds.user.add(user.id);

    const employee = await prisma.employee.create({
      data: {
        employeeCode: `SBW-${runToken}`,
        firstName: 'Schedule',
        lastName: `Batch ${runMarker}`,
        department: `Integration ${runMarker}`,
        isActive: true
      }
    });
    createdIds.employee.add(employee.id);

    const testMonth = await reserveScheduleApproval(user.id);
    const off = await prisma.shiftType.findFirstOrThrow({ where: { code: 'OFF' } });
    return { user, employee, off, testMonth };
  }

  test('schedule batch write/read/update/batch/rollback flow uses isolated per-run fixtures', async () => {
    try {
      const { user, employee, off, testMonth } = await setupFixtures();
      const token = accessTokenFor(user);
      const dateStart = testMonth;
      const assignment = (day, remark) => {
        const workDate = new Date(Date.UTC(testMonth.getUTCFullYear(), testMonth.getUTCMonth(), day));
        return { employeeId: employee.id, shiftTypeId: off.id, workDate: isoDate(workDate), remark: `${runMarker}:${remark}` };
      };
      const write = (assignments) => request(app).post('/api/v1/schedules/batch').set('Authorization', `Bearer ${token}`).send({ assignments });

      const first = await write([assignment(1, 'create')]);
      assert.equal(first.status, 200);
      let saved = await prisma.shiftAssignment.findUniqueOrThrow({
        where: { workDate_employeeId: { workDate: dateStart, employeeId: employee.id } },
        include: { shiftType: true }
      });
      createdIds.shiftAssignment.add(saved.id);
      assert.equal(saved.remark, `${runMarker}:create`);
      assert.equal(saved.locked, true);
      assert.equal(saved.shiftType.code, 'OFF');
      assert.equal(isoDate(saved.workDate), isoDate(dateStart));

      const updated = await write([assignment(1, 'update')]);
      assert.equal(updated.status, 200);
      saved = await prisma.shiftAssignment.findUniqueOrThrow({ where: { workDate_employeeId: { workDate: dateStart, employeeId: employee.id } } });
      createdIds.shiftAssignment.add(saved.id);
      assert.equal(saved.remark, `${runMarker}:update`);

      const batch = await write([assignment(2, 'batch-2'), assignment(3, 'batch-3'), assignment(4, 'batch-4')]);
      assert.equal(batch.status, 200);
      assert.equal(batch.body.data.count, 3);
      for (const record of batch.body.data.data) createdIds.shiftAssignment.add(record.id);
      assert.equal(await prisma.shiftAssignment.count({ where: { id: { in: [...createdIds.shiftAssignment] } } }), 4);

      const rollback = await write([assignment(5, 'must-rollback'), { ...assignment(6, 'invalid-employee'), employeeId: randomUUID() }]);
      assert.equal(rollback.status, 400);
      assert.equal(await prisma.shiftAssignment.findUnique({
        where: { workDate_employeeId: { workDate: new Date(Date.UTC(testMonth.getUTCFullYear(), testMonth.getUTCMonth(), 5)), employeeId: employee.id } }
      }), null);
    } finally {
      await cleanupFixtures();
    }
  });
}
