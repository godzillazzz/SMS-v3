'use strict';

const crypto = require('node:crypto');
const { createS3ObjectStorage } = require('../../src/services/object-storage-provider');
const { createStorageReadResolver } = require('../../src/services/storage-read-resolver');

const TARGET_BUCKET = 'smsv3-license-documents';
const TARGET_PROVIDER = 's3';

async function migrateLicenseDocuments({ prisma, environment = process.env, dryRun = true } = {}) {
  if (!prisma) throw new Error('Prisma client is required');
  const resolver = createStorageReadResolver({ environment });
  const s3 = createS3ObjectStorage({ environment });

  const rows = await prisma.employeeLicenseDocument.findMany({
    where: { storageDeletedAt: null },
    orderBy: { uploadedAt: 'asc' }
  });

  const summary = {
    total: rows.length,
    scanned: 0,
    alreadyMigrated: 0,
    migrated: 0,
    verified: 0,
    failed: 0,
    dryRun,
    failures: []
  };

  for (const row of rows) {
    summary.scanned += 1;
    try {
      if (row.storageProvider === TARGET_PROVIDER && row.storageBucket === TARGET_BUCKET) {
        summary.alreadyMigrated += 1;
        const s3Read = await resolver.read(row);
        if (s3Read && s3Read.sizeBytes === row.fileSize) {
          summary.verified += 1;
        } else {
          throw new Error('S3_VERIFICATION_SIZE_MISMATCH');
        }
        continue;
      }

      // Read from current source (Supabase)
      const sourceRead = await resolver.read(row);
      const sha256 = crypto.createHash('sha256').update(sourceRead.bytes).digest('hex');

      if (dryRun) {
        summary.migrated += 1;
        summary.verified += 1;
        continue;
      }

      // Upload to MinIO (S3)
      await s3.put(TARGET_BUCKET, row.storageObjectKey, {
        buffer: sourceRead.bytes,
        mimetype: sourceRead.mimeType
      });

      // Verify read back from MinIO
      const s3Read = await resolver.read({
        ...row,
        storageProvider: TARGET_PROVIDER,
        storageBucket: TARGET_BUCKET
      });

      if (!s3Read || s3Read.sizeBytes !== sourceRead.sizeBytes) {
        throw new Error('S3_READ_BACK_SIZE_MISMATCH');
      }

      // Update database row
      await prisma.employeeLicenseDocument.update({
        where: { id: row.id },
        data: {
          storageProvider: TARGET_PROVIDER,
          storageBucket: TARGET_BUCKET,
          checksum: sha256
        }
      });

      summary.migrated += 1;
      summary.verified += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        id: row.id,
        key: row.storageObjectKey,
        error: error.code || error.message || 'MIGRATION_FAILED'
      });
    }
  }

  return summary;
}

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const prisma = new PrismaClient();

  migrateLicenseDocuments({ prisma, dryRun })
    .then((result) => {
      console.log('MIGRATION_RESULT:', JSON.stringify(result, null, 2));
      process.exitCode = result.failed > 0 ? 1 : 0;
    })
    .catch((error) => {
      console.error('MIGRATION_ERROR:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = {
  migrateLicenseDocuments,
  TARGET_BUCKET,
  TARGET_PROVIDER
};
