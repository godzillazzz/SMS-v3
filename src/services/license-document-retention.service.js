function sanitizedErrorCode(error) {
  const code = String(error?.code || error?.name || 'STORAGE_CLEANUP_FAILED').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
  return code || 'STORAGE_CLEANUP_FAILED';
}

async function cleanupSupersededLicenseDocuments({ prisma, storage, now = new Date(), limit = 100 }) {
  const documents = await prisma.employeeLicenseDocument.findMany({
    where: { status: 'SUPERSEDED', isCurrent: false, storageDeleteAfter: { lte: now }, storageDeletedAt: null },
    select: { id: true, storageObjectKey: true },
    orderBy: { storageDeleteAfter: 'asc' },
    take: limit
  });
  let deleted = 0;
  let failed = 0;
  for (const document of documents) {
    try {
      await storage.remove(document.storageObjectKey);
      await prisma.employeeLicenseDocument.update({ where: { id: document.id }, data: { storageDeletedAt: now, storageDeleteLastErrorAt: null, storageDeleteLastErrorCode: null } });
      deleted += 1;
    } catch (error) {
      await prisma.employeeLicenseDocument.update({ where: { id: document.id }, data: { storageDeleteAttempts: { increment: 1 }, storageDeleteLastErrorAt: now, storageDeleteLastErrorCode: sanitizedErrorCode(error) } });
      failed += 1;
    }
  }
  return { inspected: documents.length, deleted, failed };
}

module.exports = { cleanupSupersededLicenseDocuments, sanitizedErrorCode };
