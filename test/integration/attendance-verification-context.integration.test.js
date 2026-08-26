'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'g06-attendance-context-disposable-local'
  && target.hostname === '127.0.0.1'
  && target.port === '55438'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('G06 Attendance Context integration requires the explicit disposable local target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createFaceVerificationSessionService } = require('../../src/services/face-verification-session.service');
  const { createAttendanceVerificationContextService } = require('../../src/services/attendance-verification-context.service');
  const { tokenHash } = require('../../src/services/attendance-site-evidence.service');
  const audit = require('../../src/services/audit.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    user: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    shiftType: crypto.randomUUID(),
    site: crypto.randomUUID(),
    qrCredential: crypto.randomUUID(),
    assignment: crypto.randomUUID(),
    approval: crypto.randomUUID(),
    device: crypto.randomUUID(),
    reference: crypto.randomUUID(),
    capture: crypto.randomUUID()
  };
  const actor = { sub: ids.user, role: 'VIEWER' };
  const now = new Date('2026-08-24T03:00:00.000Z'); // 10:00 Asia/Bangkok
  const qrToken = `attendance-context-qr-${marker}-trusted-site-proof`;
  const attendanceEvidence = {
    qrToken,
    location: {
      latitude: 13.7241200,
      longitude: 100.5701200,
      accuracyMeters: 8,
      capturedAt: now.toISOString()
    }
  };

  function keyMaterial() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return { ...pair, spki: pair.publicKey.export({ type: 'spki', format: 'der' }) };
  }

  async function cleanup() {
    const sessions = await prisma.faceVerificationSession.findMany({ where: { employeeId: ids.employee }, select: { id: true } }).catch(() => []);
    if (sessions.length) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'FaceVerificationSession', entityId: { in: sessions.map((row) => row.id) } } }).catch(() => {});
    }
    await prisma.faceVerificationReceipt.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.faceVerificationSession.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceChallenge.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.employeeReferencePhoto.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.attendanceDeviceEnrollment.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.shiftAssignment.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.securitySiteQrCredential.deleteMany({ where: { id: ids.qrCredential } }).catch(() => {});
    await prisma.securitySite.deleteMany({ where: { id: ids.site } }).catch(() => {});
    await prisma.scheduleApproval.deleteMany({ where: { id: ids.approval } }).catch(() => {});
    await prisma.shiftType.deleteMany({ where: { id: ids.shiftType } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ids.user, ids.admin] } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  async function seed(material) {
    await cleanup();
    await prisma.employee.create({ data: { id: ids.employee, employeeCode: 'ATCTX-' + marker, firstName: 'Attendance', lastName: 'Context', department: 'SECURITY' } });
    await prisma.user.createMany({ data: [
      { id: ids.user, email: `attendance-context-user-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Attendance Context User', role: 'VIEWER', employeeId: ids.employee },
      { id: ids.admin, email: `attendance-context-admin-${marker}@example.test`, passwordHash: 'test-only', displayName: 'Attendance Context Admin', role: 'ADMIN' }
    ] });
    await prisma.shiftType.create({ data: { id: ids.shiftType, code: 'CTX' + marker.slice(0, 3).toUpperCase(), name: 'Attendance Context Day', startTime: '07:00', endTime: '19:00', hours: 12, color: '#D9E1F2' } });
    await prisma.securitySite.create({ data: { id: ids.site, code: 'SITE-' + marker.toUpperCase(), name: 'Attendance Context Test Site', latitude: 13.7241000, longitude: 100.5701000, geofenceRadiusMeters: 120, isActive: true } });
    await prisma.securitySiteQrCredential.create({ data: { id: ids.qrCredential, securitySiteId: ids.site, tokenHash: tokenHash(qrToken), version: 1, validFrom: new Date('2026-08-24T00:00:00.000Z'), validUntil: new Date('2026-08-25T00:00:00.000Z') } });
    await prisma.shiftAssignment.create({ data: { id: ids.assignment, employeeId: ids.employee, shiftTypeId: ids.shiftType, securitySiteId: ids.site, workDate: new Date('2026-08-24T00:00:00.000Z'), employeeNameSnapshot: 'Attendance Context', departmentSnapshot: 'SECURITY', startTime: '07:00', endTime: '19:00', hours: 12, source: 'G06_ATTENDANCE_CONTEXT_TEST', locked: true, licenseStatus: 'VALID' } });
    await prisma.scheduleApproval.create({ data: { id: ids.approval, month: new Date('2026-08-01T00:00:00.000Z'), status: 'APPROVED', revision: 1, changedAt: now, approvedAt: now, changedByLegacyRef: ids.admin, approvedByLegacyRef: ids.admin, changeType: 'TEST', approvalNote: 'G06 Attendance Context disposable integration' } });
    await prisma.attendanceDeviceEnrollment.create({ data: { id: ids.device, employeeId: ids.employee, publicKey: material.spki, keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: crypto.createHash('sha256').update(material.spki).digest('hex'), displayName: 'Attendance Context Test Device', status: 'ACTIVE', proofVerifiedAt: now, activatedAt: now, createdByUserId: ids.user, approvedByUserId: ids.admin } });
    await prisma.employeeReferencePhoto.create({ data: { id: ids.reference, employeeId: ids.employee, status: 'ACTIVE', storageProvider: 'fake', storageBucket: 'attendance-context-test', storageObjectKey: `attendance-context/${marker}/reference.png`, originalFileName: 'reference.png', safeDisplayFileName: 'reference.png', mimeType: 'image/png', fileSize: 1024, checksum: 'a'.repeat(64), imageWidth: 512, imageHeight: 512, uploadedByUserId: ids.admin, uploadedByRoleSnapshot: 'ADMIN', reviewedByUserId: ids.admin, reviewedAt: now, activatedAt: now } });
  }

  test('real DB validates Site/QR/GPS server-side and rolls receipt consumption back with the caller transaction', async () => {
    const material = keyMaterial();
    await seed(material);
    const face = createFaceVerificationSessionService({ prisma, audit, clock: () => now });
    const attendance = createAttendanceVerificationContextService({ prisma, faceSessionService: face, clock: () => now });

    const prepared = await attendance.prepareVerification({ actor, captureId: ids.capture, eventIntent: 'CHECK_IN', attendanceEvidence, validatedEvidence: { siteBindingDigest: 'f'.repeat(64), qrBindingDigest: 'f'.repeat(64), locationBindingDigest: 'f'.repeat(64) } });
    assert.equal(prepared.session.employeeId, ids.employee);
    assert.equal(prepared.session.deviceEnrollmentId, ids.device);
    assert.equal(prepared.session.referencePhotoId, ids.reference);
    assert.equal(prepared.attendanceContext.shiftAssignmentId, ids.assignment);
    assert.equal(prepared.attendanceContext.evidence.siteId, ids.site);
    assert.equal(prepared.attendanceContext.evidence.qrCredentialId, ids.qrCredential);
    assert.equal(JSON.stringify(prepared.attendanceContext).includes(qrToken), false);
    assert.equal(JSON.stringify(prepared.attendanceContext).includes(tokenHash(qrToken)), false);

    const signature = crypto.sign('sha256', Buffer.from(prepared.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });
    await face.verifyDeviceProof({ actor, sessionId: prepared.session.id, challengeId: prepared.challengeId, challenge: prepared.challenge, signatureBase64: signature.toString('base64') });
    const providerRef = 'trusted-test-provider-' + crypto.randomUUID();
    await face.bindProviderSession({ sessionId: prepared.session.id, provider: 'TEST_TRUSTED_PROVIDER', providerSessionRef: providerRef, policyProfileId: 'test-only', engineVersion: 'test-only' });
    const verified = await face.recordTrustedProviderResult({ sessionId: prepared.session.id, providerSessionRef: providerRef, padPassed: true, faceMatchPassed: true, injectionRiskDetected: false, resultCode: 'TEST_PASS' });
    assert.ok(verified.receipt.length >= 32);

    await assert.rejects(
      () => prisma.$transaction(async (tx) => {
        const consumed = await attendance.consumeVerificationInTransaction({ tx, actor, receipt: verified.receipt, attendanceContext: prepared.attendanceContext });
        assert.equal(consumed.sessionId, prepared.session.id);
        throw new Error('SIMULATED_ATTENDANCE_EVENT_WRITE_FAILURE');
      }),
      /SIMULATED_ATTENDANCE_EVENT_WRITE_FAILURE/
    );

    const afterRollbackReceipt = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: prepared.session.id } });
    const afterRollbackSession = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: prepared.session.id } });
    assert.equal(afterRollbackReceipt.consumedAt, null);
    assert.equal(afterRollbackSession.status, 'VERIFIED');

    const tamperedContext = structuredClone(prepared.attendanceContext);
    tamperedContext.evidence.location.latitude = '13.7242000';
    await assert.rejects(
      () => attendance.consumeVerification({ actor, receipt: verified.receipt, attendanceContext: tamperedContext }),
      (error) => error.details?.code === 'VERIFICATION_CONTEXT_MISMATCH'
    );
    const stillUnconsumed = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: prepared.session.id } });
    assert.equal(stillUnconsumed.consumedAt, null);

    const consumed = await attendance.consumeVerification({ actor, receipt: verified.receipt, attendanceContext: prepared.attendanceContext });
    assert.equal(consumed.contextDigest, prepared.session.contextDigest);
    const finalReceipt = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: prepared.session.id } });
    const finalSession = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: prepared.session.id } });
    assert.ok(finalReceipt.consumedAt);
    assert.equal(finalSession.status, 'CONSUMED');
    await assert.rejects(
      () => attendance.consumeVerification({ actor, receipt: verified.receipt, attendanceContext: prepared.attendanceContext }),
      (error) => error.details?.code === 'VERIFICATION_REPLAYED'
    );

    await cleanup();
  });

  test('real DB QR revocation after verification blocks receipt consumption without burning receipt', async () => {
    const material = keyMaterial();
    await seed(material);
    const face = createFaceVerificationSessionService({ prisma, audit, clock: () => now });
    const attendance = createAttendanceVerificationContextService({ prisma, faceSessionService: face, clock: () => now });
    const prepared = await attendance.prepareVerification({ actor, captureId: crypto.randomUUID(), eventIntent: 'CHECK_IN', attendanceEvidence });
    const signature = crypto.sign('sha256', Buffer.from(prepared.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });
    await face.verifyDeviceProof({ actor, sessionId: prepared.session.id, challengeId: prepared.challengeId, challenge: prepared.challenge, signatureBase64: signature.toString('base64') });
    const providerRef = 'trusted-revocation-provider-' + crypto.randomUUID();
    await face.bindProviderSession({ sessionId: prepared.session.id, provider: 'TEST_TRUSTED_PROVIDER', providerSessionRef: providerRef });
    const verified = await face.recordTrustedProviderResult({ sessionId: prepared.session.id, providerSessionRef: providerRef, padPassed: true, faceMatchPassed: true, injectionRiskDetected: false, resultCode: 'TEST_PASS' });
    await prisma.securitySiteQrCredential.update({ where: { id: ids.qrCredential }, data: { revokedAt: new Date('2026-08-24T03:00:30.000Z') } });
    await assert.rejects(
      () => attendance.consumeVerification({ actor, receipt: verified.receipt, attendanceContext: prepared.attendanceContext }),
      (error) => error.details?.code === 'ATTENDANCE_QR_REVOKED'
    );
    const receipt = await prisma.faceVerificationReceipt.findUniqueOrThrow({ where: { sessionId: prepared.session.id } });
    const session = await prisma.faceVerificationSession.findUniqueOrThrow({ where: { id: prepared.session.id } });
    assert.equal(receipt.consumedAt, null);
    assert.equal(session.status, 'VERIFIED');
    await cleanup();
  });

  test('real DB constraints reject invalid Site coordinates/radius and malformed QR token hashes', async () => {
    const invalidSiteId = crypto.randomUUID();
    await assert.rejects(
      () => prisma.securitySite.create({ data: { id: invalidSiteId, code: 'BAD-LAT-' + marker, name: 'Bad Latitude', latitude: 91, longitude: 100.57, geofenceRadiusMeters: 100 } }),
      (error) => ['P2004', 'P2010'].includes(error.code) || /security_sites_latitude_range/.test(String(error.message))
    );
    await assert.rejects(
      () => prisma.securitySite.create({ data: { id: invalidSiteId, code: 'BAD-RAD-' + marker, name: 'Bad Radius', latitude: 13.72, longitude: 100.57, geofenceRadiusMeters: 0 } }),
      (error) => ['P2004', 'P2010'].includes(error.code) || /security_sites_geofence_radius_positive/.test(String(error.message))
    );
    const validSiteId = crypto.randomUUID();
    await prisma.securitySite.create({ data: { id: validSiteId, code: 'VALID-' + marker, name: 'Valid Constraint Site', latitude: 13.72, longitude: 100.57, geofenceRadiusMeters: 100 } });
    await assert.rejects(
      () => prisma.securitySiteQrCredential.create({ data: { securitySiteId: validSiteId, tokenHash: 'x'.repeat(64), version: 1 } }),
      (error) => ['P2004', 'P2010'].includes(error.code) || /security_site_qr_credentials_token_hash_format/.test(String(error.message))
    );
    await prisma.securitySite.delete({ where: { id: validSiteId } });
  });

  test.after(async () => { await cleanup().catch(() => {}); await prisma.$disconnect(); });
}
