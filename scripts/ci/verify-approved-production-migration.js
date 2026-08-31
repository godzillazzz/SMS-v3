'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXPECTED = Object.freeze({
  schemaVersion: 1,
  manifestState: 'APPROVED_FOR_OWNER_PRODUCTION_MIGRATION_DECISION',
  targetEnvironment: 'production',
  targetProjectName: 'sms-v3-staging',
  targetProjectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  targetOrgId: 'team_nemCExHbZ8EAhSgsvefHPAEz',
  canonicalUrl: 'https://sms-v3-staging-ten.vercel.app',
  ownerAction: 'APPROVE_PRODUCTION_MIGRATION_ONLY'
});

const MIGRATIONS = Object.freeze({
  'CFG-03': Object.freeze({
    migrationName: '202608310001_cfg03_leave_type_master',
    migrationPolicy: 'ADDITIVE_SCHEMA_WITH_CONTROLLED_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-cfg03-production-migration.js',
    dataBackfill: true
  }),
  'CFG-04': Object.freeze({
    migrationName: '202608310002_cfg04_shift_type_active_state',
    migrationPolicy: 'ADDITIVE_SCHEMA_ONLY_NO_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-cfg04-production-migration.js',
    dataBackfill: false
  }),
  'CFG-05': Object.freeze({
    migrationName: '202608310003_cfg05_auto_schedule_pattern_master',
    migrationPolicy: 'ADDITIVE_SCHEMA_WITH_GOVERNED_SEED_NO_BACKFILL',
    postVerifyScript: 'scripts/ci/verify-cfg05-production-migration.js',
    dataBackfill: false
  })
});

const SHA = /^[0-9a-f]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const MIGRATION_NAME = /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_SCRIPT = /^scripts\/ci\/verify-[a-z0-9-]+-production-migration\.js$/;

function assert(condition, message) {
  if (!condition) throw new Error(`production migration guard: ${message}`);
}

