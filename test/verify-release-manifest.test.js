const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateReleaseManifest } = require('../scripts/ci/verify-release-manifest');

function validManifest() {
  return {
    schema_version: 1,
    release_id: 'sms-v3-prod-86a495a-20260830',
    manifest_state: 'APPROVED_FOR_OWNER_PRODUCTION_DECISION',
    commit_sha: '86a495a60e989ff25e08cf5d204ba5ad6e7e064c',
    tree_sha: 'ccf7e9858b5a52dcd2be61a05f5bc2d4bcfaf6e1',
    current_production_source_sha: '7b9757facdea9934b63417fe955cbec418151d05',
    current_production_source_ref: 'fix/serverless-database-reliability',
    rollback_deployment_id: 'dpl_DzkK9oq8s2VmURATc2HLDMWRUSS5',
    target_project_name: 'sms-v3-staging',
    target_project_id: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
    target_org_id: 'team_nemCExHbZ8EAhSgsvefHPAEz',
    target_environment: 'production',
    canonical_url: 'https://sms-v3-staging-ten.vercel.app',
    source_branch: 'fix/serverless-database-reliability',
    run_migrations: false,
    owner_action: 'APPROVE_PRODUCTION_ONLY',
    rollback_policy: 'AUTO_ROLLBACK_ON_POST_DEPLOY_VERIFY_FAILURE',
    database_change_policy: 'NO_DATABASE_CHANGES',
    production_environment_change_policy: 'NO_ENVIRONMENT_CHANGES',
    cors_policy: 'EXPLICIT_CREDENTIALED_ALLOWLIST_CANONICAL_RUNTIME_VERIFY',
    deployment_method: 'GOVERNED_VERCEL_GIT_SOURCE_PRODUCTION_CANDIDATE_NO_CANONICAL_ALIAS_EXPLICIT_PROMOTION',
    post_deploy_verification_plan: 'IMMUTABLE_CANDIDATE_AND_CANONICAL_HEALTH_READY_AUTH_CORS_RECURSIVE_UI_SENTINELS_AUTO_ROLLBACK',
  };
}

test('accepts the exact approved production release manifest shape', () => {
  const result = validateReleaseManifest(validManifest());
  assert.equal(result.commitSha, '86a495a60e989ff25e08cf5d204ba5ad6e7e064c');
  assert.equal(result.runMigrations, false);
  assert.equal(result.databaseChangePolicy, 'NO_DATABASE_CHANGES');
});

test('accepts a pre-applied approved migration evidence reference without authorizing migration execution', () => {
  const manifest = validManifest();
  manifest.database_change_policy = 'PRE_APPLIED_APPROVED_MIGRATION';
  manifest.pre_applied_migration_manifest_path = '.github/releases/approved-perf05-production-migration.json';
  manifest.pre_applied_migration_evidence_run_id = 33314281801;
  const result = validateReleaseManifest(manifest);
  assert.equal(result.runMigrations, false);
  assert.equal(result.preAppliedMigrationManifestPath, '.github/releases/approved-perf05-production-migration.json');
  assert.equal(result.preAppliedMigrationEvidenceRunId, 33314281801);
});

test('fails closed when exact tree identity is malformed', () => {
  const manifest = validManifest();
  manifest.tree_sha = 'not-a-tree';
  assert.throws(() => validateReleaseManifest(manifest), /invalid tree_sha/);
});

test('fails closed when target environment is not production', () => {
  const manifest = validManifest();
  manifest.target_environment = 'preview';
  assert.throws(() => validateReleaseManifest(manifest), /target_environment mismatch/);
});

test('fails closed when migration execution is requested by an unsupported manifest', () => {
  const manifest = validManifest();
  manifest.run_migrations = true;
  assert.throws(() => validateReleaseManifest(manifest), /run_migrations must be false/);
});

test('fails closed when rollback safety policy is weakened', () => {
  const manifest = validManifest();
  manifest.rollback_policy = 'MANUAL';
  assert.throws(() => validateReleaseManifest(manifest), /rollback_policy mismatch/);
});

test('fails closed when rollback source ref does not match the canonical checkpoint', () => {
  const manifest = validManifest();
  manifest.current_production_source_ref = 'some-other-branch';
  assert.throws(() => validateReleaseManifest(manifest), /current_production_source_ref mismatch/);
});

