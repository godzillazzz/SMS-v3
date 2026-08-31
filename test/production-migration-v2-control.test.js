'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateCfg03Sql,
  validateCfg04Sql,
  validateMigrationManifest
} = require('../scripts/ci/verify-approved-production-migration');

const root = path.join(__dirname, '..');
const cfg03ManifestPath = path.join(root, '.github', 'releases', 'approved-cfg03-production-migration.json');
const cfg04ManifestPath = path.join(root, '.github', 'releases', 'approved-cfg04-production-migration.json');
const workflowPath = path.join(root, '.github', 'workflows', 'apply-approved-production-migration-v2.yml');
const cfg03PostVerifyPath = path.join(root, 'scripts', 'ci', 'verify-cfg03-production-migration.js');
const cfg04PostVerifyPath = path.join(root, 'scripts', 'ci', 'verify-cfg04-production-migration.js');
const cfg03Manifest = JSON.parse(fs.readFileSync(cfg03ManifestPath, 'utf8'));
const cfg04Manifest = JSON.parse(fs.readFileSync(cfg04ManifestPath, 'utf8'));
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const cfg03PostVerify = fs.readFileSync(cfg03PostVerifyPath, 'utf8');
const cfg04PostVerify = fs.readFileSync(cfg04PostVerifyPath, 'utf8');

test('CFG-03 historical Production migration manifest remains valid', () => {
  const result = validateMigrationManifest(cfg03Manifest, { root });
  assert.equal(result.migrationId, 'CFG-03');
  assert.equal(result.migrationPolicy, 'ADDITIVE_SCHEMA_WITH_CONTROLLED_BACKFILL');
  assert.equal(result.dataBackfill, true);
  assert.equal(result.controlledUpdateCount, 2);
});

test('CFG-04 Production migration manifest is exact-source pinned and migration-only', () => {
  const result = validateMigrationManifest(cfg04Manifest, { root });
  assert.equal(result.migrationId, 'CFG-04');
  assert.equal(result.sourceCommitSha, '9ff3e32a38440cedef4953f9ac74e46d288cfc25');
  assert.equal(result.sourceTreeSha, '81c09920a5b2fd1231d8d58e76b4761ca0658d09');
  assert.equal(result.currentProductionDeploymentId, 'dpl_zW83EHkX47mz1CJ8k9uDiTCUF2y3');
  assert.equal(result.currentProductionApplicationSha, '91a4342a1d3c14753b6b1fdb0c3ddfb5b5833916');
  assert.equal(result.migrationName, '202608310002_cfg04_shift_type_active_state');
  assert.equal(result.migrationPolicy, 'ADDITIVE_SCHEMA_ONLY_NO_BACKFILL');
  assert.equal(result.dataBackfill, false);
  assert.equal(result.statementCount, 1);
  assert.equal(result.controlledUpdateCount, 0);
  assert.equal(cfg04Manifest.application_deploy, false);
  assert.equal(cfg04Manifest.destructive_rollback, false);
  assert.equal(cfg04Manifest.owner_action, 'APPROVE_PRODUCTION_MIGRATION_ONLY');
});

test('CFG-04 SQL policy accepts exact additive schema and rejects mutations or extra statements', () => {
  const sql = fs.readFileSync(path.join(root, ...cfg04Manifest.migration_path.split('/')), 'utf8');
  assert.doesNotThrow(() => validateCfg04Sql(sql));
  for (const unsafe of [
    sql + '\nUPDATE shift_types SET is_active = true;',
    sql + '\nINSERT INTO shift_types (code, name, hours) VALUES (\'X\', \'X\', 0);',
    sql + '\nDROP TABLE shift_types;',
    sql + '\nDELETE FROM shift_types;',
    sql + '\nTRUNCATE shift_types;',
    sql.replace('DEFAULT true', 'DEFAULT false')
  ]) {
    assert.throws(() => validateCfg04Sql(unsafe), /forbidden|requires exactly one|must only add/);
  }
});

