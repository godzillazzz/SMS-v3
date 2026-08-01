const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { validateUpload, safeName } = require('./license-document-storage.service');

const historySelect = {
  id: true, employeeId: true, licenseId: true, safeDisplayFileName: true, mimeType: true, fileSize: true,
  proposedStartDate: true, proposedExpiryDate: true, proposedLicenseNumber: true, status: true, isCurrent: true, uploadedAt: true,
  reviewedAt: true, rejectionReason: true, version: true, note: true,
  storageDeletedAt: true, storageDeleteAfter: true,
  uploadedBy: { select: { id: true, displayName: true } }, reviewedBy: { select: { id: true, displayName: true } }
};

function ensureAdmin(requestUser) {
  if (requestUser?.role !== 'ADMIN') throw new HttpError(403, 'Administrator access is required.');
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

function retentionDays(environment = process.env) {
  const value = Number.parseInt(environment.LICENSE_DOCUMENT_RETENTION_DAYS || '30', 10);
  return Number.isInteger(value) && value >= 0 && value <= 3650 ? value : 30;
}

function addRetentionDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function createLicenseDocumentService({ prisma, storage, audit, reconcileSchedules }) {
  if (!prisma || !storage || !audit || !reconcileSchedules) throw new Error('License document service dependencies are required.');

  async function canAccess(tx, requestUser, employeeId) {
    if (requestUser.role === 'ADMIN') return true;
    return requestUser.role === 'MANAGER';
  }

  async function list({ licenseId, requestUser }) {
    return prisma.$transaction(async (tx) => {
      const license = await tx.employeeLicense.findUniqueOrThrow({ where: { id: licenseId }, select: { employeeId: true } });
      if (!(await canAccess(tx, requestUser, license.employeeId))) throw new HttpError(403, 'You cannot access this employee license.');
      const rows = await tx.employeeLicenseDocument.findMany({ where: { licenseId }, orderBy: [{ version: 'desc' }], select: historySelect });
      return rows.map((row) => ({ ...row, fileAvailable: !row.storageDeletedAt }));
    });
  }

  async function upload({ licenseId, requestUser, file, input }) {
    ensureProposedDates(input?.proposedStartDate, input?.proposedExpiryDate);
    const proposedLicenseNumber = normalizeLicenseNumber(input?.licenseNumber);
    const fileInfo = validateUpload(file);
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
      return await prisma.$transaction(async (tx) => {
        const version = (await tx.employeeLicenseDocument.aggregate({ where: { licenseId }, _max: { version: true } }))._max.version || 0;
        const displayName = safeName(file.originalname);
        const document = await tx.employeeLicenseDocument.create({ data: { employeeId: license.employeeId, licenseId, storageProvider: stored.provider, storageBucket: stored.bucket, storageObjectKey: objectKey, originalFileName: displayName, safeDisplayFileName: displayName, mimeType: fileInfo.mimeType, fileSize: file.size, checksum: fileInfo.checksum, proposedStartDate: input.proposedStartDate, proposedExpiryDate: input.proposedExpiryDate, proposedLicenseNumber, version: version + 1, note: input.note || null, uploadedById: requestUser.sub } });
        await audit.log({ actorUserId: requestUser.sub, action: 'CREATE', entityType: 'EmployeeLicenseDocument', entityId: document.id, metadata: { licenseId, employeeId: license.employeeId, status: 'PENDING', version: document.version, mimeType: document.mimeType, fileSize: document.fileSize } }, tx);
        return document;
      });
    } catch (error) {
      if (uploaded) await storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async function view({ id, requestUser }) {
    const document = await prisma.$transaction(async (tx) => {
      const found = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      if (!(await canAccess(tx, requestUser, found.employeeId))) throw new HttpError(403, 'You cannot view this license document.');
      if (found.storageDeletedAt) throw new HttpError(410, 'License document file is no longer available.');
      await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'VIEW' } }, tx);
      return found;
    });
    return { url: await storage.createSignedUrl(document.storageObjectKey, 600), mimeType: document.mimeType, fileName: document.safeDisplayFileName };
  }

  async function approve({ id, requestUser }) {
    ensureAdmin(requestUser);
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
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
      });
    } catch (error) {
      if (error?.code === 'P2034' || error?.code === 'P2002') throw new HttpError(409, 'This license document was already reviewed.');
      throw error;
    }
  }

  async function reject({ id, requestUser, rejectionReason }) {
    ensureAdmin(requestUser);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      if (document.status !== 'PENDING') throw new HttpError(409, 'Only pending license documents can be rejected.');
      const rejected = await tx.employeeLicenseDocument.update({ where: { id }, data: { status: 'REJECTED', reviewedById: requestUser.sub, reviewedAt: new Date(), rejectionReason } });
      await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: { event: 'REJECT', licenseId: document.licenseId } }, tx);
      return rejected;
    });
  }

  return { list, upload, view, approve, reject, canAccess };
}

module.exports = { createLicenseDocumentService, historySelect, normalizeLicenseNumber, retentionDays };
