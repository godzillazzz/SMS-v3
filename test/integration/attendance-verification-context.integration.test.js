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
  const audit = require('../../src/services/audit.service');

  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = {
    employee: crypto.randomUUID(),
    user: crypto.randomUUID(),
    admin: crypto.randomUUID(),
    shiftType: crypto.randomUUID(),
    assignment: crypto.randomUUID(),
    approval: crypto.randomUUID(),
    device: crypto.randomUUID(),
    reference: crypto.randomUUID(),
    capture: crypto.randomUUID()
  };
  const actor = { sub: ids.user, role: 'VIEWER' };
  const now = new Date('2026-08-24T03:00:00.000Z'); // 10:00 Asia/Bangkok
  const evidence = {
    siteBindingDigest: crypto.createHash('sha256').update('site|' + marker).digest('hex'),
    qrBindingDigest: crypto.createHash('sha256').update('qr|' + marker).digest('hex'),
    locationBindingDigest: crypto.createHash('sha256').update('location|' + marker).digest('hex')
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
    await prisma.shiftAssignment.create({ data: { id: ids.assignment, employeeId: ids.employee, shiftTypeId: ids.shiftType, workDate: new Date('2026-08-24T00:00:00.000Z'), employeeNameSnapshot: 'Attendance Context', departmentSnapshot: 'SECURITY', startTime: '07:00', endTime: '19:00', hours: 12, source: 'G06_ATTENDANCE_CONTEXT_TEST', locked: true, licenseStatus: 'VALID' } });
    await prisma.scheduleApproval.create({ data: { id: ids.approval, month: new Date('2026-08-01T00:00:00.000Z'), status: 'APPROVED', revision: 1, changedAt: now, approvedAt: now, changedByLegacyRef: ids.admin, approvedByLegacyRef: ids.admin, changeType: 'TEST', approvalNote: 'G06 Attendance Context disposable integration' } });
    await prisma.attendanceDeviceEnrollment.create({ data: { id: ids.device, employeeId: ids.employee, publicKey: material.spki, keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: crypto.createHash('sha256').update(material.spki).digest('hex'), displayName: 'Attendance Context Test Device', status: 'ACTIVE', proofVerifiedAt: now, activatedAt: now, createdByUserId: ids.user, approvedByUserId: ids.admin } });
    await prisma.employeeReferencePhoto.create({ data: { id: ids.reference, employeeId: ids.employee, status: 'ACTIVE', storageProvider: 'fake', storageBucket: 'attendance-context-test', storageObjectKey: `attendance-context/${marker}/reference.png`, originalFileName: 'reference.png', safeDisplayFileName: 'reference.png', mimeType: 'image/png', fileSize: 1024, checksum: 'a'.repeat(64), imageWidth: 512, imageHeight: 512, uploadedByUserId: ids.admin, uploadedByRoleSnapshot: 'ADMIN', reviewedByUserId: ids.admin, reviewedAt: now, activatedAt: now } });
  }

  test('real DB binds server Attendance context and rolls receipt consumption back with the caller transaction', async () => {
    const material = keyMaterial();
    await seed(material);
    const face = createFaceVerificationSessionService({ prisma, audit, clock: () => now });
    const attendance = createAttendanceVerificationContextService({ prisma, faceSessionService: face, clock: () => now });

    const prepared = await attendance.prepareVerification({ actor, captureId: ids.capture, eventIntent: 'CHECK_IN', validatedEvidence: evidence });
    assert.equal(prepared.session.employeeId, ids.employee);
    assert.equal(prepared.session.deviceEnrollmentId, ids.device);
    assert.equal(prepared.session.referencePhotoId, ids.reference);
    assert.equal(prepared.attendanceContext.shiftAssignmentId, ids.assignment);

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

    await assert.rejects(
      () => attendance.consumeVerification({ actor, receipt: verified.receipt, attendanceContext: { ...prepared.attendanceContext, locationBindingDigest: 'f'.repeat(64) } }),
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

  test.after(async () => { await cleanup().catch(() => {}); await prisma.$disconnect(); });
}
