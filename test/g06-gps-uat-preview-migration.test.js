'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_MIGRATION_HEAD,
  migrationIsCurrent,
  normalizedConstraint,
  verifyG06GpsUatPreviewMigration
} = require('../scripts/ci/verify-g06-gps-uat-preview-migration');

function fakePrisma({ migration = true, enumReady = true, nullable = true, constraintReady = true } = {}) {
  return {
    $queryRawUnsafe: async (sql) => {
      if (sql.includes('_prisma_migrations')) return migration ? [{ migration_name: EXPECTED_MIGRATION_HEAD, finished_at: new Date(), rolled_back_at: null }] : [];
      if (sql.includes('pg_enum')) return enumReady ? [{ enumlabel: 'ONLINE' }, { enumlabel: 'GPS_ONLY_UAT' }] : [{ enumlabel: 'ONLINE' }];
      if (sql.includes('information_schema.columns')) return [{ is_nullable: nullable ? 'YES' : 'NO' }];
      if (sql.includes('pg_constraint')) return constraintReady
        ? [{ definition: `CHECK (((provenance = 'ONLINE') AND (face_verification_session_id IS NOT NULL)) OR ((provenance = 'GPS_ONLY_UAT') AND (face_verification_session_id IS NULL)))` }]
        : [];
      throw new Error('unexpected query');
    }
  };
}

test('G06 Preview migration verifier proves the new migration, enum, nullable Face FK, and provenance constraint', async () => {
  const logs = [];
  const result = await verifyG06GpsUatPreviewMigration({ prisma: fakePrisma(), log: (line) => logs.push(line) });
  assert.equal(result.migrationCurrent, true);
  assert.equal(result.provenanceReady, true);
  assert.equal(result.faceNullable, true);
  assert.equal(result.constraintReady, true);
  assert.ok(logs.includes('G06_GPS_UAT_PREVIEW_SCHEMA=PASS'));
  assert.ok(logs.includes('RAW_DATABASE_OUTPUT_EMITTED=false'));
});

test('G06 Preview migration verifier fails closed when any provenance invariant is absent', async () => {
  for (const state of [
    { migration: false },
    { enumReady: false },
    { nullable: false },
    { constraintReady: false }
  ]) {
    await assert.rejects(
      () => verifyG06GpsUatPreviewMigration({ prisma: fakePrisma(state), log: () => {} }),
      /G06 GPS-only UAT Preview migration verification failed/
    );
  }
});

test('G06 Preview migration workflow is manual, exact-source, fingerprint-guarded, and applies only the expected migration', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'one-time-g06-gps-uat-preview-migration.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /EXPECTED_SOURCE_BRANCH: preview\/enterprise-evolution-20260927/);
  assert.match(workflow, /REQUIRED_CONFIRMATION: MIGRATE_G06_GPS_ONLY_UAT_PREVIEW/);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /verify-preview-migration-target\.js/);
  assert.match(workflow, /APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT/);
  assert.match(workflow, /APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT/);
  assert.match(workflow, /grep -Fxq "MIGRATION_NAME=\$EXPECTED_MIGRATION_HEAD"/);
  assert.match(workflow, /prisma-migration\.js deploy/);
  assert.match(workflow, /verify-g06-gps-uat-preview-migration\.js/);
  assert.doesNotMatch(workflow, /prisma\s+migrate\s+resolve|prisma\s+db\s+push|prisma\s+db\s+seed|db:seed/i);
  assert.match(workflow, /Production database accessed: NO/);
});

test('migration helpers accept only the exact G06 head and normalize constraint whitespace', async () => {
  assert.equal(migrationIsCurrent([{ migration_name: EXPECTED_MIGRATION_HEAD, finished_at: new Date(), rolled_back_at: null }], EXPECTED_MIGRATION_HEAD), true);
  assert.match(normalizedConstraint('check ( face_verification_session_id   is null )'), /IS NULL/);
  await assert.rejects(
    () => verifyG06GpsUatPreviewMigration({ prisma: fakePrisma(), expectedHead: 'wrong-head', log: () => {} }),
    /Unexpected migration head/
  );
});