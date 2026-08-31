'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('CFG-05 Auto Schedule Pattern Manager integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) {
    throw new Error('CFG-05 integration tests require an isolated sms_v3_test database.');
  }

  const prisma = require('../../src/config/prisma');
  const app = require('../../src/app');
  const { accessTokenFor } = require('../../src/services/auth.service');

  const ids = {
    admin: '95050000-0000-4000-8000-000000000001',
    manager: '95050000-0000-4000-8000-000000000002',
    employee: '95050000-0000-4000-8000-000000000003'
  };
  const customCode = 'CFG05X';
  const monthText = '2026-11';
  const month = new Date(Date.UTC(2026, 10, 1));
  const nextMonth = new Date(Date.UTC(2026, 11, 1));

  async function cleanup() {
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.scheduleApproval.deleteMany({ where: { month: { gte: month, lt: nextMonth } } });
    await prisma.employeeLicense.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [ids.admin, ids.manager] } } });
    await prisma.autoSchedulePattern.deleteMany({ where: { code: customCode } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [ids.admin, ids.manager] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.manager] } } });
    await prisma.employee.deleteMany({ where: { id: ids.employee } });
  }

  async function tokenFor(id) {
    return accessTokenFor(await prisma.user.findUniqueOrThrow({ where: { id } }));
  }

  async function ensureCoreShiftTypes() {
    const rows = [
      { code: 'D', name: 'Day', startTime: '07:00', endTime: '19:00', hours: 12, color: '#2563EB', isActive: true },
      { code: 'N', name: 'Night', startTime: '19:00', endTime: '07:00', hours: 12, color: '#4338CA', isActive: true },
      { code: 'OFF', name: 'Off', startTime: null, endTime: null, hours: 0, color: '#64748B', isActive: true },
      { code: 'AL', name: 'Annual Leave', startTime: null, endTime: null, hours: 0, color: '#16A34A', isActive: true }
    ];
    for (const row of rows) {
      await prisma.shiftType.upsert({
        where: { code: row.code },
        update: { ...row, isActive: true },
        create: row
      });
    }
  }

  async function seedFixtures() {
    await cleanup();
    await ensureCoreShiftTypes();

    await prisma.user.createMany({
      data: [
        { id: ids.admin, email: 'cfg05-admin@integration.test', passwordHash: 'unused', displayName: 'CFG05 Admin', role: 'ADMIN', isActive: true },
        { id: ids.manager, email: 'cfg05-manager@integration.test', passwordHash: 'unused', displayName: 'CFG05 Manager', role: 'MANAGER', isActive: true }
      ]
    });
    await prisma.employee.create({
      data: {
        id: ids.employee,
        employeeCode: 'CFG05-EMP',
        firstName: 'CFG05',
        lastName: 'Employee',
        displayName: 'CFG05 Employee',
        department: 'CFG05',
        jobTitle: 'Security Officer',
        isActive: true
      }
    });
    await prisma.employeeLicense.create({
      data: {
        legacyLicenseId: 'CFG05-LICENSE',
        employeeId: ids.employee,
        licenseType: 'Security',
        licenseNumber: 'CFG05-001',
        issueDate: new Date(Date.UTC(2026, 0, 1)),
        expiryDate: new Date(Date.UTC(2027, 11, 31)),
        status: 'Active'
      }
    });
  }

  test('CFG-05 persists governed patterns, enforces RBAC/core protections, and previews without schedule mutation', async () => {
    await seedFixtures();
    const adminToken = await tokenFor(ids.admin);
    const managerToken = await tokenFor(ids.manager);

    try {
      const managerCreate = await request(app)
        .post('/api/v1/auto-schedule-patterns')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          code: customCode,
          name: 'Blocked manager pattern',
          mode: 'CYCLE',
          steps: [{ phaseCode: 'A1', shiftCode: 'D', label: 'Day' }]
        });
      assert.equal(managerCreate.status, 403);

      const created = await request(app)
        .post('/api/v1/auto-schedule-patterns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: customCode,
          name: 'CFG-05 Custom Cycle',
          mode: 'CYCLE',
          steps: [
            { phaseCode: 'A1', shiftCode: 'N', label: 'Night first' },
            { phaseCode: 'A2', shiftCode: 'OFF', label: 'Rest second' },
            { phaseCode: 'A3', shiftCode: 'D', label: 'Day third' }
          ],
          sortOrder: 90
        });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.code, customCode);
      assert.equal(created.body.data.targetGroup, 'MANUAL');
      assert.equal(created.body.data.isActive, true);
      const customId = created.body.data.id;

      const managerList = await request(app)
        .get('/api/v1/auto-schedule-patterns')
        .set('Authorization', `Bearer ${managerToken}`);
      assert.equal(managerList.status, 200);
      assert.equal(managerList.body.data.some((row) => row.id === customId), true);

      const managerInactive = await request(app)
        .get('/api/v1/auto-schedule-patterns?includeInactive=true')
        .set('Authorization', `Bearer ${managerToken}`);
      assert.equal(managerInactive.status, 403);

      const shiftTypes = await prisma.shiftType.findMany({ where: { code: { in: ['N', 'AL'] } } });
      const n = shiftTypes.find((row) => row.code === 'N');
      const al = shiftTypes.find((row) => row.code === 'AL');
      assert.ok(n);
      assert.ok(al);

      await prisma.shiftAssignment.createMany({
        data: [
          {
            employeeId: ids.employee,
            shiftTypeId: al.id,
            workDate: new Date(Date.UTC(2026, 10, 2)),
            employeeNameSnapshot: 'CFG05 Employee',
            departmentSnapshot: 'CFG05',
            hours: 0,
            source: 'LEAVE_APPROVAL',
            locked: true,
            licenseOverride: false
          },
          {
            employeeId: ids.employee,
            shiftTypeId: n.id,
            workDate: new Date(Date.UTC(2026, 10, 3)),
            employeeNameSnapshot: 'CFG05 Employee',
            departmentSnapshot: 'CFG05',
            startTime: n.startTime,
            endTime: n.endTime,
            hours: n.hours,
            source: 'MANUAL',
            locked: true,
            licenseStatus: 'OVERRIDDEN',
            licenseOverride: true,
            overrideReason: 'CFG-05 Admin override'
          }
        ]
      });

      const beforeCount = await prisma.shiftAssignment.count({ where: { employeeId: ids.employee, workDate: { gte: month, lt: nextMonth } } });
      const beforeApprovalCount = await prisma.scheduleApproval.count({ where: { month } });

      const preview = await request(app)
        .post('/api/v1/schedule/employee-auto-preview')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ month: monthText, employeeId: ids.employee, startPhase: 'A1', patternType: customCode });
      assert.equal(preview.status, 200);
      assert.equal(preview.body.data.pattern.code, customCode);
      assert.equal(preview.body.data.effectivePhase, 'A1');
      const first = preview.body.data.rows.find((row) => row.date === '2026-11-01');
      const leave = preview.body.data.rows.find((row) => row.date === '2026-11-02');
      const override = preview.body.data.rows.find((row) => row.date === '2026-11-03');
      assert.equal(first.code, 'N');
      assert.equal(first.phaseCode, 'A1');
      assert.equal(leave.code, 'AL');
      assert.equal(leave.phaseCode, null);
      assert.equal(override.code, 'N');
      assert.equal(override.licenseOverride, true);
      assert.equal(override.overrideReason, 'CFG-05 Admin override');
      assert.equal(override.phaseCode, null);

      assert.equal(
        await prisma.shiftAssignment.count({ where: { employeeId: ids.employee, workDate: { gte: month, lt: nextMonth } } }),
        beforeCount
      );
      assert.equal(await prisma.scheduleApproval.count({ where: { month } }), beforeApprovalCount);

      const invalidPhase = await request(app)
        .post('/api/v1/schedule/employee-auto-preview')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ month: monthText, employeeId: ids.employee, startPhase: 'D1', patternType: customCode });
      assert.equal(invalidPhase.status, 400);
      assert.equal(invalidPhase.body.details.code, 'AUTO_SCHEDULE_PHASE_NOT_FOUND');

      const updated = await request(app)
        .put(`/api/v1/auto-schedule-patterns/${customId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'CFG-05 Custom Cycle Revised', isActive: false, sortOrder: 95 });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.name, 'CFG-05 Custom Cycle Revised');
      assert.equal(updated.body.data.isActive, false);

      const managerAfterDisable = await request(app)
        .get('/api/v1/auto-schedule-patterns')
        .set('Authorization', `Bearer ${managerToken}`);
      assert.equal(managerAfterDisable.status, 200);
      assert.equal(managerAfterDisable.body.data.some((row) => row.id === customId), false);

      const adminInactive = await request(app)
        .get('/api/v1/auto-schedule-patterns?includeInactive=true')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.equal(adminInactive.status, 200);
      assert.equal(adminInactive.body.data.find((row) => row.id === customId).isActive, false);

      const inactivePreview = await request(app)
        .post('/api/v1/schedule/employee-auto-preview')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ month: monthText, employeeId: ids.employee, startPhase: 'A1', patternType: customCode });
      assert.equal(inactivePreview.status, 404);
      assert.equal(inactivePreview.body.details.code, 'AUTO_SCHEDULE_PATTERN_NOT_FOUND');

      const core = await prisma.autoSchedulePattern.findUniqueOrThrow({ where: { code: 'ROTATE' } });
      const protectedMutations = [
        { input: { code: 'ROTATE_X' }, expectedCode: 'AUTO_SCHEDULE_PATTERN_CODE_IMMUTABLE' },
        { input: { mode: 'WEEKLY' }, expectedCode: 'CORE_AUTO_SCHEDULE_PATTERN_MODE_IMMUTABLE' },
        { input: { targetGroup: 'MANUAL' }, expectedCode: 'AUTO_SCHEDULE_PATTERN_TARGET_PROTECTED' },
        { input: { isActive: false }, expectedCode: 'CORE_AUTO_SCHEDULE_PATTERN_ACTIVE_REQUIRED' }
      ];
      for (const attempt of protectedMutations) {
        const response = await request(app)
          .put(`/api/v1/auto-schedule-patterns/${core.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(attempt.input);
        assert.equal(response.status, 409);
        assert.equal(response.body.details.code, attempt.expectedCode);
      }

      const audits = await prisma.auditLog.findMany({
        where: {
          actorUserId: ids.admin,
          entityType: 'AutoSchedulePattern',
          entityId: customId
        },
        orderBy: { createdAt: 'asc' }
      });
      assert.deepEqual(audits.map((event) => event.action), ['CREATE', 'UPDATE']);
      assert.equal(audits[0].metadata.after.code, customCode);
      assert.equal(audits[1].metadata.before.isActive, true);
      assert.equal(audits[1].metadata.after.isActive, false);
    } finally {
      await cleanup();
    }
  });

  test.after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
}
