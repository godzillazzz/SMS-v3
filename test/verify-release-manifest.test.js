const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

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
    production_dispatch_authorized: false,
    production_release_go_no_go: 'OWNER_PRODUCTION_DECISION_REQUIRED_NO_DISPATCH_AUTHORIZED',
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

test('fails closed when production_release_go_no_go is invalid before Owner authorization', () => {
  const manifest = validManifest();
  manifest.production_release_go_no_go = 'DISPATCHED_AND_VERIFIED_SEE_POST_RELEASE_RECORD';
  assert.throws(() => validateReleaseManifest(manifest), /production_release_go_no_go must be OWNER_PRODUCTION_DECISION_REQUIRED_NO_DISPATCH_AUTHORIZED/);
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
  assert.throws(() => validateReleaseManifest(manifest), /unsupported production_environment_change_policy/);
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

test('archived R5-A Production manifest preserves exact historical Integration release and gates', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.github', 'releases', 'r5-a-production-manifest-archive-20261009.json'), 'utf8'));
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

test('archived R5-A readiness retains historical Owner boundaries', () => {
  const manifest = JSON.parse(fs.readFileSync('.github/releases/r5-a-production-manifest-archive-20261009.json', 'utf8'));
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

test('archived R6 release manifest remains immutable and pinned to the original Production promotion', () => {
  const d = JSON.parse(fs.readFileSync('.github/releases/r6-production-manifest-archive-20261014.json', 'utf8'));
  const validated = validateReleaseManifest(d);
  assert.equal(d.release_batch_id, 'R6');
  assert.equal(validated.commitSha, '09486d684f2af89a1589ebf8dd11cbeb9f79050b');
  assert.equal(validated.treeSha, '6ae6c222dc8e3b3631ce73b7bc70cb2980e29969');
  assert.equal(validated.rollbackDeploymentId, 'dpl_Hjo1fTmgjEdmg5G7fZBX9gssenQP');
  assert.equal(d.production_dispatch_authorized, true); // Historical R6 owner dispatch authorization, NOT R7.
});

test('superseded R7 Production manifest preserves failed-run source and legacy authorization as historical evidence', () => {
  const old = JSON.parse(fs.readFileSync('.github/releases/r7-production-manifest-superseded-failed-20261014.json', 'utf8'));
  const v = validateReleaseManifest(old);
  assert.equal(v.commitSha, '1b30ec935fb2fe3ed15c85d74d15245996bff62c');
  assert.equal(v.treeSha, 'f9cb01e5ff6681bff5491132af27125d61358187');
  assert.equal(old.preview_technical_smoke_run_id, 38513365357);
  assert.equal(old.owner_batch_frozen_sha_approval, 'APPROVED_OWNER_DIRECTIVE_20261014');
  assert.equal(v.rollbackDeploymentId, 'dpl_HbzTEkJnDsyVrRSvMpmVxSQfRCEV');
});

test('R7.1 hotfix manifest preserves exact target, current Production rollback, and manual-only Production controls', () => {
  const d = JSON.parse(fs.readFileSync('.github/releases/r7.1-production-manifest-approved-20261017.json', 'utf8'));
  const v = validateReleaseManifest(d);
  assert.equal(d.release_batch_id, 'R7.1');
  assert.equal(v.releaseId, 'sms-v3-prod-a0250b8-20261017');
  assert.equal(v.commitSha, 'a0250b8b0ca8072104a4d3593012220c4fe2fb84');
  assert.equal(v.treeSha, 'c5470ac280e2c27d1031a794b1159c6b9411e732');
  assert.equal(v.currentProductionSourceSha, 'f30bc45915acb8c87a94d2d8a2d0e90a86d6f16e');
  assert.equal(v.rollbackDeploymentId, 'dpl_9CxiMbXdmBqp6LJG8YHKcVXgL1JN');
  assert.equal(v.runMigrations, false);
  assert.equal(v.databaseChangePolicy, 'NO_DATABASE_CHANGES');
  assert.equal(v.preAppliedMigrationManifestPath, '');
  assert.equal(v.preAppliedMigrationEvidenceRunId, '');
  assert.equal(d.production_canonical_deployment_id_before_release, v.rollbackDeploymentId);
  assert.equal(d.production_canonical_source_sha_before_release, v.currentProductionSourceSha);
  assert.equal(d.production_canonical_state_before_release, 'READY');
  assert.equal(d.preview_github_commit_sha, v.commitSha);
  assert.equal(d.production_environment_change_policy, 'OWNER_APPROVED_REGION_CHANGE_ONLY');
  assert.equal(d.preview_deployment_id, null);
  assert.equal(d.preview_state, 'NOT_VERIFIED_PRE_DISPATCH');
  assert.equal(d.application_exact_sha_ci_run_id, 39035051317);
  assert.equal(d.application_exact_sha_ci_status, 'SUCCESS');
  assert.equal(d.production_dispatch_authorized, false);
  assert.equal(d.production_release_go_no_go, 'OWNER_PRODUCTION_DECISION_REQUIRED_NO_DISPATCH_AUTHORIZED');
  assert.equal(d.release_control_integration_merge_sha, v.commitSha);
  assert.equal(d.release_control_ci_status, 'SUCCESS_EXACT_R7_1_HEAD_CI');
  assert.equal(d.secret_changes, 'NONE');
  assert.equal(d.production_cors_config_changed, 'NO');
});

test('R8.4 ENV redeploy history and next candidate remain explicitly separated', () => {
  const manifest = JSON.parse(fs.readFileSync('.github/releases/approved-production.json', 'utf8'));
  const record = JSON.parse(fs.readFileSync('docs/releases/R8.4-owner-env-redeploy-20261020.json', 'utf8'));
  assert.equal(record.deployed.source_sha, '73220e30b03cef7b3c3aa86421e854ff3e613bcb');
  assert.equal(record.deployed.deployment_id, 'dpl_BdsHurbb4Q34eMGXgNsxDuTtQHto');
  assert.equal(record.evidence.github_deployment_id, 7189764578);
  assert.equal(record.evidence.vercel_state, 'Ready');
  assert.equal(record.evidence.health, 'HTTP 200');
  assert.equal(record.evidence.ready, 'HTTP 200');
  assert.match(record.note, /not deploy or claim Attendance diagnostics SHA 83fa98c9/);
  assert.equal(manifest.commit_sha, '83fa98c9e9cd19fc09e27b5ad106d3eee9551442');
  assert.equal(manifest.tree_sha, 'dc6c0a5d853ce26a11fb94866111ca56fc874e2a');
  assert.equal(manifest.current_production_source_sha, record.deployed.source_sha);
  assert.equal(manifest.rollback_deployment_id, record.deployed.deployment_id);
  assert.equal(manifest.application_exact_sha_ci_run_id, 39362247342);
  assert.equal(manifest.run_migrations, false);
  assert.equal(manifest.database_change_policy, 'NO_DATABASE_CHANGES');
  assert.equal(manifest.production_dispatch_authorized, false);
});

test('R7 draft fails closed if rollback, migration, project or manifest authorization contracts are weakened', () => {
  const source = JSON.parse(fs.readFileSync('.github/releases/approved-production.json', 'utf8'));
  for (const [key, value] of [
    ['rollback_deployment_id', 'not-a-deployment'],
    ['run_migrations', true],
    ['database_change_policy', 'UNRESTRICTED'],
    ['target_project_id', 'not-approved'],
    ['manifest_state', 'DRAFT_SEPARATE_PRODUCTION_APPROVAL_REQUIRED']
  ]) {
    assert.throws(() => validateReleaseManifest({...source, [key]: value}), /release manifest guard/);
  }
});

test('fails closed when the canonical checkpoint metadata contradicts the rollback checkpoint', () => {
  const manifest = validManifest();
  manifest.production_canonical_deployment_id_before_release = manifest.rollback_deployment_id;
  manifest.production_canonical_source_sha_before_release = manifest.current_production_source_sha;
  assert.equal(validateReleaseManifest(manifest).rollbackDeploymentId, manifest.rollback_deployment_id);
  assert.throws(
    () => validateReleaseManifest({ ...manifest, production_canonical_deployment_id_before_release: 'dpl_OtherDeployment' }),
    /rollback_deployment_id must equal production_canonical_deployment_id_before_release/
  );
  assert.throws(
    () => validateReleaseManifest({ ...manifest, production_canonical_source_sha_before_release: 'e'.repeat(40) }),
    /current_production_source_sha must equal production_canonical_source_sha_before_release/
  );
});

test('archived R8.1 manifest is a byte-identical copy of the dispatched file and stays bound to the R8.1 record', () => {
  const archivePath = '.github/releases/r8.1-production-manifest-approved-20261019.json';
  const dispatchSha = 'fb74e591e93406a4ae70fd3c288c13c138e0afe7';
  // The archive is the post-dispatch evidence copy, not a re-approvable pre-dispatch manifest: it is
  // proven immutable by blob identity with the dispatched manifest in Git history.
  const archivedBlob = execFileSync('git', ['hash-object', archivePath], { encoding: 'utf8' }).trim();
  const dispatchedBlob = execFileSync('git', ['rev-parse', `${dispatchSha}:.github/releases/approved-production.json`], { encoding: 'utf8' }).trim();
  assert.equal(archivedBlob, dispatchedBlob);
  assert.equal(archivedBlob, '8bfe2671b00c143d3daffec66990fc40e7284954');
  const d = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
  assert.equal(d.production_release_go_no_go, 'DISPATCHED_AND_VERIFIED_SEE_POST_RELEASE_RECORD');
  assert.equal(d.release_id, 'sms-v3-prod-82d692f-20261019');
  assert.equal(d.commit_sha, '82d692fa58eaa78a6abbc675f1972e1a16a5276b');
  assert.equal(d.tree_sha, 'dfed196bf55f80f2821331d3b50cf0688364ee51');
  assert.equal(d.rollback_deployment_id, 'dpl_AjuwwRddeiq4WYZhB6S62GHYetea');
  assert.equal(d.production_canonical_deployment_id_before_release, d.rollback_deployment_id);
  assert.equal(d.production_canonical_source_sha_before_release, d.current_production_source_sha);
  assert.equal(execFileSync('git', ['rev-parse', `${d.commit_sha}^{tree}`], { encoding: 'utf8' }).trim(), d.tree_sha);

  const record = JSON.parse(fs.readFileSync('docs/releases/R8.1-post-release-20261019.json', 'utf8'));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
  assert.equal(record.archived_manifest_path, archivePath);
  assert.equal(record.archived_manifest_sha256, sha256);
  assert.equal(record.release_id, d.release_id);
  assert.equal(record.deployed.source_sha, d.commit_sha);
  assert.equal(record.deployed.deployment_id, 'dpl_BCX2U3CRidPSsMAsTk4XTKqqVF3U');
  assert.equal(record.deployed.deploy_run_id, 39208696955);
  assert.equal(record.previous_known_good.deployment_id, d.rollback_deployment_id);
  assert.equal(record.previous_known_good.source_sha, d.current_production_source_sha);
});