test('fails closed when the manifest permits a Production environment mutation', () => {
  const manifest = validManifest();
  manifest.production_environment_change_policy = 'ENVIRONMENT_CHANGE_ALLOWED';
  assert.throws(() => validateReleaseManifest(manifest), /production_environment_change_policy mismatch/);
});

test('fails closed when a CORS policy or deployment verification plan is changed', () => {
  const manifest = validManifest();
  manifest.cors_policy = 'WILDCARD';
  assert.throws(() => validateReleaseManifest(manifest), /cors_policy mismatch/);

  manifest.cors_policy = 'EXPLICIT_CREDENTIALED_ALLOWLIST_CANONICAL_RUNTIME_VERIFY';
  manifest.post_deploy_verification_plan = 'SKIP';
  assert.throws(() => validateReleaseManifest(manifest), /post_deploy_verification_plan mismatch/);
});

test('fails closed when a pre-applied migration lacks exact workflow evidence', () => {
  const manifest = validManifest();
  manifest.database_change_policy = 'PRE_APPLIED_APPROVED_MIGRATION';
  manifest.pre_applied_migration_manifest_path = '.github/releases/approved-perf05-production-migration.json';
  assert.throws(() => validateReleaseManifest(manifest), /invalid pre_applied_migration_evidence_run_id/);
});

test('fails closed when pre-applied evidence fields are attached to a no-database-change release', () => {
  const manifest = validManifest();
  manifest.pre_applied_migration_manifest_path = '.github/releases/approved-perf05-production-migration.json';
  manifest.pre_applied_migration_evidence_run_id = 33314281801;
  assert.throws(() => validateReleaseManifest(manifest), /only valid for PRE_APPLIED_APPROVED_MIGRATION/);
});

