'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'docker-container-network'
  && target.hostname === '127.0.0.1'
  && target.port === '5432'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('G06 open AttendanceSession site-deactivation integration requires the isolated CI PostgreSQL target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createSecuritySiteService } = require('../../src/services/security-site.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    site: crypto.randomUUID(),
    shiftType: crypto.randomUUID(),
    assignment: crypto.randomUUID(),
    session: crypto.randomUUID()
  };
  const workDate = new Date('2099-01-15T00:00:00.000Z');
  const service = createSecuritySiteService({ prisma });

  async function cleanup() {
    await prisma.attendanceSession.deleteMany({ where: { id: ids.session } }).catch(() => {});
    await prisma.shiftAssignment.deleteMany({ where: { id: ids.assignment } }).catch(() => {});
    await prisma.shiftType.deleteMany({ where: { id: ids.shiftType } }).catch(() => {});
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: ids.admin },
          { entityId: ids.site }
        ]
      }
    }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: ids.site } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  test.before(async () => {
    await cleanup();
    await prisma.employee.create({
      data: {
        id: ids.employee,
        employeeCode: `G06OPEN-${marker.toUpperCase()}`,
        firstName: 'Open',
        lastName: 'Attendance',
        department: `G06-OPEN-${marker.toUpperCase()}`
      }
    });
    await prisma.user.create({
      data: {
        id: ids.admin,
        email: `g06-open-admin-${marker}@example.test`,
        passwordHash: 'test-only',
        displayName: 'G06 Open Session Admin',
        role: 'ADMIN'
      }
    });
    await prisma.securitySite.create({
      data: {
        id: ids.site,
        code: `G06OPEN-${marker.toUpperCase()}`,
        name: 'G06 Open Session Site',
        latitude: 13.7241000,
        longitude: 100.5701000,
        geofenceRadiusMeters: 120,
        isActive: true
      }
    });
    await prisma.shiftType.create({
      data: {
        id: ids.shiftType,
        code: `G06OPEN-${marker.toUpperCase()}`,
        name: 'G06 Open Session Shift',
        startTime: '07:00',
        endTime: '19:00',
        hours: 12
      }
    });
    await prisma.shiftAssignment.create({
      data: {
        id: ids.assignment,
        employeeId: ids.employee,
        shiftTypeId: ids.shiftType,
        securitySiteId: ids.site,
        workDate,
        employeeNameSnapshot: 'Open Attendance',
        departmentSnapshot: `G06-OPEN-${marker.toUpperCase()}`,
        startTime: '07:00',
        endTime: '19:00',
        hours: 12
      }
    });
    await prisma.attendanceSession.create({
      data: {
        id: ids.session,
        employeeId: ids.employee,
        shiftAssignmentId: ids.assignment,
        expectedShiftTypeId: ids.shiftType,
        expectedSiteId: ids.site,
        workDate,
        expectationSnapshot: {
          site: {
            authoritySource: 'SCHEDULE',
            securitySiteId: ids.site
          }
        },
        expectationDigest: 'a'.repeat(64),
        state: 'OPEN',
        closedAt: null
      }
    });
  });

  test.after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test('Security Site referenced by an OPEN AttendanceSession cannot be deactivated', async () => {
    await assert.rejects(
      () => service.update(ids.site, { isActive: false, reason: 'Governed deactivation test' }, ids.admin),
      (error) => error.details?.code === 'SECURITY_SITE_OPEN_ATTENDANCE_IN_USE'
    );

    const site = await prisma.securitySite.findUnique({ where: { id: ids.site } });
    assert.equal(site.isActive, true);

    const session = await prisma.attendanceSession.findUnique({ where: { id: ids.session } });
    assert.equal(session.state, 'OPEN');
    assert.equal(session.closedAt, null);
    assert.equal(session.expectedSiteId, ids.site);
  });
}
