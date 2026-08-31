'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateCfg03Sql,
  validateCfg04Sql,
  validateCfg05Sql,
  validateCfg06Sql,
  validateMigrationManifest
} = require('../scripts/ci/verify-approved-production-migration');

const root = path.join(__dirname, '..');
const cfg03ManifestPath = path.join(root, '.github', 'releases', 'approved-cfg03-production-migration.json');
const cfg04ManifestPath = path.join(root, '.github', 'releases', 'approved-cfg04-production-migration.json');
const cfg05ManifestPath = path.join(root, '.github', 'releases', 'approved-cfg05-production-migration.json');
const cfg06ManifestPath = path.join(root, '.github', 'releases', 'approved-cfg06-production-migration.json');
const workflowPath = path.join(root, '.github', 'workflows', 'apply-approved-production-migration-v2.yml');
const cfg03PostVerifyPath = path.join(root, 'scripts', 'ci', 'verify-cfg03-production-migration.js');
const cfg04PostVerifyPath = path.join(root, 'scripts', 'ci', 'verify-cfg04-production-migration.js');
const cfg05PostVerifyPath = path.join(root, 'scripts', 'ci', 'verify-cfg05-production-migration.js');
const cfg06PostVerifyPath = path.join(root, 'scripts', 'ci', 'verify-cfg06-production-migration.js');
const cfg03Manifest = JSON.parse(fs.readFileSync(cfg03ManifestPath, 'utf8'));
const cfg04Manifest = JSON.parse(fs.readFileSync(cfg04ManifestPath, 'utf8'));
const cfg05Manifest = JSON.parse(fs.readFileSync(cfg05ManifestPath, 'utf8'));
const cfg06Manifest = JSON.parse(fs.readFileSync(cfg06ManifestPath, 'utf8'));
const workflow = fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
const cfg03PostVerify = fs.readFileSync(cfg03PostVerifyPath, 'utf8');
const cfg04PostVerify = fs.readFileSync(cfg04PostVerifyPath, 'utf8');
const cfg05PostVerify = fs.readFileSync(cfg05PostVerifyPath, 'utf8');
const cfg06PostVerify = fs.readFileSync(cfg06PostVerifyPath, 'utf8');

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

test('CFG-05 Production migration manifest is exact-source pinned and migration-only', () => {
  const result = validateMigrationManifest(cfg05Manifest, { root });
  assert.equal(result.migrationId, 'CFG-05');
  assert.equal(result.sourceCommitSha, 'cf75ba61c97ba81084999eea9e68f4dcdcc6178e');
  assert.equal(result.sourceTreeSha, 'b9ae82fd18e2fa55bf5712fe11d56c8c0baf25b6');
  assert.equal(result.currentProductionDeploymentId, 'dpl_99jRWjfLfhZm5X3VrL9RpYeJX59u');
  assert.equal(result.currentProductionApplicationSha, '9ff3e32a38440cedef4953f9ac74e46d288cfc25');
  assert.equal(result.migrationName, '202608310003_cfg05_auto_schedule_pattern_master');
  assert.equal(result.migrationPolicy, 'ADDITIVE_SCHEMA_WITH_GOVERNED_SEED_NO_BACKFILL');
  assert.equal(result.dataBackfill, false);
  assert.equal(result.statementCount, 5);
  assert.equal(result.controlledUpdateCount, 0);
  assert.equal(cfg05Manifest.application_deploy, false);
  assert.equal(cfg05Manifest.destructive_rollback, false);
  assert.equal(cfg05Manifest.owner_action, 'APPROVE_PRODUCTION_MIGRATION_ONLY');
});

test('CFG-05 SQL policy accepts only the additive Pattern Master schema and governed core seed', () => {
  const sql = fs.readFileSync(path.join(root, ...cfg05Manifest.migration_path.split('/')), 'utf8');
  assert.doesNotThrow(() => validateCfg05Sql(sql));
  for (const unsafe of [
    sql + '\nUPDATE auto_schedule_patterns SET is_active = false;',
    sql + '\nALTER TABLE auto_schedule_patterns ADD COLUMN unsafe TEXT;',
    sql + '\nDROP TABLE auto_schedule_patterns;',
    sql + '\nDELETE FROM auto_schedule_patterns;',
    sql + '\nTRUNCATE auto_schedule_patterns;',
    sql.replace('"shiftCode":"D"', '"shiftCode":"AL"')
  ]) {
    assert.throws(() => validateCfg05Sql(unsafe), /forbidden|requires exactly five|must not embed AL|unsupported/);
  }
});

