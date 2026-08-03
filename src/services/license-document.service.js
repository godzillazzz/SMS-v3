const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { validateUpload, safeName } = require('./license-document-storage.service');
const { LICENSE_DOCUMENT_TRANSACTION_OPTIONS, removeLicenseDocumentFile } = require('./license-document-retention.service');

const APPROVAL_TRANSACTION_OPTIONS = LICENSE_DOCUMENT_TRANSACTION_OPTIONS;
const VIEWABLE_STATUSES = new Set(['PENDING', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'SUPERSEDED']);
const PERMANENT_DELETE_STATUSES = new Set(['RETURNED_FOR_CORRECTION', 'REJECTED', 'SUPERSEDED']);

const historySelect = {
  id: true, employeeId: true, licenseId: true, safeDisplayFileName: true, mimeType: true, fileSize: true,
  proposedStartDate: true, proposedExpiryDate: true, proposedLicenseNumber: true, status: true, isCurrent: true, uploadedAt: true,
  reviewedAt: true, rejectionReason: true, correctionReason: true, returnedAt: true, resubmittedAt: true,
  immediateDeletionRequestedAt: true, expirationProcessedAt: true, version: true, note: true,
  storageDeletedAt: true, storageDeleteAfter: true,
  uploadedBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  returnedBy: { select: { id: true, displayName: true } }
};

function ensureAdmin(requestUser) {
  if (requestUser?.role !== 'ADMIN') throw new HttpError(403, 'Administrator access is required.');
}

function ensureEditor(requestUser) {
  if (!['ADMIN', 'MANAGER'].includes(requestUser?.role)) throw new HttpError(403, 'Manager or administrator access is required.');
}

function ensureProposedDates(startDate, expiryDate) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime()) || !(expiryDate instanceof Date) || Number.isNaN(expiryDate.getTime())) {
    throw new HttpError(400, 'Valid start and expiry dates are required.');
  }
  if (startDate > expiryDate) throw new HttpError(400, 'Start date must not be after expiry date.');
}

function normalizeLicenseNumber(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'License number is required.');
  const normalized = value.trim();
  if (!normalized) throw new HttpError(400, 'License number is required.');
  if (normalized.length > 100 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new HttpError(400, 'License number is invalid.');
  return normalized;
}

