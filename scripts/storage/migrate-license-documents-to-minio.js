'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createS3ObjectStorage } = require('../../src/services/object-storage-provider');
const { createStorageReadResolver } = require('../../src/services/storage-read-resolver');
const audit = require('../../src/services/audit.service');

const TARGET_BUCKET = 'smsv3-license-documents';
const TARGET_PROVIDER = 's3';

async function migrateLicenseDocuments({ prisma, environment = process.env, dryRun = true, auditService = audit, rollbackLogPath, s3Client, readResolverClient } = {}) {
  if (!prisma) throw new Error('Prisma client is required');
  const resolver = readResolverClient || createStorageReadResolver({ environment });
  let s3 = s3Client;
  if (!s3 && !dryRun) {
    s3 = createS3ObjectStorage({ environment });
  }

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

  const rollbackJournal = [];

  for (const row of rows) {
    summary.scanned += 1;
    try {
      // 1. Read from current source
      const sourceRead = await resolver.read(row);
      if (!sourceRead || !sourceRead.bytes) {
        throw new Error('SOURCE_READ_FAILED');
      }
      const sourceSha256 = crypto.createHash('sha256').update(sourceRead.bytes).digest('hex');

      if (row.storageProvider === TARGET_PROVIDER && row.storageBucket === TARGET_BUCKET) {
        summary.alreadyMigrated += 1;
        if (sourceRead.sizeBytes === row.fileSize) {
          summary.verified += 1;
        } else {
          throw new Error('S3_VERIFICATION_SIZE_MISMATCH');
        }
        continue;
      }

      if (dryRun) {
        // True dry run: verified that source is readable and checksum calculated
        summary.migrated += 1;
        summary.verified += 1;
        continue;
      }

      // Record rollback checkpoint for this row
      rollbackJournal.push({
        id: row.id,
        storageProvider: row.storageProvider,
        storageBucket: row.storageBucket,
        checksum: row.checksum
      });

      // 2. Upload to MinIO (S3)
      await s3.put(TARGET_BUCKET, row.storageObjectKey, {
        buffer: sourceRead.bytes,
        mimetype: sourceRead.mimeType
      });

      // 3. Verify read back from MinIO by reading content and calculating SHA-256
      const s3Read = await resolver.read({
        ...row,
        storageProvider: TARGET_PROVIDER,
        storageBucket: TARGET_BUCKET
      });

      if (!s3Read || !s3Read.bytes) {
        throw new Error('S3_READ_BACK_EMPTY');
      }

      const s3Sha256 = crypto.createHash('sha256').update(s3Read.bytes).digest('hex');
      if (s3Sha256 !== sourceSha256 || s3Read.sizeBytes !== sourceRead.sizeBytes) {
        throw new Error('S3_SHA256_MISMATCH');
      }

      // 4. Update database row
      await prisma.employeeLicenseDocument.update({
        where: { id: row.id },
        data: {
          storageProvider: TARGET_PROVIDER,
          storageBucket: TARGET_BUCKET,
          checksum: s3Sha256
        }
      });

      // 5. Audit trail
      await auditService?.log?.({
        actorUserId: null,
        action: 'UPDATE',
        entityType: 'EmployeeLicenseDocument',
        entityId: row.id,
        metadata: {
          event: 'STORAGE_MIGRATED_TO_MINIO',
          previousProvider: row.storageProvider,
          previousBucket: row.storageBucket,
          targetProvider: TARGET_PROVIDER,
          targetBucket: TARGET_BUCKET,
          checksum: s3Sha256,
          sizeBytes: sourceRead.sizeBytes
        }
      }).catch(() => undefined);

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

  if (rollbackLogPath && rollbackJournal.length > 0) {
    try {
      fs.writeFileSync(rollbackLogPath, JSON.stringify(rollbackJournal, null, 2), 'utf8');
    } catch {
      // ignore rollback file write failure
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
