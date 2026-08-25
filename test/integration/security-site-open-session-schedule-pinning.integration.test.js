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
  test('G06 open AttendanceSession schedule-pinning integration requires the isolated CI PostgreSQL target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const {
    SITE_AUTHORITY_SOURCES,
    createSecuritySiteAuthorityService
  } = require('../../src/services/security-site-authority.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    siteA: crypto.randomUUID(),
    siteB: crypto.randomUUID(),
    shiftType: crypto.randomUUID(),
    assignment: crypto.randomUUID(),
    session: crypto.randomUUID()
  };
  const workDate = new Date('2099-01-16T00:00:00.000Z');
  const department = `G06-PIN-${marker.toUpperCase()}`;
  const authority = createSecuritySiteAuthorityService({ prisma });

  async function cleanup() {
    await prisma.attendanceSession.deleteMany({ where: { id: ids.session } }).catch(() => {});
    await prisma.shiftAssignment.deleteMany({ where: { id: ids.assignment } }).catch(() => {});
    await prisma.shiftType.deleteMany({ where: { id: ids.shiftType } }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: { in: [ids.siteA, ids.siteB] } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  test.before(async () => {
    await cleanup();
    await prisma.employee.create({
      data: {
        id: ids.employee,
        employeeCode: `G06PIN-${marker.toUpperCase()}`,
        firstName: 'Pinned',
        lastName: 'Attendance',
        department
      }
    });
    await prisma.securitySite.createMany({
      data: [
        {
          id: ids.siteA,
          code: `G06PINA-${marker.toUpperCase()}`,
          name: 'G06 Pinned Site A',
          latitude: 13.7241000,
          longitude: 100.5701000,
          geofenceRadiusMeters: 120,
          isActive: true
        },
        {
          id: ids.siteB,
          code: `G06PINB-${marker.toUpperCase()}`,
          name: 'G06 Changed Schedule Site B',
          latitude: 13.7251000,
          longitude: 100.5711000,
          geofenceRadiusMeters: 100,
          isActive: true
        }
      ]
    });
    await prisma.shiftType.create({
      data: {
        id: ids.shiftType,
        code: `G06PIN-${marker.toUpperCase()}`,
        name: 'G06 Pinned Shift',
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
        securitySiteId: ids.siteA,
        workDate,
        employeeNameSnapshot: 'Pinned Attendance',
        departmentSnapshot: department,
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
        expectedSiteId: ids.siteA,
        workDate,
        expectationSnapshot: {
          site: {
            authoritySource: SITE_AUTHORITY_SOURCES.SCHEDULE,
            securitySiteId: ids.siteA
          }
        },
        expectationDigest: 'b'.repeat(64),
        state: 'OPEN',
        closedAt: null
      }
    });
  });

  test.after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  test('OPEN AttendanceSession stays pinned to Site A after Schedule Site changes to B', async () => {
    await prisma.shiftAssignment.update({
      where: { id: ids.assignment },
      data: { securitySiteId: ids.siteB }
    });

    const [assignment, existingSession] = await Promise.all([
      prisma.shiftAssignment.findUniqueOrThrow({
        where: { id: ids.assignment },
        include: { securitySite: true }
      }),
      prisma.attendanceSession.findUniqueOrThrow({ where: { id: ids.session } })
    ]);

    assert.equal(assignment.securitySiteId, ids.siteB);
    assert.equal(existingSession.state, 'OPEN');
    assert.equal(existingSession.closedAt, null);
    assert.equal(existingSession.expectedSiteId, ids.siteA);

    const resolved = await authority.resolve({ assignment, existingSession });
    assert.equal(resolved.siteId, ids.siteA);
    assert.equal(resolved.source, SITE_AUTHORITY_SOURCES.SCHEDULE);
    assert.equal(resolved.pinnedBySession, true);

    const persistedSession = await prisma.attendanceSession.findUniqueOrThrow({ where: { id: ids.session } });
    assert.equal(persistedSession.expectedSiteId, ids.siteA);
    assert.equal(persistedSession.state, 'OPEN');
    assert.equal(persistedSession.closedAt, null);
  });
}
