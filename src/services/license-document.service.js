const crypto = require('node:crypto');
const HttpError = require('../utils/http-error');
const { validateUpload, safeName } = require('./license-document-storage.service');
const { optimizeAttachment } = require('./attachment-optimizer.service');
const { LICENSE_DOCUMENT_TRANSACTION_OPTIONS, removeLicenseDocumentFile } = require('./license-document-retention.service');
const { APPROVAL_TRANSITIONS, workflowAuditActionFor, buildWorkflowAuditEnvelope } = require('./approval-workflow-semantics');

const APPROVAL_TRANSACTION_OPTIONS = LICENSE_DOCUMENT_TRANSACTION_OPTIONS;
const VIEWABLE_STATUSES = new Set(['PENDING', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED']);
const PERMANENT_DELETE_STATUSES = new Set(['RETURNED_FOR_CORRECTION', 'REJECTED', 'CANCELLED', 'SUPERSEDED']);
const LICENSE_CANCEL_ALLOWED_STATES = new Set(['RETURNED_FOR_CORRECTION']);

const revisionSelect = {
  id: true, documentId: true, revision: true, safeDisplayFileName: true, mimeType: true, fileSize: true,
  proposedStartDate: true, proposedExpiryDate: true, proposedLicenseNumber: true, note: true, submittedAt: true,
  correctionReason: true, submittedBy: { select: { id: true, displayName: true } }
};

const historySelect = {
  id: true, employeeId: true, licenseId: true, safeDisplayFileName: true, mimeType: true, fileSize: true,
  proposedStartDate: true, proposedExpiryDate: true, proposedLicenseNumber: true, status: true, isCurrent: true, uploadedAt: true,
  reviewedAt: true, rejectionReason: true, correctionReason: true, returnedAt: true, resubmittedAt: true,
  immediateDeletionRequestedAt: true, expirationProcessedAt: true, version: true, note: true,
  storageDeletedAt: true, storageDeleteAfter: true,
  uploadedBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  returnedBy: { select: { id: true, displayName: true } },
  revisions: { orderBy: { revision: 'desc' }, select: revisionSelect }
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

function tableDocumentSummary(documents, now = new Date()) {
  const sorted = [...documents].sort((left, right) => Number(right.version) - Number(left.version) || new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime());
  const current = sorted.find((item) => item.status === 'APPROVED' && item.isCurrent);
  const pending = sorted.find((item) => item.status === 'PENDING');
  const returned = sorted.find((item) => isActiveReturnedDocument(item, sorted));
  const latestRejected = sorted.find((item) => item.status === 'REJECTED');
  const latestCancelled = sorted.find((item) => item.status === 'CANCELLED');
  const latestExpired = sorted.find((item) => item.status === 'EXPIRED');
  const selected = current
    || sorted.find((item) => item.status === 'PENDING' && isDocumentFileAvailable(item, now))
    || (returned && isDocumentFileAvailable(returned, now) ? returned : undefined)
    || (latestCancelled && isDocumentFileAvailable(latestCancelled, now) ? latestCancelled : undefined)
    || (latestRejected && isDocumentFileAvailable(latestRejected, now) ? latestRejected : undefined);
  const state = pending && current ? 'CURRENT_WITH_PENDING'
    : returned && current ? 'CURRENT_WITH_RETURNED'
      : current ? 'CURRENT'
        : pending ? 'PENDING'
          : returned ? 'RETURNED_FOR_CORRECTION'
            : latestCancelled ? 'CANCELLED'
              : latestRejected ? 'REJECTED'
              : latestExpired ? 'EXPIRED' : 'EMPTY';
  return {
    state,
    selectedDocumentId: selected?.id || null,
    selectedFileAvailable: selected ? isDocumentFileAvailable(selected, now) : false,
    selectedFileDeleted: Boolean(selected?.storageDeletedAt),
    currentDocumentId: current?.id || null,
    pendingDocumentId: pending?.id || null,
    reviewAvailable: Boolean(pending)
  };
}

function ensureDocumentNotPendingDeletion(document) {
  if (document.immediateDeletionRequestedAt) throw new HttpError(409, 'This license document is being permanently deleted.');
}

async function ensureOperationalEmployee(client, employeeId) {
  const employee = await client.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { id: true, isActive: true, deletedAt: true } });
  if (!employee.isActive || employee.deletedAt) throw new HttpError(409, 'Inactive employees cannot receive operational license changes.', { code: 'INACTIVE_EMPLOYEE_OPERATION' });
  return employee;
}

function revisionValue(overrides, key, fallback) {
  return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : fallback;
}

function revisionData(document, { revision, submittedById, submittedAt, correctionReason = null, overrides = {} }) {
  return {
    documentId: document.id,
    revision,
    storageProvider: revisionValue(overrides, 'storageProvider', document.storageProvider),
    storageBucket: revisionValue(overrides, 'storageBucket', document.storageBucket),
    storageObjectKey: revisionValue(overrides, 'storageObjectKey', document.storageObjectKey),
    originalFileName: revisionValue(overrides, 'originalFileName', document.originalFileName),
    safeDisplayFileName: revisionValue(overrides, 'safeDisplayFileName', document.safeDisplayFileName),
    mimeType: revisionValue(overrides, 'mimeType', document.mimeType),
    fileSize: revisionValue(overrides, 'fileSize', document.fileSize),
    checksum: revisionValue(overrides, 'checksum', document.checksum ?? null),
    proposedStartDate: revisionValue(overrides, 'proposedStartDate', document.proposedStartDate),
    proposedExpiryDate: revisionValue(overrides, 'proposedExpiryDate', document.proposedExpiryDate),
    proposedLicenseNumber: revisionValue(overrides, 'proposedLicenseNumber', document.proposedLicenseNumber ?? null),
    note: revisionValue(overrides, 'note', document.note ?? null),
    submittedById,
    submittedAt,
    correctionReason
  };
}

async function ensureInitialRevision(tx, document) {
  const latest = await tx.employeeLicenseDocumentRevision.findFirst({ where: { documentId: document.id }, orderBy: { revision: 'desc' }, select: revisionSelect });
  if (latest) return latest;
  return tx.employeeLicenseDocumentRevision.create({
    data: revisionData(document, { revision: 1, submittedById: document.uploadedById, submittedAt: document.uploadedAt || document.createdAt || new Date(), correctionReason: null }),
    select: revisionSelect
  });
}

function ensureRequestOwner(document, requestUser) {
  if (!document.uploadedById || !requestUser?.sub || document.uploadedById !== requestUser.sub) {
    throw new HttpError(403, 'Only the license document request owner can correct, resubmit, or cancel this request.', { code: 'LICENSE_DOCUMENT_REQUEST_OWNER_REQUIRED' });
  }
}

function workflowAuditMetadata({ document, requestUser, transition, revision, fromStatus, toStatus, reason = null, comment = null, timestamp = new Date(), extra = {} }) {
  const action = workflowAuditActionFor({ transition, hasNextReviewStage: false });
  return {
    event: action,
    ...buildWorkflowAuditEnvelope({
      workflow: 'EMPLOYEE_LICENSE_DOCUMENT',
      requestId: document.id,
      revision,
      actorUserId: requestUser?.sub || null,
      actorRole: requestUser?.role || null,
      fromStatus,
      toStatus,
      action,
      reason,
      comment,
      timestamp
    }),
    licenseId: document.licenseId,
    employeeId: document.employeeId,
    ...extra
  };
}

function createLicenseDocumentService({ prisma, storage, audit, reconcileSchedules }) {
  if (!prisma || !storage || !audit || !reconcileSchedules) throw new Error('License document service dependencies are required.');

  async function canAccess(_tx, requestUser, employeeId) {
    if (requestUser.role === 'ADMIN') return true;
    return requestUser.role === 'MANAGER' && Boolean(employeeId);
  }

  async function list({ licenseId, requestUser }) {
    const license = await prisma.employeeLicense.findUniqueOrThrow({ where: { id: licenseId }, select: { employeeId: true } });
    if (!(await canAccess(prisma, requestUser, license.employeeId))) throw new HttpError(403, 'You cannot access this employee license.');
    const rows = await prisma.employeeLicenseDocument.findMany({ where: { licenseId }, orderBy: [{ version: 'desc' }], select: historySelect });
    return rows.map((row) => ({ ...row, fileAvailable: isDocumentFileAvailable(row) }));
  }

  async function tableSummaries({ licenses, requestUser }) {
    ensureEditor(requestUser);
    const visibleLicenses = Array.isArray(licenses) ? licenses : [];
    for (const license of visibleLicenses) {
      if (!(await canAccess(prisma, requestUser, license.employeeId))) throw new HttpError(403, 'You cannot access this employee license.');
    }
    const licenseIds = [...new Set(visibleLicenses.map((license) => license.id).filter(Boolean))];
    if (!licenseIds.length) return {};
    const rows = await prisma.employeeLicenseDocument.findMany({
      where: { licenseId: { in: licenseIds } },
      select: { id: true, licenseId: true, status: true, isCurrent: true, version: true, uploadedAt: true, resubmittedAt: true, storageDeletedAt: true, storageDeleteAfter: true }
    });
    const byLicense = new Map(licenseIds.map((id) => [id, []]));
    rows.forEach((row) => byLicense.get(row.licenseId)?.push(row));
    return Object.fromEntries(licenseIds.map((id) => [id, tableDocumentSummary(byLicense.get(id) || [])]));
  }

  async function upload({ licenseId, requestUser, file, input }) {
    ensureProposedDates(input?.proposedStartDate, input?.proposedExpiryDate);
    const proposedLicenseNumber = normalizeLicenseNumber(input?.licenseNumber);
    const optimized = await optimizeAttachment(file, 'DOCUMENT');
    file = optimized.file;
    const fileInfo = validateUpload(file);
    const note = normalizeNote(input?.note);
    const license = await prisma.$transaction(async (tx) => {
      const found = await tx.employeeLicense.findUniqueOrThrow({ where: { id: licenseId }, select: { id: true, employeeId: true, issueDate: true, expiryDate: true } });
      if (!(await canAccess(tx, requestUser, found.employeeId))) throw new HttpError(403, 'You cannot upload for this employee license.');
      await ensureOperationalEmployee(tx, found.employeeId);
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
        await ensureOperationalEmployee(tx, license.employeeId);
        const version = (await tx.employeeLicenseDocument.aggregate({ where: { licenseId }, _max: { version: true } }))._max.version || 0;
        const displayName = safeName(file.originalname);
        const document = await tx.employeeLicenseDocument.create({ data: { employeeId: license.employeeId, licenseId, storageProvider: stored.provider, storageBucket: stored.bucket, storageObjectKey: objectKey, originalFileName: displayName, safeDisplayFileName: displayName, mimeType: fileInfo.mimeType, fileSize: file.size, checksum: fileInfo.checksum, proposedStartDate: input.proposedStartDate, proposedExpiryDate: input.proposedExpiryDate, proposedLicenseNumber, version: version + 1, note, uploadedById: requestUser.sub } });
        const revision = await tx.employeeLicenseDocumentRevision.create({ data: revisionData(document, { revision: 1, submittedById: requestUser.sub, submittedAt: document.uploadedAt }), select: revisionSelect });
        await audit.log({ actorUserId: requestUser.sub, action: 'CREATE', entityType: 'EmployeeLicenseDocument', entityId: document.id, metadata: workflowAuditMetadata({ document, requestUser, transition: APPROVAL_TRANSITIONS.SUBMIT, revision: revision.revision, fromStatus: null, toStatus: 'PENDING', timestamp: document.uploadedAt, extra: { created: true, version: document.version, mimeType: document.mimeType, fileSize: document.fileSize } }) }, tx);
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
      if (!isDocumentFileAvailable(found)) throw new HttpError(410, unavailableMessage(found));
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
        ensureDocumentNotPendingDeletion(document);
        if (document.status !== 'PENDING') throw new HttpError(409, 'Only pending license documents can be approved.');
        ensureProposedDates(document.proposedStartDate, document.proposedExpiryDate);
        const currentRevision = await ensureInitialRevision(tx, document);
        const license = await tx.employeeLicense.findUniqueOrThrow({ where: { id: document.licenseId }, select: { id: true, employeeId: true, licenseNumber: true } });
        await ensureOperationalEmployee(tx, license.employeeId);
        const reviewedAt = new Date();
        await tx.employeeLicenseDocument.updateMany({ where: { licenseId: document.licenseId, isCurrent: true }, data: { isCurrent: false, status: 'SUPERSEDED', storageDeleteAfter: null, immediateDeletionRequestedAt: null } });
        const approved = await tx.employeeLicenseDocument.update({ where: { id }, data: { status: 'APPROVED', isCurrent: true, reviewedById: requestUser.sub, reviewedAt, rejectionReason: null } });
        await tx.employeeLicense.update({ where: { id: document.licenseId }, data: { licenseNumber: currentRevision.proposedLicenseNumber || license.licenseNumber, issueDate: currentRevision.proposedStartDate, expiryDate: currentRevision.proposedExpiryDate } });
        await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: workflowAuditMetadata({ document, requestUser, transition: APPROVAL_TRANSITIONS.APPROVE, revision: currentRevision.revision, fromStatus: 'PENDING', toStatus: 'APPROVED', timestamp: reviewedAt, extra: { uploadedById: document.uploadedById, reviewedById: requestUser.sub, selfApproved: document.uploadedById === requestUser.sub } }) }, tx);
        await reconcileSchedules(tx, license.employeeId, requestUser.sub);
        return approved;
      }, APPROVAL_TRANSACTION_OPTIONS);
    } catch (error) {
      if (error?.code === 'P2034' || error?.code === 'P2002') throw new HttpError(409, 'This license document was already reviewed.');
      throw error;
    }
  }

  async function returnForCorrection({ id, requestUser, correctionReason }) {
    ensureAdmin(requestUser);
    const reason = normalizeReason(correctionReason, 'Correction reason', 1000);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
       const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
       ensureDocumentNotPendingDeletion(document);
       if (document.status !== 'PENDING') throw new HttpError(409, 'Only pending license documents can be returned for correction.');
       await ensureOperationalEmployee(tx, document.employeeId);
      const currentRevision = await ensureInitialRevision(tx, document);
      const returnedAt = new Date();
      const returned = await tx.employeeLicenseDocument.update({ where: { id }, data: { status: 'RETURNED_FOR_CORRECTION', isCurrent: false, correctionReason: reason, returnedById: requestUser.sub, returnedAt, resubmittedAt: null, rejectionReason: null, storageDeleteAfter: null, immediateDeletionRequestedAt: null } });
      await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: workflowAuditMetadata({ document, requestUser, transition: APPROVAL_TRANSITIONS.RETURN_FOR_CORRECTION, revision: currentRevision.revision, fromStatus: 'PENDING', toStatus: 'RETURNED_FOR_CORRECTION', comment: reason, timestamp: returnedAt, extra: { returnedById: requestUser.sub } }) }, tx);
      return returned;
    }, APPROVAL_TRANSACTION_OPTIONS);
  }

  async function resubmit({ id, requestUser, input, file }) {
    ensureEditor(requestUser);
    const proposedLicenseNumber = normalizeLicenseNumber(input?.proposedLicenseNumber ?? input?.licenseNumber);
    ensureProposedDates(input?.proposedStartDate, input?.proposedExpiryDate);
    const note = normalizeNote(input?.note);
    if (file) file = (await optimizeAttachment(file, 'DOCUMENT')).file;
    const fileInfo = file ? validateUpload(file) : null;
    const previous = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      ensureDocumentNotPendingDeletion(document);
      if (document.status !== 'RETURNED_FOR_CORRECTION') throw new HttpError(409, 'Only returned license documents can be resubmitted.');
      ensureRequestOwner(document, requestUser);
      await ensureOperationalEmployee(tx, document.employeeId);
      await ensureInitialRevision(tx, document);
      if (!file && !isDocumentFileAvailable(document)) throw new HttpError(410, 'The returned license document file is no longer available.');
      return document;
    }, APPROVAL_TRANSACTION_OPTIONS);
    const objectKey = file ? `licenses/${previous.employeeId}/${crypto.randomUUID()}` : null;
    let uploaded = false;
    try {
      const stored = file ? await storage.put(objectKey, { ...file, mimetype: fileInfo.mimeType }) : null;
      uploaded = Boolean(stored);
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
        ensureDocumentNotPendingDeletion(document);
        if (document.status !== 'RETURNED_FOR_CORRECTION') throw new HttpError(409, 'Only returned license documents can be resubmitted.');
        ensureRequestOwner(document, requestUser);
        await ensureOperationalEmployee(tx, document.employeeId);
        const currentRevision = await ensureInitialRevision(tx, document);
        const resubmittedAt = new Date();
        const fileOverrides = file ? { storageProvider: stored.provider, storageBucket: stored.bucket, storageObjectKey: objectKey, originalFileName: safeName(file.originalname), safeDisplayFileName: safeName(file.originalname), mimeType: fileInfo.mimeType, fileSize: file.size, checksum: fileInfo.checksum } : {};
        const nextRevision = await tx.employeeLicenseDocumentRevision.create({
          data: revisionData(document, { revision: currentRevision.revision + 1, submittedById: requestUser.sub, submittedAt: resubmittedAt, correctionReason: document.correctionReason, overrides: { ...fileOverrides, proposedLicenseNumber, proposedStartDate: input.proposedStartDate, proposedExpiryDate: input.proposedExpiryDate, note } }),
          select: revisionSelect
        });
        const data = { status: 'PENDING', isCurrent: false, proposedLicenseNumber, proposedStartDate: input.proposedStartDate, proposedExpiryDate: input.proposedExpiryDate, note, reviewedById: null, reviewedAt: null, rejectionReason: null, resubmittedAt, storageDeleteAfter: null, storageDeleteObjectKey: null, immediateDeletionRequestedAt: null };
        if (file) Object.assign(data, fileOverrides, { storageDeleteAttempts: 0, storageDeleteLastErrorAt: null, storageDeleteLastErrorCode: null, storageDeletedAt: null });
        const resubmitted = await tx.employeeLicenseDocument.update({ where: { id }, data });
        await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: workflowAuditMetadata({ document, requestUser, transition: APPROVAL_TRANSITIONS.RESUBMIT, revision: nextRevision.revision, fromStatus: 'RETURNED_FOR_CORRECTION', toStatus: 'PENDING', comment: document.correctionReason, timestamp: resubmittedAt, extra: { replacedFile: Boolean(file) } }) }, tx);
        return resubmitted;
      }, APPROVAL_TRANSACTION_OPTIONS);
    } catch (error) {
      if (uploaded) await storage.remove(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async function reject({ id, requestUser, rejectionReason }) {
    ensureAdmin(requestUser);
    const reason = normalizeReason(rejectionReason, 'Rejection reason', 2000);
    const reviewedAt = new Date();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      ensureDocumentNotPendingDeletion(document);
      if (document.status !== 'PENDING') throw new HttpError(409, 'Only pending license documents can be rejected.');
      await ensureOperationalEmployee(tx, document.employeeId);
      const currentRevision = await ensureInitialRevision(tx, document);
      const next = await tx.employeeLicenseDocument.update({ where: { id }, data: { status: 'REJECTED', isCurrent: false, reviewedById: requestUser.sub, reviewedAt, rejectionReason: reason, storageDeleteAfter: null, immediateDeletionRequestedAt: null } });
      await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: workflowAuditMetadata({ document, requestUser, transition: APPROVAL_TRANSITIONS.REJECT, revision: currentRevision.revision, fromStatus: 'PENDING', toStatus: 'REJECTED', reason, timestamp: reviewedAt }) }, tx);
      return next;
    }, APPROVAL_TRANSACTION_OPTIONS);
  }

  async function cancel({ id, requestUser }) {
    ensureEditor(requestUser);
    const cancelledAt = new Date();
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const document = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      ensureDocumentNotPendingDeletion(document);
      ensureRequestOwner(document, requestUser);
      if (!LICENSE_CANCEL_ALLOWED_STATES.has(document.status)) throw new HttpError(409, 'Only a returned license document request can be cancelled.', { code: 'LICENSE_DOCUMENT_CANCEL_NOT_ALLOWED' });
      const currentRevision = await ensureInitialRevision(tx, document);
      const cancelled = await tx.employeeLicenseDocument.update({ where: { id }, data: { status: 'CANCELLED', isCurrent: false, reviewedById: null, reviewedAt: null, storageDeleteAfter: null, immediateDeletionRequestedAt: null } });
      await audit.log({ actorUserId: requestUser.sub, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: id, metadata: workflowAuditMetadata({ document, requestUser, transition: APPROVAL_TRANSITIONS.CANCEL, revision: currentRevision.revision, fromStatus: document.status, toStatus: 'CANCELLED', timestamp: cancelledAt }) }, tx);
      return cancelled;
    }, APPROVAL_TRANSACTION_OPTIONS);
  }

  async function permanentlyDelete({ id, requestUser }) {
    ensureAdmin(requestUser);
    const deletionRequestedAt = new Date();
    const document = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
      const found = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
      const documents = await tx.employeeLicenseDocument.findMany({ where: { licenseId: found.licenseId }, select: { id: true, status: true, isCurrent: true, version: true, uploadedAt: true, resubmittedAt: true } });
      ensurePermanentDeleteEligible(found, documents);
      return tx.employeeLicenseDocument.update({ where: { id }, data: { immediateDeletionRequestedAt: deletionRequestedAt, storageDeleteAfter: deletionRequestedAt } });
    }, APPROVAL_TRANSACTION_OPTIONS);
    try { if (!document.storageDeletedAt) await storage.remove(document.storageObjectKey); }
    catch (_error) { await prisma.employeeLicenseDocument.update({ where: { id }, data: { immediateDeletionRequestedAt: null, storageDeleteAfter: null, storageDeleteLastErrorAt: new Date(), storageDeleteLastErrorCode: 'HARD_DELETE_STORAGE_FAILED' } }).catch(() => undefined); throw new HttpError(503, 'The license document could not be permanently deleted.'); }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const found = await tx.employeeLicenseDocument.findUniqueOrThrow({ where: { id } });
        if (String(found.immediateDeletionRequestedAt) !== String(deletionRequestedAt)) throw new HttpError(409, 'The license document changed during permanent deletion.');
        const documents = await tx.employeeLicenseDocument.findMany({ where: { licenseId: found.licenseId }, select: { id: true, status: true, isCurrent: true, version: true, uploadedAt: true, resubmittedAt: true } });
        ensurePermanentDeleteEligible(found, documents);
        await audit.log({
          actorUserId: requestUser.sub,
          action: 'DELETE',
          entityType: 'EmployeeLicenseDocument',
          entityId: id,
          metadata: { event: 'PERMANENT_DELETE', licenseId: found.licenseId }
        }, tx);
        await tx.employeeLicenseDocument.delete({ where: { id } });
      }, APPROVAL_TRANSACTION_OPTIONS);
    } catch (_error) { await prisma.employeeLicenseDocument.update({ where: { id }, data: { storageDeletedAt: new Date(), immediateDeletionRequestedAt: null, storageDeleteAfter: null, storageDeleteLastErrorCode: 'HARD_DELETE_DATABASE_FAILED' } }).catch(() => undefined); throw new HttpError(503, 'The file was removed but the document record could not be deleted.'); }
    return { id, deleted: true };
  }

  return { list, tableSummaries, upload, view, approve, returnForCorrection, resubmit, reject, cancel, permanentlyDelete, canAccess };
}

module.exports = { createLicenseDocumentService, historySelect, revisionSelect, normalizeLicenseNumber, normalizeReason, retentionDays, isDocumentFileAvailable, tableDocumentSummary, LICENSE_CANCEL_ALLOWED_STATES, APPROVAL_TRANSACTION_OPTIONS };