function normalizeReason(value, label, max) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} is required.`);
  const normalized = value.trim();
  if (!normalized) throw new HttpError(400, `${label} is required.`);
  if (normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) throw new HttpError(400, `${label} is invalid.`);
  return normalized;
}

function normalizeNote(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new HttpError(400, 'Note is invalid.');
  return value.trim() || null;
}

function retentionDays(environment = process.env) {
  const value = Number.parseInt(environment.LICENSE_DOCUMENT_RETENTION_DAYS || '30', 10);
  return Number.isInteger(value) && value >= 0 && value <= 3650 ? value : 30;
}

function addRetentionDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isDocumentFileAvailable(document, now = new Date()) {
  if (!VIEWABLE_STATUSES.has(document.status) || document.storageDeletedAt) return false;
  if (document.status === 'SUPERSEDED' && document.storageDeleteAfter && new Date(document.storageDeleteAfter) <= now) return false;
  return true;
}

function unavailableMessage(document) {
  if (document.status === 'REJECTED') return 'ไฟล์ต้นฉบับถูกลบแล้ว เนื่องจากเอกสารไม่ได้รับการอนุมัติ';
  if (document.status === 'EXPIRED') return 'ไฟล์ต้นฉบับถูกลบแล้ว เนื่องจากใบอนุญาตหมดอายุ';
  return 'License document file is no longer available.';
}

function isNewerDocument(candidate, reference) {
  if (Number(candidate.version) !== Number(reference.version)) return Number(candidate.version) > Number(reference.version);
  return new Date(candidate.uploadedAt).getTime() > new Date(reference.uploadedAt).getTime();
}

function isActiveReturnedDocument(document, documents) {
  if (document.status !== 'RETURNED_FOR_CORRECTION' || document.resubmittedAt || document.isCurrent) return false;
  return !documents.some((newer) => isNewerDocument(newer, document) && ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'EXPIRED'].includes(newer.status));
}

function ensurePermanentDeleteEligible(document, documents) {
  if (!PERMANENT_DELETE_STATUSES.has(document.status)) throw new HttpError(409, 'This license document cannot be permanently deleted.');
  if (document.status === 'RETURNED_FOR_CORRECTION' && isActiveReturnedDocument(document, documents)) throw new HttpError(409, 'Active correction documents cannot be permanently deleted.');
  if (document.status === 'SUPERSEDED' && !documents.some((item) => item.status === 'APPROVED' && item.isCurrent)) throw new HttpError(409, 'This document has no approved replacement.');
}

function ensureDocumentNotPendingDeletion(document) {
  if (document.immediateDeletionRequestedAt) throw new HttpError(409, 'This license document is being permanently deleted.');
}

function createLicenseDocumentService({ prisma, storage, audit, reconcileSchedules, notifications = null }) {
  if (!prisma || !storage || !audit || !reconcileSchedules) throw new Error('License document service dependencies are required.');

  async function canAccess(_tx, requestUser, employeeId) {
    if (requestUser.role === 'ADMIN') return true;
    return requestUser.role === 'MANAGER' && Boolean(employeeId);
  }

  async function list({ licenseId, requestUser }) {
    return prisma.$transaction(async (tx) => {
      const license = await tx.employeeLicense.findUniqueOrThrow({ where: { id: licenseId }, select: { employeeId: true } });
      if (!(await canAccess(tx, requestUser, license.employeeId))) throw new HttpError(403, 'You cannot access this employee license.');
      const rows = await tx.employeeLicenseDocument.findMany({ where: { licenseId }, orderBy: [{ version: 'desc' }], select: historySelect });
      return rows.map((row) => ({ ...row, fileAvailable: isDocumentFileAvailable(row) }));
    });
  }

  async function upload({ licenseId, requestUser, file, input }) {
    ensureProposedDates(input?.proposedStartDate, input?.proposedExpiryDate);
    const proposedLicenseNumber = normalizeLicenseNumber(input?.licenseNumber);
    const fileInfo = validateUpload(file);
    const note = normalizeNote(input?.note);
    const license = await prisma.$transaction(async (tx) => {
      const found = await tx.employeeLicense.findUniqueOrThrow({ where: { id: licenseId }, select: { id: true, employeeId: true, issueDate: true, expiryDate: true } });
      if (!(await canAccess(tx, requestUser, found.employeeId))) throw new HttpError(403, 'You cannot upload for this employee license.');
      const duplicate = await tx.employeeLicenseDocument.findFirst({ where: { licenseId, checksum: fileInfo.checksum, proposedStartDate: input.proposedStartDate, proposedExpiryDate: input.proposedExpiryDate, status: 'PENDING' }, select: { id: true } });
      if (duplicate) throw new HttpError(409, 'This license document is already pending review.');
      return found;
    });
    const objectKey = `licenses/${license.employeeId}/${crypto.randomUUID()}`;
    let uploaded = false;
    try {
      const stored = await storage.put(objectKey, { ...file, mimetype: fileInfo.mimeType });
      uploaded = true;
      const document = await prisma.$transaction(async (tx) => {
        const version = (await tx.employeeLicenseDocument.aggregate({ where: { licenseId }, _max: { version: true } }))._max.version || 0;
        const displayName = safeName(file.originalname);
        const document = await tx.employeeLicenseDocument.create({ data: { employeeId: license.employeeId, licenseId, storageProvider: stored.provider, storageBucket: stored.bucket, storageObjectKey: objectKey, originalFileName: displayName, safeDisplayFileName: displayName, mimeType: fileInfo.mimeType, fileSize: file.size, checksum: fileInfo.checksum, proposedStartDate: input.proposedStartDate, proposedExpiryDate: input.proposedExpiryDate, proposedLicenseNumber, version: version + 1, note, uploadedById: requestUser.sub } });
        await audit.log({ actorUserId: requestUser.sub, action: 'CREATE', entityType: 'EmployeeLicenseDocument', entityId: document.id, metadata: { licenseId, employeeId: license.employeeId, status: 'PENDING', version: document.version, mimeType: document.mimeType, fileSize: document.fileSize } }, tx);
        return document;
      });
      notifications?.notifyLicenseDocumentEvent({ event: 'SUBMITTED', documentId: document.id }).catch(() => undefined);
      return document;
    } catch (error) {
      if (uploaded) await storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async function view({ id, requestUser }) {
    const document = await prisma.$transaction(async (tx) => {
      const found = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      if (!(await canAccess(tx, requestUser, found.employeeId))) throw new HttpError(403, 'You cannot view this license document.');
      if (!isDocumentFileAvailable(found)) throw new HttpError(410, unavailableMessage(found));
      await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'VIEW' } }, tx);
      return found;
    });
    return { url: await storage.createSignedUrl(document.storageObjectKey, 600), mimeType: document.mimeType, fileName: document.safeDisplayFileName };
  }

  async function approve({ id, requestUser }) {
    ensureAdmin(requestUser);
    try {
      const approved = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
        ensureDocumentNotPendingDeletion(document);
        if (document.status !== 'PENDING') throw new HttpError(409, 'Only pending license documents can be approved.');
        ensureProposedDates(document.proposedStartDate, document.proposedExpiryDate);
        const license = await tx.employeeLicense.findUniqueOrThrow({ where: { id: document.licenseId }, select: { id: true, employeeId: true, licenseNumber: true } });
        await tx.employee.findUniqueOrThrow({ where: { id: document.employeeId }, select: { id: true } });
        const reviewedAt = new Date();
        await tx.employeeLicenseDocument.updateMany({ where: { licenseId: document.licenseId, isCurrent: true }, data: { isCurrent: false, status: 'SUPERSEDED', storageDeleteAfter: addRetentionDays(reviewedAt, retentionDays()) } });
        const approved = await tx.employeeLicenseDocument.update({ where: { id }, data: { status: 'APPROVED', isCurrent: true, reviewedById: requestUser.sub, reviewedAt, rejectionReason: null } });
        await tx.employeeLicense.update({ where: { id: document.licenseId }, data: { licenseNumber: document.proposedLicenseNumber || license.licenseNumber, issueDate: document.proposedStartDate, expiryDate: document.proposedExpiryDate } });
        await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'APPROVE', licenseId: document.licenseId, uploadedById: document.uploadedById, reviewedById: requestUser.sub, selfApproved: document.uploadedById === requestUser.sub } }, tx);
        await reconcileSchedules(tx, license.employeeId, requestUser.sub);
        return approved;
      }, APPROVAL_TRANSACTION_OPTIONS);
      notifications?.notifyLicenseDocumentEvent({ event: 'APPROVED', documentId: approved.id, actorUserId: requestUser.sub }).catch(() => undefined);
      return approved;
    } catch (error) {
      if (error?.code === 'P2034' || error?.code === 'P2002') throw new HttpError(409, 'This license document was already reviewed.');
      throw error;
    }
  }

  async function returnForCorrection({ id, requestUser, correctionReason }) {
    ensureAdmin(requestUser);
    const reason = normalizeReason(correctionReason, 'Correction reason', 1000);
    const returned = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      ensureDocumentNotPendingDeletion(document);
      if (document.status !== 'PENDING') throw new HttpError(409, 'Only pending license documents can be returned for correction.');
      const returnedAt = new Date();
      const returned = await tx.employeeLicenseDocument.update({ where: { id }, data: { status: 'RETURNED_FOR_CORRECTION', isCurrent: false, correctionReason: reason, returnedById: requestUser.sub, returnedAt, resubmittedAt: null, rejectionReason: null, storageDeleteAfter: null, immediateDeletionRequestedAt: null } });
      await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'RETURN_FOR_CORRECTION', licenseId: document.licenseId, returnedById: requestUser.sub } }, tx);
      return returned;
    }, APPROVAL_TRANSACTION_OPTIONS);
    notifications?.notifyLicenseDocumentEvent({ event: 'RETURNED_FOR_CORRECTION', documentId: returned.id, reason, actorUserId: requestUser.sub }).catch(() => undefined);
    return returned;
  }

  async function resubmit({ id, requestUser, input, file }) {
    ensureEditor(requestUser);
    const proposedLicenseNumber = normalizeLicenseNumber(input?.proposedLicenseNumber ?? input?.licenseNumber);
    ensureProposedDates(input?.proposedStartDate, input?.proposedExpiryDate);
    const note = normalizeNote(input?.note);
    const fileInfo = file ? validateUpload(file) : null;
    const previous = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      ensureDocumentNotPendingDeletion(document);
      if (document.status !== 'RETURNED_FOR_CORRECTION') throw new HttpError(409, 'Only returned license documents can be resubmitted.');
      if (!(await canAccess(tx, requestUser, document.employeeId))) throw new HttpError(403, 'You cannot edit this employee license.');
      if (!file && !isDocumentFileAvailable(document)) throw new HttpError(410, 'The returned license document file is no longer available.');
      return document;
    }, APPROVAL_TRANSACTION_OPTIONS);
    const objectKey = file ? `licenses/${previous.employeeId}/${crypto.randomUUID()}` : null;
    let uploaded = false;
    try {
      const stored = file ? await storage.put(objectKey, { ...file, mimetype: fileInfo.mimeType }) : null;
      uploaded = Boolean(stored);
      const updated = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
        ensureDocumentNotPendingDeletion(document);
        if (document.status !== 'RETURNED_FOR_CORRECTION') throw new HttpError(409, 'Only returned license documents can be resubmitted.');
        if (!(await canAccess(tx, requestUser, document.employeeId))) throw new HttpError(403, 'You cannot edit this employee license.');
        const resubmittedAt = new Date();
        const data = { status: 'PENDING', isCurrent: false, proposedLicenseNumber, proposedStartDate: input.proposedStartDate, proposedExpiryDate: input.proposedExpiryDate, note, reviewedById: null, reviewedAt: null, rejectionReason: null, resubmittedAt, storageDeleteAfter: null, immediateDeletionRequestedAt: null };
        if (file) Object.assign(data, { storageProvider: stored.provider, storageBucket: stored.bucket, storageObjectKey: objectKey, originalFileName: safeName(file.originalname), safeDisplayFileName: safeName(file.originalname), mimeType: fileInfo.mimeType, fileSize: file.size, checksum: fileInfo.checksum, storageDeleteObjectKey: document.storageObjectKey, storageDeleteAfter: new Date() , storageDeleteAttempts: 0, storageDeleteLastErrorAt: null, storageDeleteLastErrorCode: null, storageDeletedAt: null });
        const resubmitted = await tx.employeeLicenseDocument.update({ where: { id }, data });
        await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'RESUBMIT', licenseId: document.licenseId, replacedFile: Boolean(file) } }, tx);
        return resubmitted;
      }, APPROVAL_TRANSACTION_OPTIONS);
      if (file) await removeLicenseDocumentFile({ prisma, storage, document: updated, now: new Date() });
      notifications?.notifyLicenseDocumentEvent({ event: 'RESUBMITTED', documentId: updated.id, actorUserId: requestUser.sub }).catch(() => undefined);
      return updated;
    } catch (error) {
      if (uploaded) await storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async function reject({ id, requestUser, rejectionReason }) {
    ensureAdmin(requestUser);
    const reason = normalizeReason(rejectionReason, 'Rejection reason', 2000);
    const reviewedAt = new Date();
    const rejected = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      ensureDocumentNotPendingDeletion(document);
      if (document.status !== 'PENDING') throw new HttpError(409, 'Only pending license documents can be rejected.');
      const next = await tx.employeeLicenseDocument.update({ where: { id }, data: { status: 'REJECTED', isCurrent: false, reviewedById: requestUser.sub, reviewedAt, rejectionReason: reason, storageDeleteAfter: reviewedAt, immediateDeletionRequestedAt: reviewedAt, storageDeletedAt: null } });
      await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'REJECT', licenseId: document.licenseId } }, tx);
      return next;
    }, APPROVAL_TRANSACTION_OPTIONS);
    const cleanup = await removeLicenseDocumentFile({ prisma, storage, document: rejected, now: reviewedAt });
    notifications?.notifyLicenseDocumentEvent({ event: 'REJECTED', documentId: rejected.id, reason, actorUserId: requestUser.sub }).catch(() => undefined);
    return cleanup.document || rejected;
  }

  async function permanentlyDelete({ id, requestUser }) {
    ensureAdmin(requestUser);
    const deletionRequestedAt = new Date();
    const document = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const found = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      ensureDocumentNotPendingDeletion(found);
      const documents = await tx.employeeLicenseDocument.findMany({ where: { licenseId: found.licenseId }, select: { id: true, status: true, isCurrent: true, version: true, uploadedAt: true, resubmittedAt: true } });
      ensurePermanentDeleteEligible(found, documents);
      return tx.employeeLicenseDocument.update({ where: { id }, data: { immediateDeletionRequestedAt: deletionRequestedAt, storageDeleteAfter: deletionRequestedAt } });
    }, APPROVAL_TRANSACTION_OPTIONS);

    const notificationSnapshot = notifications ? await prisma.employeeLicenseDocument.findUnique({ where: { id }, select: { id: true, status: true, proposedLicenseNumber: true, proposedStartDate: true, proposedExpiryDate: true, employeeId: true, employee: { select: { firstName: true, lastName: true, displayName: true, department: true, email: true, user: { select: { email: true } } } }, uploadedBy: { select: { email: true, displayName: true } } } }).catch(() => null) : null;
    try {
      if (!document.storageDeletedAt) await storage.remove(document.storageObjectKey);
    } catch (_error) {
      await prisma.employeeLicenseDocument.update({ where: { id }, data: { immediateDeletionRequestedAt: null, storageDeleteAfter: null, storageDeleteLastErrorAt: new Date(), storageDeleteLastErrorCode: 'HARD_DELETE_STORAGE_FAILED' } }).catch(() => undefined);
      throw new HttpError(503, 'The license document could not be permanently deleted.');
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const found = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
        if (String(found.immediateDeletionRequestedAt) !== String(deletionRequestedAt)) throw new HttpError(409, 'The license document changed during permanent deletion.');
        const documents = await tx.employeeLicenseDocument.findMany({ where: { licenseId: found.licenseId }, select: { id: true, status: true, isCurrent: true, version: true, uploadedAt: true, resubmittedAt: true } });
        ensurePermanentDeleteEligible(found, documents);
        await tx.auditLog.deleteMany({ where: { entityType: 'EmployeeLicenseDocument', entityId: id } });
        await tx.employeeLicenseDocument.delete({ where: { id } });
      }, APPROVAL_TRANSACTION_OPTIONS);
    } catch (_error) {
      await prisma.employeeLicenseDocument.update({ where: { id }, data: { storageDeletedAt: new Date(), immediateDeletionRequestedAt: null, storageDeleteAfter: null, storageDeleteLastErrorCode: 'HARD_DELETE_DATABASE_FAILED' } }).catch(() => undefined);
      throw new HttpError(503, 'The file was removed but the document record could not be deleted.');
    }
    notifications?.notifyLicenseDocumentEvent({ event: 'HARD_DELETED', documentId: id, actorUserId: requestUser.sub, snapshot: { ...notificationSnapshot, actorEmail: null } }).catch(() => undefined);
    return { id, deleted: true };
  }

  return { list, upload, view, approve, returnForCorrection, resubmit, reject, permanentlyDelete, canAccess };
}

module.exports = { createLicenseDocumentService, historySelect, normalizeLicenseNumber, normalizeReason, retentionDays, isDocumentFileAvailable, isActiveReturnedDocument, ensurePermanentDeleteEligible, APPROVAL_TRANSACTION_OPTIONS };
