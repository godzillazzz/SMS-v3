'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateCfg03Sql,
  validateMigrationManifest
} = require('../scripts/ci/verify-approved-production-migration');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, '.github', 'releases', 'approved-cfg03-production-migration.json');
const workflowPath = path.join(root, '.github', 'workflows', 'apply-approved-production-migration-v2.yml');
const postVerifyPath = path.join(root, 'scripts', 'ci', 'verify-cfg03-production-migration.js');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const postVerify = fs.readFileSync(postVerifyPath, 'utf8');

test('CFG-03 Production migration manifest is exact-source pinned and migration-only', () => {
  const result = validateMigrationManifest(manifest, { root });
  assert.equal(result.migrationId, 'CFG-03');
  assert.equal(result.sourceCommitSha, '91a4342a1d3c14753b6b1fdb0c3ddfb5b5833916');
  assert.equal(result.sourceTreeSha, 'd38c399f89fe4746b57cdf44199bb50a42a28bc8');
  assert.equal(result.currentProductionDeploymentId, 'dpl_Aeh7KSFP4T4SR52AmXTiGSoeGSCp');
  assert.equal(result.currentProductionApplicationSha, '4a98548b1c3962e1e7f7095fd968ddc3e6a555f9');
  assert.equal(result.migrationName, '202608310001_cfg03_leave_type_master');
  assert.equal(result.migrationPolicy, 'ADDITIVE_SCHEMA_WITH_CONTROLLED_BACKFILL');
  assert.equal(result.dataBackfill, true);
  assert.equal(result.controlledUpdateCount, 2);
  assert.equal(manifest.application_deploy, false);
  assert.equal(manifest.destructive_rollback, false);
  assert.equal(manifest.owner_action, 'APPROVE_PRODUCTION_MIGRATION_ONLY');
});

test('CFG-03 migration SQL policy accepts exact migration and rejects destructive or unbounded mutations', () => {
  const sql = fs.readFileSync(path.join(root, ...manifest.migration_path.split('/')), 'utf8');
  assert.doesNotThrow(() => validateCfg03Sql(sql));

  for (const destructive of [
    sql + '\nDROP TABLE leave_requests;',
    sql + '\nDELETE FROM leave_requests;',
    sql + '\nTRUNCATE leave_requests;',
    sql + '\nALTER TABLE "leave_requests" DROP COLUMN "reason";'
  ]) {
    assert.throws(() => validateCfg03Sql(destructive), /forbidden|unsupported/);
  }

  const unbounded = sql.replace(
    /UPDATE "leave_requests"\s+SET "leave_type_name_snapshot" = "leave_type"\s+WHERE "leave_type_name_snapshot" IS NULL;/,
    'UPDATE "leave_requests" SET "leave_type_name_snapshot" = "leave_type";'
  );
  assert.notEqual(unbounded, sql, 'test fixture must remove the bounded WHERE clause');
  assert.throws(() => validateCfg03Sql(unbounded), /requires WHERE/);
});

test('Production Migration V2 has exactly one protected Owner migration gate and no application deployment command', () => {
  assert.match(workflow, /^name: Apply Approved Production Migration V2$/m);
  assert.match(workflow, /name: Approve Production Migration/);
  assert.match(workflow, /environment:\n\s+name: production-sms-v3-staging/);
  assert.match(workflow, /node scripts\/ci\/verify-deployment-target\.js --verify/);
  assert.match(workflow, /node scripts\/ci\/prisma-migration\.js status --allow-pending/);
  assert.match(workflow, /MIGRATION_STATUS_CLASS=PENDING_MIGRATIONS_ONLY/);
  assert.match(workflow, /MIGRATION_NAME=\$MIGRATION_NAME/);
  assert.match(workflow, /node scripts\/ci\/prisma-migration\.js deploy/);
  assert.match(workflow, /NODE_PATH="\$PWD\/node_modules" node \/tmp\/verify-cfg03-production-migration\.js/);
  assert.doesNotMatch(workflow, /vercel(?:@[^\s]+)?\s+(?:deploy|promote|rollback)|vercel\s+(?:deploy|promote|rollback)/i);
  assert.match(workflow, /Application deployment performed: NO/);
  assert.match(workflow, /Destructive rollback performed: NO/);
  assert.doesNotMatch(workflow, /\\\\\$\{\{/);
  assert.match(workflow, /source_sha: \$\{\{ steps\.manifest\.outputs\.source_commit_sha \}\}/);
});

test('Production Migration V2 requires exact Prisma delta and successful exact-SHA CI before Owner gate', () => {
  assert.match(workflow, /git diff --name-only "\$CURRENT_PRODUCTION_APPLICATION_SHA" "\$SOURCE_SHA" -- prisma\/schema\.prisma prisma\/migrations/);
  assert.match(workflow, /expected_prisma=\$\(printf '%s\\n%s\\n' "\$MIGRATION_PATH" 'prisma\/schema\.prisma'/);
  assert.match(workflow, /gh run list --repo "\$GITHUB_REPOSITORY" --workflow CI --commit "\$SOURCE_SHA"/);
  assert.match(workflow, /git merge-base --is-ancestor "\$CURRENT_PRODUCTION_APPLICATION_SHA" "\$SOURCE_SHA"/);
});

test('CFG-03 post-migration verifier checks Thai core master, snapshots, FK and indexes without raw leave output', () => {
  assert.match(postVerify, /\['SICK', \['ลาป่วย', 'SICK'\]\]/);
  assert.match(postVerify, /\['PERSONAL', \['ลากิจ', 'PERSONAL'\]\]/);
  assert.match(postVerify, /\['VACATION', \['ลาพักร้อน', 'VACATION'\]\]/);
  assert.match(postVerify, /leave_type_name_snapshot IS NULL/);
  assert.match(postVerify, /leave_requests_leave_type_id_fkey/);
  assert.match(postVerify, /leave_requests_leave_type_id_idx/);
  assert.match(postVerify, /RAW_LEAVE_DATA_EMITTED=false/);
  assert.doesNotMatch(postVerify, /console\.log\([^)]*employee|console\.log\([^)]*leaveRequest/i);
});
