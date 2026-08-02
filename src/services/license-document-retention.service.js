const { workDate } = require('./license-state.service');

const LICENSE_DOCUMENT_TRANSACTION_OPTIONS = Object.freeze({ maxWait: 10000, timeout: 30000 });

function sanitizedErrorCode(error) {
  const code = String(error?.code || error?.name || 'STORAGE_CLEANUP_FAILED').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
  return code || 'STORAGE_CLEANUP_FAILED';
}

async function recordStorageFailure({ prisma, documentId, now, error }) {
  await prisma.employeeLicenseDocument.update({
    where: { id: documentId },
    data: { storageDeleteAttempts: { increment: 1 }, storageDeleteLastErrorAt: now, storageDeleteLastErrorCode: sanitizedErrorCode(error) }
  }).catch(() => undefined);
}

async function removeLicenseDocumentFile({ prisma, storage, document, now = new Date() }) {
  const objectKey = document.storageDeleteObjectKey || document.storageObjectKey;
  if (!objectKey) return { deleted: false, failed: false, skipped: true };
  try {
    await storage.remove(objectKey);
  } catch (error) {
    await recordStorageFailure({ prisma, documentId: document.id, now, error });
    return { deleted: false, failed: true };
  }
  const data = document.storageDeleteObjectKey
    ? { storageDeleteObjectKey: null, storageDeleteAfter: null, storageDeleteLastErrorAt: null, storageDeleteLastErrorCode: null }
    : { storageDeletedAt: now, storageDeleteAfter: null, storageDeleteLastErrorAt: null, storageDeleteLastErrorCode: null };
  try {
    const updated = await prisma.employeeLicenseDocument.update({ where: { id: document.id }, data });
    return { deleted: true, failed: false, document: updated };
  } catch (error) {
    await recordStorageFailure({ prisma, documentId: document.id, now, error });
    return { deleted: true, failed: true, document };
  }
}

async function cleanupDueLicenseDocuments({ prisma, storage, now = new Date(), limit = 100 }) {
  const documents = await prisma.employeeLicenseDocument.findMany({
    where: {
      storageDeleteAfter: { lte: now },
      storageDeletedAt: null,
      OR: [
        { status: 'SUPERSEDED', isCurrent: false, storageDeleteObjectKey: null },
        { status: { in: ['REJECTED', 'EXPIRED'] }, isCurrent: false },
        { storageDeleteObjectKey: { not: null } }
      ]
    },
    select: { id: true, storageObjectKey: true, storageDeleteObjectKey: true },
    orderBy: { storageDeleteAfter: 'asc' },
    take: limit
  });
  let deleted = 0;
  let failed = 0;
  for (const document of documents) {
    const result = await removeLicenseDocumentFile({ prisma, storage, document, now });
    if (result.deleted) deleted += 1;
    if (result.failed) failed += 1;
  }
  return { inspected: documents.length, deleted, failed };
}

async function cleanupSupersededLicenseDocuments({ prisma, storage, now = new Date(), limit = 100 }) {
  return cleanupDueLicenseDocuments({ prisma, storage, now, limit });
}

async function expireDueLicenseDocuments({ prisma, storage, audit, now = new Date(), limit = 100 }) {
  const today = workDate(now);
  const candidates = await prisma.employeeLicenseDocument.findMany({
    where: { status: 'APPROVED', isCurrent: true, expirationProcessedAt: null, license: { expiryDate: { lt: today } } },
    select: { id: true, storageObjectKey: true, licenseId: true, employeeId: true },
    orderBy: { id: 'asc' },
    take: limit
  });
  let expired = 0;
  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const expiredAt = new Date(now);
    const document = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM employee_license_documents WHERE id = ${candidate.id}::uuid FOR UPDATE`;
      const found = await tx.employeeLicenseDocument.findUnique({ where: { id: candidate.id }, include: { license: { select: { expiryDate: true } } } });
      if (!found || found.status !== 'APPROVED' || !found.isCurrent || found.expirationProcessedAt || workDate(found.license.expiryDate) >= today) return null;
      const updated = await tx.employeeLicenseDocument.update({
        where: { id: candidate.id },
        data: { status: 'EXPIRED', isCurrent: false, storageDeleteAfter: expiredAt, immediateDeletionRequestedAt: expiredAt, expirationProcessedAt: expiredAt }
      });
      await audit.log({ actorUserId: null, action: 'UPDATE', entityType: 'EmployeeLicenseDocument', entityId: candidate.id, metadata: { event: 'EXPIRE', licenseId: found.licenseId, employeeId: found.employeeId } }, tx);
      return updated;
    }, LICENSE_DOCUMENT_TRANSACTION_OPTIONS);
    if (!document) continue;
    expired += 1;
    const result = await removeLicenseDocumentFile({ prisma, storage, document, now: expiredAt });
    if (result.deleted) deleted += 1;
    if (result.failed) failed += 1;
  }
  return { inspected: candidates.length, expired, deleted, failed };
}

module.exports = {
  LICENSE_DOCUMENT_TRANSACTION_OPTIONS,
  sanitizedErrorCode,
  removeLicenseDocumentFile,
  cleanupDueLicenseDocuments,
  cleanupSupersededLicenseDocuments,
  expireDueLicenseDocuments
};
