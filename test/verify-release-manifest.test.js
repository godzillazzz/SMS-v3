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

test('current approved Production manifest releases the approved offline hotfix with unchanged schema and no release-time DB mutation', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.github', 'releases', 'approved-production.json'), 'utf8'));
  const result = validateReleaseManifest(manifest);
  assert.equal(result.releaseId, 'sms-v3-prod-8bae84a-20261004');
  assert.equal(result.commitSha, '8bae84a50e8cd2c3d96ba2393a8004ea4abaafeb');
  assert.equal(result.treeSha, 'e125272c8ab6f934d973212b444a8a918887854a');
  assert.equal(result.currentProductionSourceSha, '500aaa53d60d6835cccec16c79ca25de00ab06c6');
  assert.equal(result.currentProductionSourceRef, 'fix/serverless-database-reliability');
  assert.equal(result.rollbackDeploymentId, 'dpl_7ARdP3yKSMyXbsoFhput84BPrTrh');
  assert.equal(result.runMigrations, false);
  assert.equal(result.databaseChangePolicy, 'NO_DATABASE_CHANGES');
  assert.equal(result.preAppliedMigrationManifestPath, '');
  assert.equal(result.preAppliedMigrationEvidenceRunId, '');
  assert.equal(result.productionEnvironmentChangePolicy, 'NO_ENVIRONMENT_CHANGES');
  assert.equal(result.corsPolicy, 'EXPLICIT_CREDENTIALED_ALLOWLIST_CANONICAL_RUNTIME_VERIFY');
  assert.equal(result.deploymentMethod, 'GOVERNED_VERCEL_GIT_SOURCE_PRODUCTION_CANDIDATE_NO_CANONICAL_ALIAS_EXPLICIT_PROMOTION');
  assert.equal(manifest.preview_deployment_id, 'dpl_2xFdnF9oadjZL2qZFdrJRvmE7Xgk');
  assert.equal(manifest.preview_url, 'https://sms-v3-staging-i55i25u0t-godzillazz.vercel.app');
  assert.equal(manifest.application_pr_number, 439);
  assert.equal(manifest.application_pr_merge_sha, result.commitSha);
  assert.equal(manifest.application_exact_sha_ci_run_id, 37183292547);
  assert.equal(manifest.support_site_selection, 'ASSIGNED_SITE_MATCH_WINS_OTHER_ACTIVE_REGISTERED_SITE_BY_NORMALIZED_DISTANCE_THEN_STABLE_SITE_ID_CODE_TIE_BREAK');
  assert.equal(manifest.db_schema_mutation, 'NONE');
  assert.equal(manifest.db_data_mutation, 'NONE');
  assert.equal(manifest.performance_status, 'NOT_EVALUATED_SCOPE_LIMITED_RELEASE');
  assert.equal(manifest.global_performance_regression, 'NOT_EVALUATED');
  assert.equal(manifest.custom_preview_cors_preflight, 'VERIFIED_ON_EXACT_MERGED_APPLICATION_PREVIEW');
  assert.equal(manifest.linux_node22_artifact_guard, 'PASS');
  assert.equal(manifest.serverless_concurrency_guard, 'PASS');
  assert.match(manifest.attendance_security_change, /SUPPORT_SITE/);
  assert.equal(manifest.g06_changed, "OFFLINE_SYNC_REFRESHES_SERVER_AUTHORITATIVE_NEXT_ACTION;ACKNOWLEDGED_REFRESH_FAILURE_RETAINS_CAPTURE_DISABLES_PUNCH;SERIALIZED_SYNC");
  assert.match(manifest.g06_functional_contract, /SUPPORT_SITE_ONLY_INSIDE_ACTIVE_REGISTERED_SITE/);
  assert.equal(manifest.integrity_signal_policy, 'BEST_EFFORT_ADVISORY_ONLY_NO_ROOT_OR_JAILBREAK_DETECTION_GUARANTEE');
  assert.equal(manifest.face_qr_policy, 'INTENTIONALLY_REMOVED_FROM_NORMAL_ATTENDANCE');
  assert.equal(manifest.release_risk_domain, 'ATTENDANCE_TIME_POLICY_DEVICE_OFFLINE_SUPPORT_SITE_GPS');
  assert.equal(manifest.main_runtime_risk, "OFFLINE_SYNC_REFRESH_FAILURE_IDEMPOTENT_RETRY_AND_NEXT_ACTION");
  assert.equal(manifest.g06_physical_acceptance, "OPEN_REAL_IPHONE_ASSIGNED_SUPPORT_ALLOWED_LATE_CHECKOUT");
  assert.equal(manifest.production_env_preparation, 'NO_ENVIRONMENT_CHANGE; EXISTING_PRODUCTION_ENVIRONMENT_UNMODIFIED');
  assert.equal(manifest.g07, 'EXCLUDED');
  assert.doesNotMatch(JSON.stringify(manifest), /dpl_64ar5GLQnBpGZPPUmoEFuGpE8evd|1504ab15b5937ab2906727e858ea65f82803ac23|43a303d91f7287f49bb3381e0287a117449aec51/);
});

