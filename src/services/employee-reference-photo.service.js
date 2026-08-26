'use strict';

const crypto = require('node:crypto');
const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');
const { validateReferencePhoto, safeName } = require('./employee-reference-photo-storage.service');
const { optimizeAttachment } = require('./attachment-optimizer.service');

function http(statusCode, code, message) { return new HttpError(statusCode, message, { code }); }
function assertReviewer(actor) { if (!['ADMIN', 'MANAGER'].includes(actor?.role)) throw http(403, 'REFERENCE_PHOTO_FORBIDDEN', 'Reference photo access requires Admin or Manager.'); }
function assertAdmin(actor) { if (actor?.role !== 'ADMIN') throw http(403, 'REFERENCE_PHOTO_ADMIN_REQUIRED', 'Admin approval is required for this action.'); }
function requiredReason(value) { const text = String(value || '').trim(); if (text.length < 3) throw http(400, 'REFERENCE_PHOTO_REJECTION_REASON_REQUIRED', 'A rejection reason of at least 3 characters is required.'); return text.slice(0, 1000); }
function safeUser(row) { return row ? { id: row.id, displayName: row.displayName } : undefined; }
function safePhoto(row) {
  if (!row) return null;
  return { id: row.id, employeeId: row.employeeId, status: row.status, fileName: row.safeDisplayFileName, mimeType: row.mimeType, fileSize: row.fileSize, imageWidth: row.imageWidth, imageHeight: row.imageHeight, uploadedByRoleSnapshot: row.uploadedByRoleSnapshot, uploadedAt: row.uploadedAt, reviewedAt: row.reviewedAt, rejectionReason: row.rejectionReason, activatedAt: row.activatedAt, supersededAt: row.supersededAt, cancelledAt: row.cancelledAt, storageDeletedAt: row.storageDeletedAt, cleanupPending: Boolean(row.storageDeletionRequestedAt && !row.storageDeletedAt), createdAt: row.createdAt, updatedAt: row.updatedAt, uploadedBy: safeUser(row.uploadedBy), reviewedBy: safeUser(row.reviewedBy) };
}
function storageErrorCode(error) { return String(error?.details?.code || error?.code || 'REFERENCE_PHOTO_STORAGE_DELETE_FAILED').slice(0, 80); }
function mapConflict(error) { if (error?.code === 'P2002' || error?.code === 'P2034') return http(409, 'REFERENCE_PHOTO_STATE_CONFLICT', 'Reference photo state changed. Please refresh and try again.'); return error; }

