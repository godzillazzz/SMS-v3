'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseTarget,
  targetFingerprint,
} = require('../scripts/ci/verify-deployment-target');
const {
  verifyPreviewMigrationTarget,
} = require('../scripts/ci/verify-preview-migration-target');
const {
  EXPECTED_MIGRATION_HEAD,
  verifyPreviewMigrationState,
} = require('../scripts/ci/verify-preview-migration-state');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'migrate-approved-preview.yml'), 'utf8').replaceAll('\r\n', '\n');

const databaseUrl = 'postgresql://postgres.previewref:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const directUrl = 'postgresql://postgres.previewref:placeholder@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require';
const previewFingerprint = targetFingerprint(parseTarget('DATABASE_URL', databaseUrl), parseTarget('DIRECT_URL', directUrl));
const productionFingerprint = 'f'.repeat(64);

function targetEnv(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    DATABASE_URL: databaseUrl,
    DIRECT_URL: directUrl,
    APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: previewFingerprint,
    APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT: productionFingerprint,
    ...overrides,
  };
}

function fakePrisma({ migration = true, leave = true, auto = true, approvalCount = 26 } = {}) {
  return {
    async $queryRawUnsafe(sql) {
      if (sql.includes('_prisma_migrations')) {
        return migration ? [{ migration_name: EXPECTED_MIGRATION_HEAD, finished_at: new Date(), rolled_back_at: null }] : [];
      }
      if (sql.includes('information_schema.columns')) {
        return leave ? [
          { column_name: 'leave_type_id' },
          { column_name: 'leave_type_name_snapshot' },
          { column_name: 'leave_quota_bucket_snapshot' },
        ] : [];
      }
      if (sql.includes('auto_schedule_patterns')) return auto ? [{ name: 'auto_schedule_patterns' }] : [{ name: null }];
      if (sql.includes('system_settings')) return [{ count: approvalCount }];
      throw new Error('unexpected verification query');
    },
  };
}

test('Preview target guard proves the approved fingerprint without logging credentials', () => {
  const logs = [];
  const result = verifyPreviewMigrationTarget({ env: targetEnv(), log: (line) => logs.push(line) });
  assert.equal(result.fingerprint, previewFingerprint);
  assert.ok(logs.includes('PREVIEW_DATABASE_IDENTITY=PROVEN'));
  assert.ok(logs.includes('PREVIEW_NOT_PRODUCTION=PASS'));
  assert.ok(logs.every((line) => !line.includes('previewref') && !line.includes('placeholder')));
});

test('Preview target guard fails closed for missing or mismatched fingerprints', () => {
  assert.throws(
    () => verifyPreviewMigrationTarget({ env: targetEnv({ APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: '' }), log: () => {} }),
    /APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT is required/
  );
  assert.throws(
    () => verifyPreviewMigrationTarget({ env: targetEnv({ APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT: previewFingerprint }), log: () => {} }),
    /distinct/
  );
  assert.throws(
    () => verifyPreviewMigrationTarget({ env: targetEnv({ APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: 'e'.repeat(64) }), log: () => {} }),
    /fingerprint mismatch/
  );
});

test('Preview migration state verifier requires the expected head, schema, and policy configuration', async () => {
  const logs = [];
  const result = await verifyPreviewMigrationState({ prisma: fakePrisma(), log: (line) => logs.push(line) });
  assert.equal(result.migrationState, 'CURRENT');
  assert.equal(result.schemaCompatible, true);
  assert.ok(logs.includes(`MIGRATION_HEAD=${EXPECTED_MIGRATION_HEAD}`));
  assert.ok(logs.includes('PRISMA_MIGRATION_STATE=CURRENT'));
  assert.ok(logs.includes('APPROVAL_POLICY_REFERENCE_DATA=PRESENT'));
  assert.ok(logs.includes('RAW_DATABASE_OUTPUT_EMITTED=false'));
});

test('Preview migration state verifier fails closed when approval policy reference data is absent', async () => {
  const logs = [];
  await assert.rejects(
    verifyPreviewMigrationState({ prisma: fakePrisma({ approvalCount: 0 }), log: (line) => logs.push(line) }),
    /Preview migration compatibility verification failed/
  );
  assert.ok(logs.includes('APPROVAL_POLICY_REFERENCE_DATA=ABSENT'));
  assert.ok(logs.every((line) => !line.includes('employee') && !line.includes('placeholder')));
});

test('Preview migration state verifier fails closed for missing operational schema', async () => {
  const logs = [];
  await assert.rejects(verifyPreviewMigrationState({ prisma: fakePrisma({ leave: false, auto: false }), log: (line) => logs.push(line) }));
  assert.ok(logs.includes('LEAVE_REQUESTS_SCHEMA_COMPATIBILITY=FAIL'));
  assert.ok(logs.includes('AUTO_SCHEDULE_SCHEMA_COMPATIBILITY=FAIL'));
  assert.ok(logs.includes('SCHEMA_COMPATIBILITY=FAIL'));
});

test('Preview migration workflow is manual, protected, exact-source, and fail-closed', () => {
  assert.match(workflow, /^on:\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /name: 'Preview – sms-v3-staging'/);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
  assert.match(workflow, /DIRECT_URL: \$\{\{ secrets\.DIRECT_URL \}\}/);
  assert.match(workflow, /APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT: \$\{\{ vars\.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT \}\}/);
  assert.match(workflow, /APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT: \$\{\{ vars\.APPROVED_PRODUCTION_DATABASE_TARGET_FINGERPRINT \}\}/);
  assert.match(workflow, /node scripts\/ci\/verify-preview-migration-target\.js/);
  assert.match(workflow, /prisma-migration\.js status --allow-pending/);
  assert.match(workflow, /prisma-migration\.js deploy/);
  assert.match(workflow, /prisma-migration\.js status/);
  assert.match(workflow, /verify-preview-migration-state\.js/);
  assert.doesNotMatch(workflow, /prisma\s+migrate\s+resolve|prisma\s+db\s+push|prisma\s+db\s+seed|db:seed/i);
  assert.doesNotMatch(workflow, /DATABASE_URL[^\n]*(?:GITHUB_OUTPUT|GITHUB_STEP_SUMMARY)/i);
  assert.match(workflow, /Production database accessed: NO/);
});