test('CFG-03 SQL guard still rejects destructive or unbounded mutations', () => {
  const sql = fs.readFileSync(path.join(root, ...cfg03Manifest.migration_path.split('/')), 'utf8');
  assert.doesNotThrow(() => validateCfg03Sql(sql));
  assert.throws(() => validateCfg03Sql(sql + '\nDROP TABLE leave_requests;'), /forbidden|unsupported/);
});

test('Production Migration V2 targets CFG-04 with one protected Owner gate and no application deployment command', () => {
  assert.match(workflow, /^name: Apply Approved Production Migration V2$/m);
  assert.match(workflow, /MANIFEST_PATH: \.github\/releases\/approved-cfg04-production-migration\.json/);
  assert.match(workflow, /name: Approve Production Migration/);
  assert.match(workflow, /environment:\n\s+name: production-sms-v3-staging/);
  assert.match(workflow, /node scripts\/ci\/verify-deployment-target\.js --verify/);
  assert.match(workflow, /node scripts\/ci\/prisma-migration\.js status --allow-pending/);
  assert.match(workflow, /MIGRATION_STATUS_CLASS=PENDING_MIGRATIONS_ONLY/);
  assert.match(workflow, /MIGRATION_NAME=\$MIGRATION_NAME/);
  assert.match(workflow, /validateSqlForMigration\(result\.migrationId/);
  assert.match(workflow, /node scripts\/ci\/prisma-migration\.js deploy/);
  assert.match(workflow, /NODE_PATH="\$PWD\/node_modules" node \/tmp\/post-verify-production-migration\.js/);
  assert.doesNotMatch(workflow, /vercel(?:@[^\s]+)?\s+(?:deploy|promote|rollback)|vercel\s+(?:deploy|promote|rollback)/i);
  assert.match(workflow, /Application deployment performed: NO/);
  assert.match(workflow, /Destructive rollback performed: NO/);
  assert.match(workflow, /Historical data backfill: NO/);
});

test('Production Migration V2 requires exact Prisma delta and successful exact-SHA CI before Owner gate', () => {
  assert.match(workflow, /git diff --name-only "\$CURRENT_PRODUCTION_APPLICATION_SHA" "\$SOURCE_SHA" -- prisma\/schema\.prisma prisma\/migrations/);
  assert.match(workflow, /expected_prisma=\$\(printf '%s\\n%s\\n' "\$MIGRATION_PATH" 'prisma\/schema\.prisma'/);
  assert.match(workflow, /gh run list --repo "\$GITHUB_REPOSITORY" --workflow CI --commit "\$SOURCE_SHA"/);
  assert.match(workflow, /git merge-base --is-ancestor "\$CURRENT_PRODUCTION_APPLICATION_SHA" "\$SOURCE_SHA"/);
});

test('CFG-04 post-migration verifier checks only schema invariants and emits no Shift Type rows', () => {
  assert.match(cfg04PostVerify, /table_name='shift_types' AND column_name='is_active'/);
  assert.match(cfg04PostVerify, /data_type !== 'boolean'/);
  assert.match(cfg04PostVerify, /is_nullable !== 'NO'/);
  assert.match(cfg04PostVerify, /column_default/);
  assert.match(cfg04PostVerify, /WHERE is_active IS NULL/);
  assert.match(cfg04PostVerify, /RAW_SHIFT_DATA_EMITTED=false/);
  assert.doesNotMatch(cfg04PostVerify, /SELECT \* FROM shift_types|console\.log\([^)]*row/i);
});

test('CFG-03 post-migration verifier remains available for prior evidence validation', () => {
  assert.match(cfg03PostVerify, /CFG03_PRODUCTION_MIGRATION_VERIFY=PASS/);
  assert.match(cfg03PostVerify, /RAW_LEAVE_DATA_EMITTED=false/);
});