test('CFG-06 Production migration manifest is exact-source pinned and migration-only', () => {
  const result = validateMigrationManifest(cfg06Manifest, { root });
  assert.equal(result.migrationId, 'CFG-06');
  assert.equal(result.sourceCommitSha, 'ca3e4dee868ce88aa2e296312abebd75f25fe240');
  assert.equal(result.sourceTreeSha, '04fc1bcf3b6ce25a1a952f6f629290232bd0d04d');
  assert.equal(result.currentProductionDeploymentId, 'dpl_7ceocSnc9FbhniknqdxWQDRqsjGj');
  assert.equal(result.currentProductionApplicationSha, 'cf75ba61c97ba81084999eea9e68f4dcdcc6178e');
  assert.equal(result.migrationName, '202608310004_cfg06_approval_authority_policy');
  assert.equal(result.migrationPolicy, 'GOVERNED_SYSTEM_SETTING_SEED_ONLY_NO_SCHEMA_CHANGE');
  assert.equal(result.dataBackfill, false);
  assert.equal(result.schemaChanged, false);
  assert.equal(result.statementCount, 1);
  assert.equal(result.controlledUpdateCount, 0);
  assert.equal(cfg06Manifest.application_deploy, false);
  assert.equal(cfg06Manifest.destructive_rollback, false);
  assert.equal(cfg06Manifest.owner_action, 'APPROVE_PRODUCTION_MIGRATION_ONLY');
});

test('CFG-06 SQL policy accepts only governed SystemSetting defaults and rejects schema/data mutation', () => {
  const sql = fs.readFileSync(path.join(root, ...cfg06Manifest.migration_path.split('/')), 'utf8');
  assert.doesNotThrow(() => validateCfg06Sql(sql));
  for (const unsafe of [
    sql + '\nUPDATE system_settings SET value = \'0\';',
    sql + '\nALTER TABLE system_settings ADD COLUMN unsafe TEXT;',
    sql + '\nDROP TABLE system_settings;',
    sql + '\nDELETE FROM system_settings;',
    sql + '\nTRUNCATE system_settings;',
    sql.replace('[\"ADMIN\"]', '[\"MANAGER\"]'),
    sql.replace("'24'", "'72'"),
    sql.replace('ON CONFLICT ("key") DO NOTHING', 'ON CONFLICT ("key") DO UPDATE SET value = EXCLUDED.value')
  ]) {
    assert.throws(() => validateCfg06Sql(unsafe), /forbidden|requires exactly one|must seed|requires ON CONFLICT|mismatch|missing|26 governed/);
  }
});

test('CFG-03 SQL guard still rejects destructive or unbounded mutations', () => {
  const sql = fs.readFileSync(path.join(root, ...cfg03Manifest.migration_path.split('/')), 'utf8');
  assert.doesNotThrow(() => validateCfg03Sql(sql));
  assert.throws(() => validateCfg03Sql(sql + '\nDROP TABLE leave_requests;'), /forbidden|unsupported/);
});

test('Production Migration V2 targets CFG-06 with one protected Owner gate and no application deployment command', () => {
  assert.match(workflow, /^name: Apply Approved Production Migration V2$/m);
  assert.match(workflow, /MANIFEST_PATH: \.github\/releases\/approved-cfg06-production-migration\.json/);
  assert.match(workflow, /prisma_schema_changed: \$\{\{ steps\.manifest\.outputs\.prisma_schema_changed \}\}/);
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
  assert.match(workflow, /if test "\$\{\{ steps\.manifest\.outputs\.prisma_schema_changed \}\}" = "true"/);
  assert.match(workflow, /expected_prisma=\$\(printf '%s\\n%s\\n' "\$MIGRATION_PATH" 'prisma\/schema\.prisma'/);
  assert.match(workflow, /expected_prisma=\$\(printf '%s\\n' "\$MIGRATION_PATH"/);
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

test('CFG-05 post-migration verifier checks schema/core seeds without emitting raw Pattern data', () => {
  assert.match(cfg05PostVerify, /table_name='auto_schedule_patterns'/);
  assert.match(cfg05PostVerify, /autoSchedulePattern\.findMany/);
  assert.match(cfg05PostVerify, /AUTO_SCHEDULE_PATTERN_CORE_SEEDS=2/);
  assert.match(cfg05PostVerify, /AUTO_SCHEDULE_PATTERN_AL_REFERENCES=0/);
  assert.match(cfg05PostVerify, /RAW_AUTO_SCHEDULE_PATTERN_DATA_EMITTED=false/);
  assert.doesNotMatch(cfg05PostVerify, /console\.log\([^)]*steps|SELECT \* FROM auto_schedule_patterns/i);
});

test('CFG-06 post-migration verifier checks governed keys without emitting policy values', () => {
  assert.match(cfg06PostVerify, /CFG06_PRODUCTION_MIGRATION_VERIFY=PASS/);
  assert.match(cfg06PostVerify, /APPROVAL_POLICY_KEY_COUNT=26/);
  assert.match(cfg06PostVerify, /APPROVAL_POLICY_REQUEST_TYPE_COUNT=8/);
  assert.match(cfg06PostVerify, /APPROVAL_POLICY_ADMIN_ONLY_TYPE_COUNT=5/);
  assert.match(cfg06PostVerify, /APPROVAL_POLICY_FLEXIBLE_TYPE_COUNT=3/);
  assert.match(cfg06PostVerify, /APPROVAL_POLICY_RAW_VALUES_EMITTED=false/);
  assert.doesNotMatch(cfg06PostVerify, /console\.log\([^)]*row|console\.log\([^)]*value/i);
});

test('CFG-03 post-migration verifier remains available for prior evidence validation', () => {
  assert.match(cfg03PostVerify, /CFG03_PRODUCTION_MIGRATION_VERIFY=PASS/);
  assert.match(cfg03PostVerify, /RAW_LEAVE_DATA_EMITTED=false/);
});
