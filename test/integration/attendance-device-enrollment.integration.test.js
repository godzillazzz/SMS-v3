process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const isConfiguredG06Target = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'g06-disposable-local'
  && target.hostname === '127.0.0.1'
  && target.port === '55435'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!isConfiguredG06Target) {
  test('G06 attendance-device integration requires the explicit disposable local target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createAttendanceDeviceService } = require('../../src/services/attendance-device.service');
  const audit = require('../../src/services/audit.service');
  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = { employeeUser: crypto.randomUUID(), admin: crypto.randomUUID(), employee: crypto.randomUUID() };
  const employeeActor = { sub: ids.employeeUser, role: 'VIEWER' };
  const adminActor = { sub: ids.admin, role: 'ADMIN' };

  function keys() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    return { ...pair, spki: pair.publicKey.export({ type: 'spki', format: 'der' }) };
  }

  async function prove(service, requestId, material) {
    const options = await service.createProofChallenge({ actor: employeeActor, requestId });
    const signature = crypto.sign('sha256', Buffer.from(options.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });
    return service.verifyProof({ actor: employeeActor, requestId, challengeId: options.challengeId, challenge: options.challenge, signatureBase64: signature.toString('base64') });
  }

  async function cleanup() {
    const [requests, enrollments] = await Promise.all([
      prisma.attendanceDeviceChangeRequest.findMany({ where: { employeeId: ids.employee }, select: { id: true } }),
      prisma.attendanceDeviceEnrollment.findMany({ where: { employeeId: ids.employee }, select: { id: true } })
    ]);
    const requestIds = requests.map((row) => row.id);
    const enrollmentIds = enrollments.map((row) => row.id);
    const auditScope = [];
    if (requestIds.length) auditScope.push({ entityType: 'AttendanceDeviceChangeRequest', entityId: { in: requestIds } });
    if (enrollmentIds.length) auditScope.push({ entityType: 'AttendanceDeviceEnrollment', entityId: { in: enrollmentIds } });
    if (auditScope.length) await prisma.auditLog.deleteMany({ where: { OR: auditScope } });
    await prisma.attendanceDeviceChallenge.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.attendanceDeviceChangeRequest.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.attendanceDeviceEnrollment.deleteMany({ where: { employeeId: ids.employee } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.employeeUser, ids.admin] } } });
    await prisma.employee.deleteMany({ where: { id: ids.employee } });
  }

  test('real DB enforces Admin-only initial activation, one-winner approval, replacement, and one ACTIVE device', async () => {
    await cleanup();
    await prisma.employee.create({ data: { id: ids.employee, employeeCode: 'G06-' + marker, firstName: 'G06', lastName: 'Device', isActive: true } });
    await prisma.user.createMany({ data: [
      { id: ids.employeeUser, email: 'g06-' + marker + '@example.test', passwordHash: 'test-only', displayName: 'G06 Employee', role: 'VIEWER', employeeId: ids.employee },
      { id: ids.admin, email: 'g06-admin-' + marker + '@example.test', passwordHash: 'test-only', displayName: 'G06 Admin', role: 'ADMIN' }
    ] });
    const service = createAttendanceDeviceService({ prisma, audit });
    const firstKeys = keys();
    const first = await service.createRequest({ actor: employeeActor, displayName: 'Phone A', publicKeySpkiBase64: firstKeys.spki.toString('base64') });
    assert.equal(first.requestType, 'INITIAL');
    await assert.rejects(() => service.approve({ actor: adminActor, requestId: first.id }), (error) => error.details?.code === 'ATTENDANCE_DEVICE_PROOF_REQUIRED');
    await prove(service, first.id, firstKeys);

    const concurrentApproval = await Promise.allSettled([
      service.approve({ actor: adminActor, requestId: first.id }),
      service.approve({ actor: adminActor, requestId: first.id })
    ]);
    assert.equal(concurrentApproval.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrentApproval.filter((result) => result.status === 'rejected' && result.reason?.statusCode === 409).length, 1);
    let active = await prisma.attendanceDeviceEnrollment.findMany({ where: { employeeId: ids.employee, status: 'ACTIVE' } });
    assert.equal(active.length, 1);
    const firstDeviceId = active[0].id;
    const finalApproveAudits = await prisma.auditLog.count({ where: { entityType: 'AttendanceDeviceChangeRequest', entityId: first.id, metadata: { path: ['event'], equals: 'FINAL_APPROVE' } } });
    assert.equal(finalApproveAudits, 1);

    const secondKeys = keys();
    const replacement = await service.createRequest({ actor: employeeActor, displayName: 'Phone B', publicKeySpkiBase64: secondKeys.spki.toString('base64'), reason: 'new phone' });
    assert.equal(replacement.requestType, 'REPLACEMENT');
    assert.equal(replacement.currentDeviceEnrollmentId, firstDeviceId);
    await prove(service, replacement.id, secondKeys);
    await service.approve({ actor: adminActor, requestId: replacement.id });
    active = await prisma.attendanceDeviceEnrollment.findMany({ where: { employeeId: ids.employee, status: 'ACTIVE' } });
    assert.equal(active.length, 1);
    assert.notEqual(active[0].id, firstDeviceId);
    const old = await prisma.attendanceDeviceEnrollment.findUnique({ where: { id: firstDeviceId } });
    assert.equal(old.status, 'REVOKED');
    assert.equal(old.revokedReason, 'ADMIN_APPROVED_REPLACEMENT');

    const third = keys();
    await assert.rejects(() => prisma.attendanceDeviceEnrollment.create({ data: {
      employeeId: ids.employee,
      publicKey: third.spki,
      keyAlgorithm: 'ECDSA_P256_SHA256',
      credentialFingerprint: crypto.createHash('sha256').update(third.spki).digest('hex'),
      displayName: 'Illegal second active',
      status: 'ACTIVE',
      proofVerifiedAt: new Date(),
      activatedAt: new Date(),
      createdByUserId: ids.employeeUser,
      approvedByUserId: ids.admin
    } }), (error) => error.code === 'P2002');

    const finalState = await service.getMyState({ actor: employeeActor });
    assert.equal(finalState.activeDevice.id, active[0].id);
    assert.equal(finalState.activeRequest, null);
    await cleanup();
  });

  test.after(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
}