function splitStatements(sql) {
  return String(sql || '')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function rejectDestructiveSql(sql) {
  assert(!/\bDROP\b/i.test(sql), 'DROP is forbidden');
  assert(!/\bDELETE\s+FROM\b/i.test(sql), 'DELETE is forbidden');
  assert(!/\bTRUNCATE\b/i.test(sql), 'TRUNCATE is forbidden');
}

function validateCfg03Sql(sql) {
  rejectDestructiveSql(sql);
  const statements = splitStatements(sql);
  assert(statements.length >= 8, 'unexpectedly small migration');
  let updateCount = 0;

  for (const statement of statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    if (/^CREATE TABLE "leave_type_master"/i.test(normalized)) continue;
    if (/^CREATE (?:UNIQUE )?INDEX /i.test(normalized)) {
      assert(/ ON "(?:leave_type_master|leave_requests)"/i.test(normalized), 'index targets unexpected table');
      continue;
    }
    if (/^ALTER TABLE "leave_requests"/i.test(normalized)) {
      assert(!/\bDROP\b/i.test(normalized), 'ALTER DROP is forbidden');
      assert(/\bADD (?:COLUMN|CONSTRAINT)\b/i.test(normalized), 'only ADD COLUMN/CONSTRAINT is allowed');
      continue;
    }
    if (/^INSERT INTO "leave_type_master"/i.test(normalized)) continue;
    if (/^UPDATE "leave_requests"(?: AS [A-Za-z_][A-Za-z0-9_]*)?/i.test(normalized)) {
      updateCount += 1;
      assert(/\bWHERE\b/i.test(normalized), 'controlled backfill UPDATE requires WHERE');
      continue;
    }
    throw new Error(`production migration guard: unsupported SQL statement: ${normalized.slice(0, 80)}`);
  }

  assert(updateCount === 2, 'CFG-03 requires exactly two controlled leave_requests backfill UPDATE statements');
  assert(/\('SICK',\s*'ลาป่วย',\s*'SICK'/i.test(sql), 'SICK Thai core seed missing');
  assert(/\('PERSONAL',\s*'ลากิจ',\s*'PERSONAL'/i.test(sql), 'PERSONAL Thai core seed missing');
  assert(/\('VACATION',\s*'ลาพักร้อน',\s*'VACATION'/i.test(sql), 'VACATION Thai core seed missing');
  for (const column of ['leave_type_id', 'leave_type_name_snapshot', 'leave_quota_bucket_snapshot']) {
    assert(new RegExp(`"${column}"`, 'i').test(sql), `missing ${column}`);
  }
  assert(/leave_requests_leave_type_id_fkey/i.test(sql), 'leave type FK missing');
  assert(/leave_requests_leave_type_id_idx/i.test(sql), 'leave type index missing');
  return { statementCount: statements.length, controlledUpdateCount: updateCount };
}

function validateCfg04Sql(sql) {
  rejectDestructiveSql(sql);
  assert(!/\bUPDATE\b/i.test(sql), 'CFG-04 UPDATE is forbidden');
  assert(!/\bINSERT\b/i.test(sql), 'CFG-04 INSERT is forbidden');
  const statements = splitStatements(sql);
  assert(statements.length === 1, 'CFG-04 requires exactly one schema statement');
  const normalized = statements[0].replace(/\s+/g, ' ').trim();
  assert(
    /^ALTER TABLE "shift_types" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true$/i.test(normalized),
    'CFG-04 migration must only add shift_types.is_active BOOLEAN NOT NULL DEFAULT true'
  );
  return { statementCount: 1, controlledUpdateCount: 0 };
}

function validateCfg05Sql(sql) {
  rejectDestructiveSql(sql);
  assert(!/\bUPDATE\b/i.test(sql), 'CFG-05 UPDATE is forbidden');
  assert(!/\bALTER\s+TABLE\b/i.test(sql), 'CFG-05 ALTER TABLE is forbidden');
  const statements = splitStatements(sql);
  assert(statements.length === 5, 'CFG-05 requires exactly five create/index/seed statements');

  let tableCount = 0;
  let indexCount = 0;
  let insertCount = 0;
  for (const statement of statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim();
    if (/^CREATE TABLE "auto_schedule_patterns"/i.test(normalized)) {
      tableCount += 1;
      for (const column of ['id', 'code', 'name', 'mode', 'steps', 'is_active', 'is_system', 'target_group', 'sort_order', 'created_at', 'updated_at']) {
        assert(new RegExp(`"${column}"`, 'i').test(normalized), `CFG-05 missing ${column}`);
      }
      assert(/"steps" JSONB NOT NULL/i.test(normalized), 'CFG-05 steps must be JSONB NOT NULL');
      assert(/"is_active" BOOLEAN NOT NULL DEFAULT true/i.test(normalized), 'CFG-05 is_active invariant mismatch');
      assert(/"is_system" BOOLEAN NOT NULL DEFAULT false/i.test(normalized), 'CFG-05 is_system invariant mismatch');
      continue;
    }
    if (/^CREATE (?:UNIQUE )?INDEX /i.test(normalized)) {
      indexCount += 1;
      assert(/ ON "auto_schedule_patterns"/i.test(normalized), 'CFG-05 index targets unexpected table');
      continue;
    }
    if (/^INSERT INTO "auto_schedule_patterns"/i.test(normalized)) {
      insertCount += 1;
      assert(/'SUPERVISOR'/i.test(normalized), 'CFG-05 SUPERVISOR seed missing');
      assert(/'ROTATE'/i.test(normalized), 'CFG-05 ROTATE seed missing');
      assert(/'WEEKLY'/i.test(normalized), 'CFG-05 WEEKLY mode missing');
      assert(/'CYCLE'/i.test(normalized), 'CFG-05 CYCLE mode missing');
      assert(/'GENERAL'/i.test(normalized), 'CFG-05 GENERAL target missing');
      assert(/::jsonb/i.test(normalized), 'CFG-05 steps must seed JSONB');
      assert(!/"shiftCode":"AL"/i.test(normalized), 'CFG-05 core seed must not embed AL');
      continue;
    }
    throw new Error(`production migration guard: unsupported CFG-05 SQL statement: ${normalized.slice(0, 80)}`);
  }

  assert(tableCount === 1, 'CFG-05 requires one table create');
  assert(indexCount === 3, 'CFG-05 requires exactly three explicit indexes');
  assert(insertCount === 1, 'CFG-05 requires one governed core seed insert');
  return { statementCount: statements.length, controlledUpdateCount: 0 };
}

function validateSqlForMigration(migrationId, sql) {
  if (migrationId === 'CFG-03') return validateCfg03Sql(sql);
  if (migrationId === 'CFG-04') return validateCfg04Sql(sql);
  if (migrationId === 'CFG-05') return validateCfg05Sql(sql);
  throw new Error(`production migration guard: unsupported migration_id: ${migrationId}`);
}

function validateMigrationManifest(input, { root = process.cwd(), verifySql = true } = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'manifest must be an object');
  assert(input.schema_version === EXPECTED.schemaVersion, 'unsupported schema_version');
  assert(input.manifest_state === EXPECTED.manifestState, 'manifest_state mismatch');
  const profile = MIGRATIONS[input.migration_id];
  assert(profile, 'unsupported migration_id');
  assert(SHA.test(input.source_commit_sha || ''), 'invalid source_commit_sha');
  assert(SHA.test(input.source_tree_sha || ''), 'invalid source_tree_sha');
  assert(MIGRATION_NAME.test(input.migration_name || ''), 'invalid migration_name');
  assert(input.migration_name === profile.migrationName, 'unexpected migration_name');
  assert(input.migration_path === `prisma/migrations/${input.migration_name}/migration.sql`, 'migration_path mismatch');
  assert(input.migration_policy === profile.migrationPolicy, 'migration_policy mismatch');
  assert(SAFE_SCRIPT.test(input.post_verify_script || ''), 'invalid post_verify_script');
  assert(input.post_verify_script === profile.postVerifyScript, 'unexpected post_verify_script');
  assert(DEPLOYMENT.test(input.current_production_deployment_id || ''), 'invalid current_production_deployment_id');
  assert(SHA.test(input.current_production_application_sha || ''), 'invalid current_production_application_sha');
  assert(input.target_environment === EXPECTED.targetEnvironment, 'target_environment mismatch');
  assert(input.target_project_name === EXPECTED.targetProjectName, 'target_project_name mismatch');
  assert(input.target_project_id === EXPECTED.targetProjectId, 'target_project_id mismatch');
  assert(input.target_org_id === EXPECTED.targetOrgId, 'target_org_id mismatch');
  assert(input.canonical_url === EXPECTED.canonicalUrl, 'canonical_url mismatch');
  assert(input.owner_action === EXPECTED.ownerAction, 'owner_action mismatch');
  assert(input.data_backfill === profile.dataBackfill, 'data_backfill mismatch');
  assert(input.application_deploy === false, 'application_deploy must be false');
  assert(input.destructive_rollback === false, 'destructive_rollback must be false');

  let sqlStats = { statementCount: 0, controlledUpdateCount: 0 };
  if (verifySql) {
    const migrationFile = path.join(root, ...input.migration_path.split('/'));
    assert(fs.existsSync(migrationFile), 'migration SQL file missing');
    sqlStats = validateSqlForMigration(input.migration_id, fs.readFileSync(migrationFile, 'utf8'));
    const verifierFile = path.join(root, ...input.post_verify_script.split('/'));
    assert(fs.existsSync(verifierFile), 'post verify script missing');
  }

  return Object.freeze({
    migrationId: input.migration_id,
    sourceCommitSha: input.source_commit_sha,
    sourceTreeSha: input.source_tree_sha,
    migrationName: input.migration_name,
    migrationPath: input.migration_path,
    migrationPolicy: input.migration_policy,
    postVerifyScript: input.post_verify_script,
    currentProductionDeploymentId: input.current_production_deployment_id,
    currentProductionApplicationSha: input.current_production_application_sha,
    targetProjectName: input.target_project_name,
    targetProjectId: input.target_project_id,
    targetOrgId: input.target_org_id,
    canonicalUrl: input.canonical_url,
    dataBackfill: input.data_backfill,
    statementCount: sqlStats.statementCount,
    controlledUpdateCount: sqlStats.controlledUpdateCount
  });
}

function outputLines(result) {
  return [
    'PRODUCTION_MIGRATION_MANIFEST_GUARD=PASS',
    `migration_id=${result.migrationId}`,
    `source_commit_sha=${result.sourceCommitSha}`,
    `source_tree_sha=${result.sourceTreeSha}`,
    `migration_name=${result.migrationName}`,
    `migration_path=${result.migrationPath}`,
    `migration_policy=${result.migrationPolicy}`,
    `post_verify_script=${result.postVerifyScript}`,
    `current_production_deployment_id=${result.currentProductionDeploymentId}`,
    `current_production_application_sha=${result.currentProductionApplicationSha}`,
    `target_project_name=${result.targetProjectName}`,
    `target_project_id=${result.targetProjectId}`,
    `target_org_id=${result.targetOrgId}`,
    `canonical_url=${result.canonicalUrl}`,
    `data_backfill=${result.dataBackfill}`,
    `sql_statement_count=${result.statementCount}`,
    `controlled_update_count=${result.controlledUpdateCount}`
  ];
}

function main() {
  const file = process.argv[2];
  assert(file, 'manifest path is required');
  const result = validateMigrationManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
  process.stdout.write(`${outputLines(result).join('\n')}\n`);
}

if (require.main === module) main();

module.exports = {
  EXPECTED,
  MIGRATIONS,
  outputLines,
  splitStatements,
  validateCfg03Sql,
  validateCfg04Sql,
  validateCfg05Sql,
  validateSqlForMigration,
  validateMigrationManifest
};
