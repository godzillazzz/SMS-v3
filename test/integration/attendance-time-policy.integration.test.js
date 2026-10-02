'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const databaseUrl = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const isCiDisposable = process.env.TEST_DATABASE_RUNNER === 'docker-container-network'
  && databaseUrl.hostname === '127.0.0.1' && databaseUrl.port === '5432';
const isLocalDisposable = databaseUrl.hostname === '127.0.0.1'
  && ((process.env.TEST_DATABASE_RUNNER === 'attendance-time-policy-disposable-local' && databaseUrl.port === '55439')
    || (process.env.TEST_DATABASE_RUNNER === 'g06-disposable-local' && databaseUrl.port === '55435'));
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && databaseUrl.pathname.replace(/^\//, '') === 'sms_v3_test'
  && (isCiDisposable || isLocalDisposable);

if (!configured) {
  test('Attendance time policy integration requires the explicit disposable sms_v3_test target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { DEFAULT_ATTENDANCE_TIME_POLICY } = require('../../src/services/attendance-time-policy.contract');
  const { createAttendanceTimePolicyService } = require('../../src/services/attendance-time-policy.service');
  const prisma = new PrismaClient();
  const ids = { admin: crypto.randomUUID(), manager: crypto.randomUUID(), site: crypto.randomUUID(), shift: crypto.randomUUID() };
  const marker = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  const admin = { sub: ids.admin, role: 'ADMIN' };
  const manager = { sub: ids.manager, role: 'MANAGER' };
  const clock = () => new Date('2026-10-01T00:00:00.000Z');

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { actorUserId: ids.admin } });
    await prisma.attendanceTimePolicy.deleteMany({ where: { createdByUserId: ids.admin } });
    await prisma.shiftType.deleteMany({ where: { id: ids.shift } });
    await prisma.securitySite.deleteMany({ where: { id: ids.site } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.manager] } } });
  }

  async function seed() {
    await cleanup();
    await prisma.user.createMany({ data: [
      { id: ids.admin, email: `attendance-time-admin-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Attendance Time Admin', role: 'ADMIN' },
      { id: ids.manager, email: `attendance-time-manager-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Attendance Time Manager', role: 'MANAGER' }
    ] });
    await prisma.securitySite.create({ data: {
      id: ids.site, code: `TP-${marker}`, name: 'Time Policy Integration Site', latitude: 13.7241, longitude: 100.5701, geofenceRadiusMeters: 100, isActive: true
    } });
    await prisma.shiftType.create({ data: {
      id: ids.shift, code: `TP${marker}`, name: 'Time Policy Integration Shift', startTime: '07:00', endTime: '19:00', hours: 12, color: '#D9E1F2', isActive: true
    } });
  }

  test('effective policy versions resolve by scope, persist safely, and audit Admin changes', async () => {
    await seed();
    const service = createAttendanceTimePolicyService({ prisma, clock });
    const company = { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 0 };
    const site = { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 5 };
    const shift = { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 10 };
    const siteUpdate = { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: 7 };
    const companyAt = new Date('2026-10-01T00:00:00.000Z');
    const siteAt = new Date('2026-10-02T00:00:00.000Z');
    const shiftAt = new Date('2026-10-03T00:00:00.000Z');
    const siteUpdateAt = new Date('2026-10-04T00:00:00.000Z');

    await service.save({ actor: admin, input: { scopeType: 'COMPANY', effectiveFrom: companyAt.toISOString(), policy: company } });
    await service.save({ actor: admin, input: { scopeType: 'SITE', siteId: ids.site, effectiveFrom: siteAt.toISOString(), policy: site } });
    await service.save({ actor: admin, input: { scopeType: 'SHIFT_TYPE', shiftTypeId: ids.shift, effectiveFrom: shiftAt.toISOString(), policy: shift } });
    const assignment = { securitySiteId: ids.site, shiftTypeId: ids.shift };

    assert.equal((await service.resolveForAssignment({ assignment, at: new Date('2026-10-01T12:00:00.000Z') })).values.lateGraceMinutes, 0);
    const siteResolved = await service.resolveForAssignment({ assignment, at: new Date('2026-10-02T12:00:00.000Z') });
    assert.equal(siteResolved.values.lateGraceMinutes, 5);
    assert.equal(siteResolved.source.scopeType, 'SITE');
    const shiftResolved = await service.resolveForAssignment({ assignment, at: new Date('2026-10-03T12:00:00.000Z') });
    assert.equal(shiftResolved.values.lateGraceMinutes, 10);
    assert.equal(shiftResolved.source.scopeType, 'SHIFT_TYPE');

    await assert.rejects(
      service.save({ actor: manager, input: { scopeType: 'SITE', siteId: ids.site, policy: siteUpdate } }),
      (error) => error.statusCode === 403 && error.details?.code === 'FORBIDDEN'
    );
    await service.save({ actor: admin, input: { scopeType: 'SITE', siteId: ids.site, effectiveFrom: siteUpdateAt.toISOString(), policy: siteUpdate } });
    assert.equal((await service.resolveForAssignment({ assignment, at: siteUpdateAt })).values.lateGraceMinutes, 10);
    const siteHistory = await prisma.attendanceTimePolicy.findMany({ where: { siteId: ids.site }, orderBy: { effectiveFrom: 'asc' } });
    assert.deepEqual(siteHistory.map((row) => Number(row.policy.lateGraceMinutes)), [5, 7]);
    const siteAudit = await prisma.auditLog.findFirst({
      where: { actorUserId: ids.admin, entityType: 'AttendanceTimePolicy', entityId: `SITE:${ids.site}` },
      orderBy: { createdAt: 'desc' }
    });
    assert.equal(siteAudit.metadata.scopeType, 'SITE');
    assert.equal(siteAudit.metadata.scopeId, ids.site);
    assert.equal(siteAudit.metadata.oldValues.lateGraceMinutes, 5);
    assert.equal(siteAudit.metadata.newValues.lateGraceMinutes, 7);
    assert.equal(siteAudit.metadata.effectiveAt, siteUpdateAt.toISOString());

    const policyTable = await prisma.$queryRaw`SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'public.attendance_time_policies'::regclass`;
    assert.equal(policyTable[0]?.enabled, true);
    assert.equal(policyTable[0]?.forced, false);
    await assert.rejects(prisma.attendanceTimePolicy.create({ data: {
      scopeType: 'COMPANY', policy: { ...DEFAULT_ATTENDANCE_TIME_POLICY, lateGraceMinutes: -1 },
      effectiveFrom: new Date('2026-10-05T00:00:00.000Z'), createdByUserId: ids.admin
    } }));
  });

  test.after(async () => { await cleanup(); await prisma.$disconnect(); });
}
