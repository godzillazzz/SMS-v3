'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'g06-attendance-event-disposable-local'
  && target.hostname === '127.0.0.1'
  && target.port === '55438'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('support-Site Attendance integration requires the explicit disposable local target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createAttendanceSimpleService } = require('../../src/services/attendance-simple.service');
  const { createAttendanceSiteEvidenceService } = require('../../src/services/attendance-site-evidence.service');
  const audit = require('../../src/services/audit.service');
  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const ids = {
    employee: crypto.randomUUID(), user: crypto.randomUUID(), admin: crypto.randomUUID(),
    shiftType: crypto.randomUUID(), assignedSite: crypto.randomUUID(), supportSite: crypto.randomUUID(),
    assignment: crypto.randomUUID(), approval: crypto.randomUUID()
  };
  const actor = { sub: ids.user, role: 'VIEWER' };
  const adminActor = { sub: ids.admin, role: 'ADMIN' };
  let now = new Date('2026-10-02T03:00:00.000Z'); // 10:00 Asia/Bangkok
  let signingMaterial;
  const policy = { maxAccuracyMeters: 50, maxAgeMs: 180000, futureSkewMs: 30000, offlineConfirmAfterMs: 5 * 60 * 1000, offlineBundleTtlMs: 24 * 60 * 60 * 1000 };

  function keyMaterial() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return { pair, publicKeySpkiBase64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  }

  function gps(site, capturedAt = now) {
    return { latitude: site.latitude, longitude: site.longitude, accuracyMeters: 8, capturedAt: capturedAt.toISOString() };
  }

  function eventInput({ captureId, intent, location, capturedAt, offlineBundle = null, material = signingMaterial }) {
    const input = {
      captureId, eventIntent: intent, shiftAssignmentId: ids.assignment, capturedAt: capturedAt.toISOString(), location,
      device: { publicKeySpkiBase64: material.publicKeySpkiBase64, keyAlgorithm: 'ECDSA_P256_SHA256', displayName: 'Disposable integration device',
        signals: { secureContext: true, webCrypto: true, indexedDb: true, privateKeyNonExportable: true }, signatureBase64: '' },
      offlineBundle
    };
    const { canonicalJson, signedEventPayload } = require('../../src/services/attendance-simple.service');
    input.device.signatureBase64 = crypto.sign('sha256', Buffer.from(canonicalJson(signedEventPayload(input)), 'utf8'), {
      key: material.pair.privateKey, dsaEncoding: 'ieee-p1363'
    }).toString('base64');
    return input;
  }

  async function cleanup() {
    const [events, pending, sessions, enrollments] = await Promise.all([
      prisma.attendanceEvent.findMany({ where: { session: { employeeId: ids.employee } }, select: { id: true } }).catch(() => []),
      prisma.attendancePendingEvent.findMany({ where: { employeeId: ids.employee }, select: { id: true } }).catch(() => []),
      prisma.attendanceSession.findMany({ where: { employeeId: ids.employee }, select: { id: true } }).catch(() => []),
      prisma.attendanceDeviceEnrollment.findMany({ where: { employeeId: ids.employee }, select: { id: true } }).catch(() => [])
    ]);
    await prisma.auditLog.deleteMany({ where: { OR: [
      { actorUserId: { in: [ids.user, ids.admin] } },
      { entityId: { in: [...events, ...pending, ...sessions, ...enrollments].map((row) => row.id) } }
    ] } }).catch(() => {});
    await prisma.attendancePendingEvent.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceEvent.deleteMany({ where: { session: { employeeId: ids.employee } } }).catch(() => {});
    await prisma.attendanceSession.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceChangeRequest.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceEnrollment.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.scheduleApproval.deleteMany({ where: { id: ids.approval } }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: { in: [ids.assignedSite, ids.supportSite] } } }).catch(() => {});
    await prisma.shiftType.deleteMany({ where: { id: ids.shiftType } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.admin] } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  async function seed() {
    await cleanup();
    now = new Date('2026-10-02T03:00:00.000Z');
    signingMaterial = keyMaterial();
    await prisma.employee.create({ data: { id: ids.employee, employeeCode: `SUPPORT-${marker}`, firstName: 'Support', lastName: 'Site Test', department: 'SECURITY' } });
    await prisma.user.createMany({ data: [
      { id: ids.user, email: `support-site-user-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Support Site User', role: 'VIEWER', employeeId: ids.employee },
      { id: ids.admin, email: `support-site-admin-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Support Site Admin', role: 'ADMIN' }
    ] });
    await prisma.shiftType.create({ data: { id: ids.shiftType, code: `SS${marker.slice(0, 4)}`, name: 'Support Site Day', startTime: '07:00', endTime: '19:00', hours: 12, color: '#D9E1F2' } });
    await prisma.securitySite.createMany({ data: [
      { id: ids.assignedSite, code: `AS-${marker}`, name: 'Assigned Integration Site', latitude: 13.7241000, longitude: 100.5701000, geofenceRadiusMeters: 100, isActive: true },
      { id: ids.supportSite, code: `SS-${marker}`, name: 'Support Integration Site', latitude: 13.7251000, longitude: 100.5701000, geofenceRadiusMeters: 120, isActive: true }
    ] });
    await prisma.shiftAssignment.create({ data: {
      id: ids.assignment, employeeId: ids.employee, shiftTypeId: ids.shiftType, securitySiteId: ids.assignedSite,
      workDate: new Date('2026-10-02T00:00:00.000Z'), employeeNameSnapshot: 'Support Site Test', departmentSnapshot: 'SECURITY',
      startTime: '07:00', endTime: '19:00', hours: 12, source: 'G06_SUPPORT_SITE_TEST', locked: true, licenseStatus: 'VALID'
    } });
    await prisma.scheduleApproval.create({ data: {
      id: ids.approval, month: new Date('2026-10-01T00:00:00.000Z'), status: 'APPROVED', revision: 1,
      changedAt: now, approvedAt: now, changedByLegacyRef: ids.admin, approvedByLegacyRef: ids.admin,
      changeType: 'TEST', approvalNote: 'G06 support-Site disposable integration'
    } });
  }

  test('real PostgreSQL preserves assigned Site and accepts active support Site through signed offline flow', async () => {
    await seed();
    const siteEvidence = createAttendanceSiteEvidenceService({ prisma, clock: () => now, policyOverride: policy });
    const service = createAttendanceSimpleService({ prisma, audit, clock: () => now, siteEvidenceService: siteEvidence,
      policyService: { getPolicy: async () => policy }, bundleSecret: () => 'disposable-integration-only-signing-secret-32-bytes' });
    const assigned = { latitude: 13.7241, longitude: 100.5701, accuracyMeters: 8, capturedAt: now.toISOString() };
    const first = eventInput({ captureId: crypto.randomUUID(), intent: 'CHECK_IN', location: assigned, capturedAt: now });
    const acceptedAssigned = await service.submit({ actor, input: first });
    assert.equal(acceptedAssigned.counted, true);
    assert.equal(acceptedAssigned.event.locationEvidence.workSiteContext, 'ASSIGNED_SITE');
    assert.equal(acceptedAssigned.event.locationEvidence.expectedSiteId, ids.assignedSite);
    assert.equal(acceptedAssigned.event.locationEvidence.actualSiteId, ids.assignedSite);
    assert.equal((await service.submit({ actor, input: first })).idempotent, true);

    now = new Date(now.getTime() + 60 * 1000);
    const bootstrap = await service.bootstrap({ actor });
    assert.equal(bootstrap.assignment.site.id, ids.assignedSite);
    assert.ok(bootstrap.eligibleSites.some((row) => row.id === ids.supportSite));
    const capturedAt = new Date(now.getTime() + 60 * 1000);
    now = new Date(now.getTime() + 30 * 60 * 1000);
    const supportLocation = { latitude: 13.7251, longitude: 100.5701, accuracyMeters: 8, capturedAt: capturedAt.toISOString() };
    const supportMaterial = keyMaterial();
    const delayedOffline = eventInput({ captureId: crypto.randomUUID(), intent: 'CHECK_OUT', location: supportLocation,
      capturedAt, offlineBundle: bootstrap.offline.bundle, material: supportMaterial });
    const pending = await service.submit({ actor, input: delayedOffline });
    assert.equal(pending.status, 'PENDING_CONFIRMATION');
    assert.equal(pending.counted, false);
    assert.equal(pending.pendingEvent.locationEvidence.workSiteContext, 'SUPPORT_SITE');
    assert.equal(pending.pendingEvent.locationEvidence.expectedSiteId, ids.assignedSite);
    assert.equal(pending.pendingEvent.locationEvidence.actualSiteId, ids.supportSite);
    assert.equal(await prisma.attendanceEvent.count({ where: { sessionId: acceptedAssigned.session.id } }), 1);

    const confirmed = await service.reviewPending({ actor: adminActor, pendingId: pending.pendingEvent.id, action: 'CONFIRM', comment: 'Verified support-Site test entry' });
    assert.equal(confirmed.counted, true);
    assert.equal(confirmed.event.locationEvidence.workSiteContext, 'SUPPORT_SITE');
    assert.equal(confirmed.event.reviewRequired, true);
    assert.ok(confirmed.event.reviewReasons.includes('DEVICE_MISMATCH'));
    assert.equal(await prisma.attendanceEvent.count({ where: { sessionId: acceptedAssigned.session.id } }), 2);
    const session = await prisma.attendanceSession.findUniqueOrThrow({ where: { shiftAssignmentId: ids.assignment } });
    assert.equal(session.expectedSiteId, ids.assignedSite);
    const auditRows = await prisma.auditLog.findMany({ where: { actorUserId: { in: [ids.user, ids.admin] } } });
    assert.ok(auditRows.some((row) => row.metadata?.workSiteContext === 'SUPPORT_SITE' && row.metadata?.actualSiteId === ids.supportSite));
  });

  test.after(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
}
