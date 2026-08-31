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
  ownerAction: 'APPROVE_PRODUCTION_MIGRATION_ONLY',
  migrationPolicy: 'ADDITIVE_SCHEMA_WITH_CONTROLLED_BACKFILL'
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

function validateCfg03Sql(sql) {
  assert(!/\bDROP\b/i.test(sql), 'DROP is forbidden');
  assert(!/\bDELETE\s+FROM\b/i.test(sql), 'DELETE is forbidden');
  assert(!/\bTRUNCATE\b/i.test(sql), 'TRUNCATE is forbidden');

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

function validateMigrationManifest(input, { root = process.cwd(), verifySql = true } = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'manifest must be an object');
  assert(input.schema_version === EXPECTED.schemaVersion, 'unsupported schema_version');
  assert(input.manifest_state === EXPECTED.manifestState, 'manifest_state mismatch');
  assert(input.migration_id === 'CFG-03', 'unsupported migration_id');
  assert(SHA.test(input.source_commit_sha || ''), 'invalid source_commit_sha');
  assert(SHA.test(input.source_tree_sha || ''), 'invalid source_tree_sha');
  assert(MIGRATION_NAME.test(input.migration_name || ''), 'invalid migration_name');
  assert(input.migration_name === '202608310001_cfg03_leave_type_master', 'unexpected migration_name');
  assert(input.migration_path === `prisma/migrations/${input.migration_name}/migration.sql`, 'migration_path mismatch');
  assert(input.migration_policy === EXPECTED.migrationPolicy, 'migration_policy mismatch');
  assert(SAFE_SCRIPT.test(input.post_verify_script || ''), 'invalid post_verify_script');
  assert(input.post_verify_script === 'scripts/ci/verify-cfg03-production-migration.js', 'unexpected post_verify_script');
  assert(DEPLOYMENT.test(input.current_production_deployment_id || ''), 'invalid current_production_deployment_id');
  assert(SHA.test(input.current_production_application_sha || ''), 'invalid current_production_application_sha');
  assert(input.target_environment === EXPECTED.targetEnvironment, 'target_environment mismatch');
  assert(input.target_project_name === EXPECTED.targetProjectName, 'target_project_name mismatch');
  assert(input.target_project_id === EXPECTED.targetProjectId, 'target_project_id mismatch');
  assert(input.target_org_id === EXPECTED.targetOrgId, 'target_org_id mismatch');
  assert(input.canonical_url === EXPECTED.canonicalUrl, 'canonical_url mismatch');
  assert(input.owner_action === EXPECTED.ownerAction, 'owner_action mismatch');
  assert(input.data_backfill === true, 'data_backfill must be true');
  assert(input.application_deploy === false, 'application_deploy must be false');
  assert(input.destructive_rollback === false, 'destructive_rollback must be false');

  let sqlStats = { statementCount: 0, controlledUpdateCount: 0 };
  if (verifySql) {
    const migrationFile = path.join(root, ...input.migration_path.split('/'));
    assert(fs.existsSync(migrationFile), 'migration SQL file missing');
    sqlStats = validateCfg03Sql(fs.readFileSync(migrationFile, 'utf8'));
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

module.exports = { EXPECTED, outputLines, splitStatements, validateCfg03Sql, validateMigrationManifest };
