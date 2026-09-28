'use strict';

const EXPECTED_MIGRATION_HEAD = '202609280002_g06_gps_only_uat_event_provenance_constraint';

function queryRaw(prisma, sql) {
  if (typeof prisma?.$queryRawUnsafe !== 'function') throw new Error('Prisma read-only query capability is unavailable');
  return prisma.$queryRawUnsafe(sql);
}

function migrationIsCurrent(rows, expectedHead) {
  return rows.some((row) => String(row?.migration_name || '') === expectedHead && Boolean(row?.finished_at) && !row?.rolled_back_at);
}

function normalizedConstraint(value) {
  return String(value || '').replace(/\s+/g, ' ').toUpperCase();
}

async function verifyG06GpsUatPreviewMigration({ prisma, expectedHead = EXPECTED_MIGRATION_HEAD, log = console.log } = {}) {
  const ownsClient = !prisma;
  let client = prisma;
  if (!client) {
    const { PrismaClient } = require('@prisma/client');
    client = new PrismaClient();
  }
  log('RAW_DATABASE_OUTPUT_EMITTED=false');
  log(`MIGRATION_HEAD=${expectedHead}`);
  try {
    if (expectedHead !== EXPECTED_MIGRATION_HEAD) throw new Error('Unexpected migration head');

    const migrationRows = await queryRaw(client, `
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      WHERE migration_name = '${EXPECTED_MIGRATION_HEAD}'
      LIMIT 1
    `);
    const migrationCurrent = migrationIsCurrent(Array.isArray(migrationRows) ? migrationRows : [], expectedHead);
    log(`G06_GPS_UAT_MIGRATION_STATE=${migrationCurrent ? 'CURRENT' : 'NOT_CURRENT'}`);
    if (!migrationCurrent) throw new Error('G06 GPS UAT migration is not current');

    const enumRows = await queryRaw(client, `
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'AttendanceEventProvenance'
    `);
    const enumValues = new Set((Array.isArray(enumRows) ? enumRows : []).map((row) => String(row?.enumlabel || '')));
    const provenanceReady = enumValues.has('ONLINE') && enumValues.has('GPS_ONLY_UAT');
    log(`G06_GPS_UAT_PROVENANCE_ENUM=${provenanceReady ? 'PASS' : 'FAIL'}`);
    if (!provenanceReady) throw new Error('GPS_ONLY_UAT provenance enum is missing');

    const columnRows = await queryRaw(client, `
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'attendance_events'
        AND column_name = 'face_verification_session_id'
      LIMIT 1
    `);
    const faceNullable = String(columnRows?.[0]?.is_nullable || '').toUpperCase() === 'YES';
    log(`G06_GPS_UAT_FACE_SESSION_NULLABLE=${faceNullable ? 'PASS' : 'FAIL'}`);
    if (!faceNullable) throw new Error('Face verification session column is not nullable for explicit UAT provenance');

    const constraintRows = await queryRaw(client, `
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'attendance_events_verification_provenance_check'
      LIMIT 1
    `);
    const definition = normalizedConstraint(constraintRows?.[0]?.definition);
    const constraintReady = definition.includes('ONLINE')
      && definition.includes('GPS_ONLY_UAT')
      && definition.includes('FACE_VERIFICATION_SESSION_ID')
      && definition.includes('IS NOT NULL')
      && definition.includes('IS NULL');
    log(`G06_GPS_UAT_PROVENANCE_CONSTRAINT=${constraintReady ? 'PASS' : 'FAIL'}`);
    if (!constraintReady) throw new Error('Attendance verification provenance constraint is missing or incomplete');

    log('G06_GPS_UAT_PREVIEW_SCHEMA=PASS');
    return { migrationHead: expectedHead, migrationCurrent, provenanceReady, faceNullable, constraintReady };
  } catch (reason) {
    if (reason?.message === 'Unexpected migration head') throw reason;
    throw new Error('G06 GPS-only UAT Preview migration verification failed');
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

async function main() {
  try {
    await verifyG06GpsUatPreviewMigration();
    return 0;
  } catch {
    console.error('G06 GPS-only UAT Preview migration verification failed');
    return 1;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { EXPECTED_MIGRATION_HEAD, migrationIsCurrent, normalizedConstraint, verifyG06GpsUatPreviewMigration };