function createEmployeeReferencePhotoService({ prisma = prismaDefault, storage, audit = auditDefault, clock = () => new Date(), randomUUID = crypto.randomUUID } = {}) {
  if (!storage) throw new Error('Employee reference photo storage adapter is required.');

  async function assertOperationalEmployee(client, employeeId) {
    const employee = await client.employee.findUnique({ where: { id: employeeId }, select: { id: true, isActive: true, deletedAt: true, firstName: true, lastName: true, displayName: true, department: true } });
    if (!employee) throw http(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
    if (!employee.isActive || employee.deletedAt) throw http(409, 'INACTIVE_EMPLOYEE_OPERATION', 'Inactive employees cannot receive a Reference Photo change.');
    return employee;
  }

  async function cleanupObject(photo) {
    if (!photo?.storageDeletionRequestedAt || photo.storageDeletedAt) return { deleted: Boolean(photo?.storageDeletedAt), pending: false };
    try {
      await storage.remove(photo.storageObjectKey);
      await prisma.employeeReferencePhoto.update({ where: { id: photo.id }, data: { storageDeletedAt: clock(), storageDeleteAttempts: { increment: 1 }, storageDeleteLastErrorAt: null, storageDeleteLastErrorCode: null } });
      await audit.log({ actorUserId: null, action: 'DELETE', entityType: 'EmployeeReferencePhoto', entityId: photo.id, metadata: { event: 'STORAGE_DELETE_COMPLETE', employeeId: photo.employeeId, status: photo.status } });
      return { deleted: true, pending: false };
    } catch (error) {
      await prisma.employeeReferencePhoto.update({ where: { id: photo.id }, data: { storageDeleteAttempts: { increment: 1 }, storageDeleteLastErrorAt: clock(), storageDeleteLastErrorCode: storageErrorCode(error) } }).catch(() => undefined);
      await audit.log({ actorUserId: null, action: 'UPDATE', entityType: 'EmployeeReferencePhoto', entityId: photo.id, metadata: { event: 'STORAGE_DELETE_RETRY_REQUIRED', employeeId: photo.employeeId, status: photo.status, errorCode: storageErrorCode(error) } }).catch(() => undefined);
      return { deleted: false, pending: true };
    }
  }

  async function getForEmployee({ employeeId, actor }) {
    assertReviewer(actor);
    await assertOperationalEmployee(prisma, employeeId);
    const rows = await prisma.employeeReferencePhoto.findMany({ where: { employeeId }, include: { uploadedBy: { select: { id: true, displayName: true } }, reviewedBy: { select: { id: true, displayName: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20 });
    const visible = actor.role === 'ADMIN' ? rows : rows.filter((row) => row.status !== 'PENDING_APPROVAL' || row.uploadedByUserId === actor.sub);
    return { employeeId, activePhoto: safePhoto(visible.find((row) => row.status === 'ACTIVE')), pendingPhoto: safePhoto(visible.find((row) => row.status === 'PENDING_APPROVAL')), history: visible.filter((row) => !['ACTIVE', 'PENDING_APPROVAL'].includes(row.status)).map(safePhoto) };
  }

  async function upload({ employeeId, actor, file }) {
    assertReviewer(actor);
    file = (await optimizeAttachment(file, 'EMPLOYEE_REFERENCE_PHOTO')).file;
    const fileInfo = validateReferencePhoto(file);
    await assertOperationalEmployee(prisma, employeeId);
    const preexistingPending = await prisma.employeeReferencePhoto.findFirst({ where: { employeeId, status: 'PENDING_APPROVAL' }, select: { id: true } });
    if (preexistingPending) throw http(409, 'REFERENCE_PHOTO_PENDING_EXISTS', 'This Employee already has a pending Reference Photo.');
    const objectKey = `employee-reference-photos/${employeeId}/${randomUUID()}.${fileInfo.type === 'jpeg' ? 'jpg' : 'png'}`;
    const stored = await storage.put(objectKey, file);
    const displayName = safeName(file.originalname);
    let created; let superseded = null;
    try {
      created = await prisma.$transaction(async (tx) => {
        await assertOperationalEmployee(tx, employeeId);
        if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId}::uuid FOR UPDATE`;
        const pending = await tx.employeeReferencePhoto.findFirst({ where: { employeeId, status: 'PENDING_APPROVAL' }, select: { id: true } });
        if (pending) throw http(409, 'REFERENCE_PHOTO_PENDING_EXISTS', 'This Employee already has a pending Reference Photo.');
        const active = await tx.employeeReferencePhoto.findFirst({ where: { employeeId, status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' } });
        const now = clock();
        if (actor.role === 'ADMIN' && active) {
          superseded = await tx.employeeReferencePhoto.update({ where: { id: active.id }, data: { status: 'SUPERSEDED', supersededAt: now, storageDeletionRequestedAt: now } });
          await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'EmployeeReferencePhoto', entityId: active.id, metadata: { event: 'SUPERSEDE', employeeId, replacementMode: 'ADMIN_DIRECT' } }, tx);
        }
        const status = actor.role === 'ADMIN' ? 'ACTIVE' : 'PENDING_APPROVAL';
        const photo = await tx.employeeReferencePhoto.create({ data: { employeeId, status, storageProvider: stored.provider, storageBucket: stored.bucket, storageObjectKey: objectKey, originalFileName: displayName, safeDisplayFileName: displayName, mimeType: fileInfo.mimeType, fileSize: file.size, checksum: fileInfo.checksum, imageWidth: fileInfo.width, imageHeight: fileInfo.height, uploadedByUserId: actor.sub, uploadedByRoleSnapshot: actor.role, reviewedByUserId: actor.role === 'ADMIN' ? actor.sub : null, reviewedAt: actor.role === 'ADMIN' ? now : null, activatedAt: actor.role === 'ADMIN' ? now : null }, include: { uploadedBy: { select: { id: true, displayName: true } }, reviewedBy: { select: { id: true, displayName: true } } } });
        await audit.log({ actorUserId: actor.sub, action: 'CREATE', entityType: 'EmployeeReferencePhoto', entityId: photo.id, metadata: { event: actor.role === 'ADMIN' ? 'DIRECT_ACTIVATE' : 'SUBMIT', employeeId, status, mimeType: fileInfo.mimeType, fileSize: file.size, imageWidth: fileInfo.width, imageHeight: fileInfo.height } }, tx);
        return photo;
      });
    } catch (error) {
      await storage.remove(objectKey).catch(() => undefined);
      throw mapConflict(error);
    }
    const cleanup = superseded ? await cleanupObject(superseded) : { deleted: false, pending: false };
    return { photo: safePhoto(created), cleanup };
  }

  async function approve({ id, actor }) {
    assertAdmin(actor); let superseded = null;
    let approved;
    try {
      approved = await prisma.$transaction(async (tx) => {
        const initial = await tx.employeeReferencePhoto.findUnique({ where: { id }, select: { id: true, employeeId: true } });
        if (!initial) throw http(404, 'REFERENCE_PHOTO_NOT_FOUND', 'Reference photo not found.');
        await assertOperationalEmployee(tx, initial.employeeId);
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT id FROM employees WHERE id = ${initial.employeeId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM employee_reference_photos WHERE employee_id = ${initial.employeeId}::uuid FOR UPDATE`;
        }
        const candidate = await tx.employeeReferencePhoto.findUnique({ where: { id } });
        if (!candidate || candidate.status !== 'PENDING_APPROVAL') throw http(409, 'REFERENCE_PHOTO_NOT_PENDING', 'Only pending Reference Photos can be approved.');
        const active = await tx.employeeReferencePhoto.findFirst({ where: { employeeId: candidate.employeeId, status: 'ACTIVE' } });
        const now = clock();
        if (active) {
          superseded = await tx.employeeReferencePhoto.update({ where: { id: active.id }, data: { status: 'SUPERSEDED', supersededAt: now, storageDeletionRequestedAt: now } });
          await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'EmployeeReferencePhoto', entityId: active.id, metadata: { event: 'SUPERSEDE', employeeId: candidate.employeeId, replacementPhotoId: candidate.id } }, tx);
        }
        const row = await tx.employeeReferencePhoto.update({ where: { id }, data: { status: 'ACTIVE', reviewedByUserId: actor.sub, reviewedAt: now, activatedAt: now, rejectionReason: null }, include: { uploadedBy: { select: { id: true, displayName: true } }, reviewedBy: { select: { id: true, displayName: true } } } });
        await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'EmployeeReferencePhoto', entityId: id, metadata: { event: 'FINAL_APPROVE', employeeId: candidate.employeeId, previousActivePhotoId: active?.id || null } }, tx);
        return row;
      });
    } catch (error) { throw mapConflict(error); }
    const cleanup = superseded ? await cleanupObject(superseded) : { deleted: false, pending: false };
    return { photo: safePhoto(approved), cleanup };
  }

  async function reject({ id, actor, reason }) {
    assertAdmin(actor); const safeReason = requiredReason(reason); let rejected;
    rejected = await prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employee_reference_photos WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.employeeReferencePhoto.findUnique({ where: { id } });
      if (!row) throw http(404, 'REFERENCE_PHOTO_NOT_FOUND', 'Reference photo not found.');
      if (row.status !== 'PENDING_APPROVAL') throw http(409, 'REFERENCE_PHOTO_NOT_PENDING', 'Only pending Reference Photos can be rejected.');
      const now = clock();
      const next = await tx.employeeReferencePhoto.update({ where: { id }, data: { status: 'REJECTED', reviewedByUserId: actor.sub, reviewedAt: now, rejectionReason: safeReason, storageDeletionRequestedAt: now } });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'EmployeeReferencePhoto', entityId: id, metadata: { event: 'REJECT', employeeId: row.employeeId, reasonProvided: true } }, tx);
      return next;
    });
    return { photo: safePhoto(rejected), cleanup: await cleanupObject(rejected) };
  }

  async function cancel({ id, actor }) {
    if (actor?.role !== 'MANAGER') throw http(403, 'REFERENCE_PHOTO_MANAGER_OWNER_REQUIRED', 'Only the Manager who submitted the pending Reference Photo can cancel it.');
    let cancelled;
    cancelled = await prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') await tx.$queryRaw`SELECT id FROM employee_reference_photos WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.employeeReferencePhoto.findUnique({ where: { id } });
      if (!row) throw http(404, 'REFERENCE_PHOTO_NOT_FOUND', 'Reference photo not found.');
      if (row.status !== 'PENDING_APPROVAL' || row.uploadedByUserId !== actor.sub) throw http(403, 'REFERENCE_PHOTO_MANAGER_OWNER_REQUIRED', 'Only the Manager who submitted the pending Reference Photo can cancel it.');
      const now = clock();
      const next = await tx.employeeReferencePhoto.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now, storageDeletionRequestedAt: now } });
      await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'EmployeeReferencePhoto', entityId: id, metadata: { event: 'CANCEL', employeeId: row.employeeId } }, tx);
      return next;
    });
    return { photo: safePhoto(cancelled), cleanup: await cleanupObject(cancelled) };
  }

  async function view({ id, actor }) {
    assertReviewer(actor);
    const row = await prisma.employeeReferencePhoto.findUnique({ where: { id } });
    if (!row) throw http(404, 'REFERENCE_PHOTO_NOT_FOUND', 'Reference photo not found.');
    const allowedPending = row.status === 'PENDING_APPROVAL' && (actor.role === 'ADMIN' || row.uploadedByUserId === actor.sub);
    if (row.status !== 'ACTIVE' && !allowedPending) throw http(410, 'REFERENCE_PHOTO_NOT_VIEWABLE', 'This Reference Photo is no longer viewable.');
    if (row.storageDeletedAt || row.storageDeletionRequestedAt) throw http(410, 'REFERENCE_PHOTO_NOT_VIEWABLE', 'This Reference Photo is no longer viewable.');
    await audit.log({ actorUserId: actor.sub, action: 'UPDATE', entityType: 'EmployeeReferencePhoto', entityId: id, metadata: { event: 'VIEW', employeeId: row.employeeId, status: row.status } });
    return { url: await storage.createSignedUrl(row.storageObjectKey, 60), mimeType: row.mimeType, fileName: row.safeDisplayFileName };
  }

  async function retryPendingDeletions({ limit = 25 } = {}) {
    const rows = await prisma.employeeReferencePhoto.findMany({ where: { status: { in: ['SUPERSEDED', 'REJECTED', 'CANCELLED'] }, storageDeletionRequestedAt: { not: null }, storageDeletedAt: null }, orderBy: { storageDeletionRequestedAt: 'asc' }, take: Math.max(1, Math.min(Number(limit) || 25, 100)) });
    const results = []; for (const row of rows) results.push({ id: row.id, ...(await cleanupObject(row)) });
    return results;
  }

  return { getForEmployee, upload, approve, reject, cancel, view, retryPendingDeletions };
}

module.exports = { createEmployeeReferencePhotoService, safePhoto };