test('current approved Production manifest pins the exact R5-A Integration release and fresh gates', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.github', 'releases', 'approved-production.json'), 'utf8'));
  const result = validateReleaseManifest(manifest);
  assert.equal(result.releaseId, 'sms-v3-prod-51c5c828689c-20261008');
  assert.equal(result.commitSha, '51c5c828689ce543067c687e204eba7918577bb9');
  assert.equal(result.treeSha, 'f82ae344666a7774d7c5ec78dc113cc2c2ed9e63');
  assert.equal(result.currentProductionSourceSha, '59fb7f9ea4de1ab3403d16f1a750aec01c66de91');
  assert.equal(result.currentProductionSourceRef, 'fix/serverless-database-reliability');
  assert.equal(result.rollbackDeploymentId, 'dpl_J8ss5NqiDZu33QpAc8Bfrt9DvX1x');
  assert.equal(result.runMigrations, false);
  assert.equal(result.databaseChangePolicy, 'NO_DATABASE_CHANGES');
  assert.equal(result.preAppliedMigrationManifestPath, '');
  assert.equal(result.preAppliedMigrationEvidenceRunId, '');
  assert.equal(result.productionEnvironmentChangePolicy, 'NO_ENVIRONMENT_CHANGES');
  assert.equal(result.corsPolicy, 'EXPLICIT_CREDENTIALED_ALLOWLIST_CANONICAL_RUNTIME_VERIFY');
  assert.equal(result.deploymentMethod, 'GOVERNED_VERCEL_GIT_SOURCE_PRODUCTION_CANDIDATE_NO_CANONICAL_ALIAS_EXPLICIT_PROMOTION');
  assert.equal(manifest.preview_deployment_id, 'dpl_8GYCcNwVfGg8AWvv8pBK8xctZqRW');
  assert.equal(manifest.preview_url, 'https://sms-v3-staging-1venkdc5s-godzillazz.vercel.app');
  assert.equal(manifest.application_release_classification, 'MERGED_INTEGRATION_ONLY_NO_OPEN_PR_CODE');
  assert.deepEqual(manifest.application_pr_numbers, [541, 543]);
  assert.deepEqual(manifest.release_control_and_handoff_pr_numbers, [536, 537, 540]);
  assert.deepEqual(manifest.excluded_open_pr_numbers, [530]);
  assert.equal(manifest.application_exact_sha_ci_run_id, 37757672375);
  assert.equal(manifest.release_source_exact_sha_ci_run_id, 37757672375);
  assert.equal(manifest.release_source_ci_result, 'SUCCESS_EXACT_RELEASE_SOURCE_SHA');
  assert.equal(manifest.preview_github_commit_sha, result.commitSha);
  assert.equal(manifest.preview_github_commit_ref, 'fix/serverless-database-reliability');
  assert.equal(manifest.preview_project_id, 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s');
  assert.equal(manifest.preview_state, 'READY');
  assert.equal(manifest.preview_health_status, 'PASS');
  assert.equal(manifest.preview_readiness_database_status, 'PASS');
  assert.equal(manifest.preview_trusted_cors_status, 'PASS');
  assert.equal(manifest.preview_untrusted_cors_status, 'REJECTED_403');
  assert.equal(manifest.preview_technical_smoke_source_sha, result.commitSha);
  assert.equal(manifest.preview_technical_smoke_run_id, 37757879448);
  assert.equal(manifest.preview_technical_smoke_status, 'SUCCESS');
  assert.equal(manifest.preview_technical_smoke_passed, 11);
  assert.equal(manifest.preview_technical_smoke_failed, 0);
  assert.equal(manifest.preview_technical_smoke_skipped, 23);
  assert.equal(manifest.preview_authenticated_role_smoke_status, 'NOT_RUN_SKIPPED_BY_CREDENTIAL_OPTIONAL_WORKFLOW');
  assert.equal(manifest.production_canonical_deployment_id_before_release, 'dpl_J8ss5NqiDZu33QpAc8Bfrt9DvX1x');
  assert.equal(manifest.production_canonical_source_sha_before_release, '59fb7f9ea4de1ab3403d16f1a750aec01c66de91');
  assert.equal(manifest.production_canonical_state_before_release, 'READY');
  assert.equal(manifest.db_schema_mutation, 'NONE');
  assert.equal(manifest.db_data_mutation, 'NONE');
  assert.equal(manifest.production_data_mutation, 'NONE');
  assert.equal(manifest.secret_changes, 'NONE');
  assert.equal(manifest.auth_policy_change, 'NONE');
  assert.equal(manifest.device_binding_change, 'NONE');
  assert.equal(manifest.project_auto_assign_custom_domains, 'VERIFY_FALSE_IN_PROTECTED_WORKFLOW_BEFORE_CANDIDATE');
  assert.equal(manifest.g06_acceptance_status, 'CLOSED');
  assert.equal(manifest.g06_acceptance_changed, 'NO');
  assert.equal(manifest.schedule_large_batch_status, 'APPROVED_FOR_PRODUCTION');
  assert.equal(manifest.schedule_large_batch_postgres_batch_size, 500);
  assert.equal(manifest.schedule_large_batch_business_logic_change, 'NO');
  assert.equal(manifest.schedule_large_batch_atomicity, 'PRESERVED');
  assert.equal(manifest.schedule_large_batch_timeout_increase, 'NO');
  assert.equal(manifest.schedule_large_batch_frontend_chunking, 'NO');
  assert.equal(manifest.production_runtime_verification, 'OFFICIAL_WORKFLOW_HEALTH_READINESS_CORS_ASSET_SENTINELS_AUTO_ROLLBACK');
  assert.ok(!manifest.application_pr_numbers.includes(530));
  assert.ok(!manifest.release_control_and_handoff_pr_numbers.includes(530));
});

test('R5-A readiness retains specific Owner approval and immutable policy boundaries', () => {
  const manifest = JSON.parse(fs.readFileSync('.github/releases/approved-production.json', 'utf8'));
  assert.equal(manifest.release_batch_id, 'R5-A');
  assert.equal(manifest.owner_batch_frozen_sha_approval, 'PENDING_NOT_AUTHORIZED');
  assert.equal(manifest.production_dispatch_authorized, false);
  assert.equal(manifest.preview_runtime_sentinels_status, 'PASS');
  assert.equal(manifest.preview_runtime_sentinels_count, 23);
  assert.equal(manifest.license_reconciliation_policy, 'BANGKOK_TODAY_FUTURE_BLOCK_RESTORE_PAST_IMMUTABLE_APPROVAL_UNCHANGED');
  assert.equal(manifest.deployment_time_data_mutation, 'NONE');
  assert.equal(manifest.css_bundle_budget_bytes, 700000);
  assert.ok(manifest.css_bundle_bytes < manifest.css_bundle_budget_bytes);
  assert.deepEqual(manifest.excluded_uncommitted_tasks, ['T08']);
});
