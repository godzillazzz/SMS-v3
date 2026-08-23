process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && process.env.TEST_DATABASE_RUNNER === 'g06-reference-photo-disposable-local'
  && target.hostname === '127.0.0.1'
  && target.port === '55436'
  && target.pathname.replace(/^\//, '') === 'sms_v3_test';

if (!configured) {
  test('G06 Reference Photo integration requires the explicit disposable local target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createEmployeeReferencePhotoService } = require('../../src/services/employee-reference-photo.service');
  const audit = require('../../src/services/audit.service');
  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8);
  const ids = { employee: crypto.randomUUID(), manager: crypto.randomUUID(), admin: crypto.randomUUID() };
  const managerActor = { sub: ids.manager, role: 'MANAGER' };
  const adminActor = { sub: ids.admin, role: 'ADMIN' };
  const viewerActor = { sub: crypto.randomUUID(), role: 'VIEWER' };
  const objects = new Map(); const puts = []; const removed = []; const signed = []; const failDelete = new Set();
  const storage = {
    async put(key, file) { puts.push(key); objects.set(key, Buffer.from(file.buffer)); return { provider: 'fake', bucket: 'reference-photo-test' }; },
    async remove(key) { if (failDelete.has(key)) { const error = new Error('simulated delete failure'); error.code = 'SIMULATED_DELETE_FAILURE'; throw error; } objects.delete(key); removed.push(key); },
    async createSignedUrl(key, ttl) { signed.push({ key, ttl }); return `https://signed.test/${encodeURIComponent(key)}?ttl=${ttl}`; }
  };
  const service = createEmployeeReferencePhotoService({ prisma, storage, audit });
  function png(name = 'reference.png', width = 512, height = 512) { const buffer = Buffer.alloc(32); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(buffer,0); buffer.writeUInt32BE(width,16); buffer.writeUInt32BE(height,20); return { buffer, size: buffer.length, mimetype: 'image/png', originalname: name }; }

  async function cleanup() {
    const photos = await prisma.employeeReferencePhoto.findMany({ where: { employeeId: ids.employee }, select: { id: true } }).catch(() => []);
    if (photos.length) await prisma.auditLog.deleteMany({ where: { entityType: 'EmployeeReferencePhoto', entityId: { in: photos.map((row) => row.id) } } });
    await prisma.employeeReferencePhoto.deleteMany({ where: { employeeId: ids.employee } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ids.manager, ids.admin] } } }).catch(() => {});
    await prisma.employee.deleteMany({ where: { id: ids.employee } }).catch(() => {});
  }

  test('real DB enforces governed Reference Photo lifecycle, Retention A cleanup, retry, and one-winner approval', async () => {
    await cleanup(); objects.clear(); puts.splice(0); removed.splice(0); signed.splice(0); failDelete.clear();
    await prisma.employee.create({ data: { id: ids.employee, employeeCode: 'REF-' + marker, firstName: 'Reference', lastName: 'Photo', department: 'SECURITY', isActive: true } });
    await prisma.user.createMany({ data: [
      { id: ids.manager, email: 'ref-manager-' + marker + '@example.test', passwordHash: 'test-only', displayName: 'Reference Manager', role: 'MANAGER' },
      { id: ids.admin, email: 'ref-admin-' + marker + '@example.test', passwordHash: 'test-only', displayName: 'Reference Admin', role: 'ADMIN' }
    ] });

    await assert.rejects(() => service.upload({ employeeId: ids.employee, actor: viewerActor, file: png('viewer.png') }), (error) => error.statusCode === 403);

    const firstSubmit = await service.upload({ employeeId: ids.employee, actor: managerActor, file: png('first.png') });
    assert.equal(firstSubmit.photo.status, 'PENDING_APPROVAL');
    let state = await service.getForEmployee({ employeeId: ids.employee, actor: managerActor });
    assert.equal(state.activePhoto, null); assert.equal(state.pendingPhoto.id, firstSubmit.photo.id);
    await service.view({ id: firstSubmit.photo.id, actor: managerActor });
    assert.equal(signed.at(-1).ttl, 60);

    const firstApproval = await service.approve({ id: firstSubmit.photo.id, actor: adminActor });
    assert.equal(firstApproval.photo.status, 'ACTIVE'); assert.equal(firstApproval.cleanup.pending, false);
    const firstRow = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: firstSubmit.photo.id } });
    assert.equal(firstRow.status, 'ACTIVE'); assert.equal(objects.has(firstRow.storageObjectKey), true);

    const secondSubmit = await service.upload({ employeeId: ids.employee, actor: managerActor, file: png('second.png') });
    state = await service.getForEmployee({ employeeId: ids.employee, actor: adminActor });
    assert.equal(state.activePhoto.id, firstSubmit.photo.id); assert.equal(state.pendingPhoto.id, secondSubmit.photo.id);
    const objectCountBeforeDuplicate = objects.size; const putCountBeforeDuplicate = puts.length;
    await assert.rejects(() => service.upload({ employeeId: ids.employee, actor: managerActor, file: png('duplicate.png') }), (error) => error.statusCode === 409);
    assert.equal(objects.size, objectCountBeforeDuplicate); assert.equal(puts.length, putCountBeforeDuplicate);

    failDelete.add(firstRow.storageObjectKey);
    const secondApproval = await service.approve({ id: secondSubmit.photo.id, actor: adminActor });
    assert.equal(secondApproval.photo.status, 'ACTIVE'); assert.equal(secondApproval.cleanup.pending, true);
    const oldAfterFailure = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: firstSubmit.photo.id } });
    const secondRow = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: secondSubmit.photo.id } });
    assert.equal(oldAfterFailure.status, 'SUPERSEDED'); assert.equal(oldAfterFailure.storageDeletedAt, null); assert.ok(oldAfterFailure.storageDeletionRequestedAt);
    assert.equal(secondRow.status, 'ACTIVE');
    const signedBeforeOldView = signed.length;
    await assert.rejects(() => service.view({ id: firstSubmit.photo.id, actor: adminActor }), (error) => error.statusCode === 410);
    assert.equal(signed.length, signedBeforeOldView);
    failDelete.delete(firstRow.storageObjectKey);
    const retry = await service.retryPendingDeletions();
    assert.ok(retry.some((row) => row.id === firstSubmit.photo.id && row.deleted));
    const oldDeleted = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: firstSubmit.photo.id } });
    assert.ok(oldDeleted.storageDeletedAt); assert.equal(objects.has(firstRow.storageObjectKey), false);

    await assert.rejects(() => prisma.employeeReferencePhoto.create({ data: { employeeId: ids.employee, status: 'ACTIVE', storageProvider: 'fake', storageBucket: 'reference-photo-test', storageObjectKey: 'illegal/' + marker, originalFileName: 'illegal.png', safeDisplayFileName: 'illegal.png', mimeType: 'image/png', fileSize: 32, checksum: 'a'.repeat(64), imageWidth: 512, imageHeight: 512, uploadedByUserId: ids.admin, uploadedByRoleSnapshot: 'ADMIN', reviewedByUserId: ids.admin, reviewedAt: new Date(), activatedAt: new Date() } }), (error) => error.code === 'P2002');

    const direct = await service.upload({ employeeId: ids.employee, actor: adminActor, file: png('admin-direct.png') });
    assert.equal(direct.photo.status, 'ACTIVE');
    const secondAfterDirect = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: secondSubmit.photo.id } });
    assert.equal(secondAfterDirect.status, 'SUPERSEDED'); assert.ok(secondAfterDirect.storageDeletedAt); assert.ok(removed.includes(secondRow.storageObjectKey));

    const concurrentCandidate = await service.upload({ employeeId: ids.employee, actor: managerActor, file: png('concurrent.png') });
    const approvals = await Promise.allSettled([service.approve({ id: concurrentCandidate.photo.id, actor: adminActor }), service.approve({ id: concurrentCandidate.photo.id, actor: adminActor })]);
    assert.equal(approvals.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(approvals.filter((r) => r.status === 'rejected' && r.reason?.statusCode === 409).length, 1);
    const finalApproveAudits = await prisma.auditLog.count({ where: { entityType: 'EmployeeReferencePhoto', entityId: concurrentCandidate.photo.id, metadata: { path: ['event'], equals: 'FINAL_APPROVE' } } });
    assert.equal(finalApproveAudits, 1);
    const activeRows = await prisma.employeeReferencePhoto.findMany({ where: { employeeId: ids.employee, status: 'ACTIVE' } });
    assert.equal(activeRows.length, 1);

    const cancelCandidate = await service.upload({ employeeId: ids.employee, actor: managerActor, file: png('cancel.png') });
    const cancelRow = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: cancelCandidate.photo.id } });
    await service.cancel({ id: cancelCandidate.photo.id, actor: managerActor });
    const cancelled = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: cancelCandidate.photo.id } });
    assert.equal(cancelled.status, 'CANCELLED'); assert.ok(cancelled.storageDeletedAt); assert.equal(objects.has(cancelRow.storageObjectKey), false);

    const rejectCandidate = await service.upload({ employeeId: ids.employee, actor: managerActor, file: png('reject.png') });
    const rejectRow = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: rejectCandidate.photo.id } });
    await service.reject({ id: rejectCandidate.photo.id, actor: adminActor, reason: 'ภาพไม่เหมาะสำหรับใช้อ้างอิง' });
    const rejected = await prisma.employeeReferencePhoto.findUniqueOrThrow({ where: { id: rejectCandidate.photo.id } });
    assert.equal(rejected.status, 'REJECTED'); assert.ok(rejected.storageDeletedAt); assert.equal(objects.has(rejectRow.storageObjectKey), false);

    await cleanup();
  });

  test.after(async () => { await cleanup().catch(() => {}); await prisma.$disconnect(); });
}
