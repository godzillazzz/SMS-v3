'use strict';
// This test certifies ONLY a non-dispatchable draft and manifest structure.
// It never authorizes Production or changes .github/releases/approved-production.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseManifest } = require('../scripts/ci/verify-release-manifest');

const release = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.github', 'releases', name), 'utf8'));
const APP = '77641a2657aa4fd05276afe645dd32648f5cc56b';
const TREE = 'f67e7a7a6895ca0fbbea8582543882feb36505b3';
const CURRENT = '51c5c828689ce543067c687e204eba7918577bb9';
const ROLLBACK = 'dpl_HS3R7QJgKgJdL8DkiXncUHarVgPV';

test('R5-B draft contains current source, tree, canonical predecessor, and READY rollback identifier', () => {
  const d = release('r5-b-production-manifest-draft.json');
  assert.equal(d.schema_version, 1);
  assert.equal(d.release_batch_id, 'R5-B');
  assert.equal(d.commit_sha, APP);
  assert.equal(d.tree_sha, TREE);
  assert.equal(d.current_production_source_sha, CURRENT);
  assert.equal(d.production_canonical_source_sha_before_release, CURRENT);
  assert.equal(d.rollback_deployment_id, ROLLBACK);
  assert.equal(d.production_canonical_deployment_id_before_release, ROLLBACK);
  assert.equal(d.production_canonical_state_before_release, 'READY');
  assert.equal(d.preview_github_commit_sha, APP);
  assert.equal(d.preview_deployment_id, 'dpl_6SxGPuH374ogrr2mjzwDkincaMCA');
  assert.equal(d.source_branch, 'fix/serverless-database-reliability');
  assert.equal(d.run_migrations, false);
  assert.equal(d.database_change_policy, 'NO_DATABASE_CHANGES');
  assert.equal(d.db_schema_mutation, 'NONE');
  assert.equal(d.production_data_mutation, 'NONE');
});

test('R5-B alternate acceptance documents the verified evidence and known coverage exclusions', () => {
  const d = release('r5-b-production-manifest-draft.json');
  assert.equal(d.alternate_business_acceptance, 'OWNER_ACCEPTED_ALTERNATE_EVIDENCE_WITH_EXPLICIT_GAPS');
  assert.equal(d.alternate_business_acceptance_owner_approval_scope, 'BUSINESS_ACCEPTANCE_ONLY_NOT_PRODUCTION_DEPLOY');
  assert.equal(d.local_api_integration_passed, 77);
  assert.equal(d.local_api_integration_failed, 0);
  assert.equal(d.local_api_integration_skipped, 0);
  assert.equal(d.local_api_integration_run_id, 37881816337);
  assert.equal(d.local_chromium_browser_passed, 2);
  assert.equal(d.local_chromium_browser_failed, 0);
  assert.equal(d.local_chromium_browser_skipped, 0);
  assert.equal(d.local_chromium_browser_run_id, 37885251975);
  assert.equal(d.acceptance_exception_q13b_q13c_hosted_preview_mutation, 'NOT_EXECUTED_ACCEPTED_WITH_RISK');
  assert.match(d.acceptance_exception_license_document_browser, /NOT_COVERED/);
  assert.equal(d.current_production_live_health_readiness, 'PASS_READONLY_20261009');
  assert.equal(d.current_production_live_cors, 'PASS_TRUSTED_AND_UNTRUSTED_CORS_20261009');
  assert.equal(d.current_production_live_readonly_run_id, 37887712383);
  assert.equal(d.preview_live_readonly_status, 'PASS_PROTECTED_READONLY_RUN_37893739588');
  assert.equal(d.preview_live_readonly_run_id, 37893739588);
  assert.equal(d.preview_prior_owner_protected_readonly_run_id, 37877103246);
  assert.equal(d.preview_superseded_anonymous_probe_failure_run_id, 37888045517);
  assert.equal(d.preview_superseded_anonymous_probe_failure_status, 'FAILURE_SSO_BLOCKED');
  assert.equal(d.preview_earlier_readonly_failure_run_id, 37887712383);
  assert.equal(d.preview_earlier_readonly_failure_status, 'FAILURE_PREVIEW_SSO_BLOCKED');
  assert.equal(d.project_auto_assign_custom_domains_current_status, 'CONFIG_VERIFIED_PASS');
  assert.equal(d.project_auto_assign_custom_domains_current_value, false);
  assert.equal(d.project_auto_assign_custom_domains_current_run_id, 37929488390);
  assert.equal(d.project_auto_assign_custom_domains_current_job_id, 113816456258);
  assert.equal(d.project_auto_assign_custom_domains_current_run_head_sha, 'ca9b3d12d67be10297ac98f5668e2cfeab74b4b4');
  assert.equal(d.project_auto_assign_custom_domains_current_verified_at, '2026-10-09T12:48:56Z');
  assert.equal(d.release_control_revalidation_status, 'EXACT_HEAD_CI_AND_FINAL_CONTROL_REVIEW_REQUIRED_AFTER_DRAFT_UPDATE');
  assert.equal(d.project_auto_assign_custom_domains_last_recorded_value, false);
  assert.equal(d.production_release_go_no_go, 'NO_GO_FINAL_CONTROL_EXACT_HEAD_REVALIDATION_AND_SEPARATE_OWNER_PRODUCTION_APPROVAL_REQUIRED');
});

test('control evidence binds verified GitHub SHA/CI and avoids a self-referential control SHA', () => {
  const d = release('r5-b-production-manifest-draft.json');
  assert.equal(d.application_exact_sha_ci_run_id, 37803174443);
  assert.equal(d.application_exact_sha_ci_status, 'SUCCESS_EXACT_FROZEN_APPLICATION_SHA');
  assert.equal(d.release_control_ci_evidence.verified_base_pr_number, 578);
  assert.equal(d.release_control_ci_evidence.verified_base_pr_head_sha, 'eddc5903c6e1ccdbcd9d559176ca17368e758dfc');
  assert.equal(d.release_control_ci_evidence.exact_ci_run_id, 37888045410);
  assert.equal(d.release_control_ci_evidence.exact_ci_attempt, 2);
  assert.equal(d.release_control_ci_evidence.exact_ci_conclusion, 'SUCCESS');
  assert.equal(d.release_control_ci_evidence.exact_ci_run_head_sha, d.release_control_ci_evidence.verified_base_pr_head_sha);
  assert.equal(d.protected_control_preview_evidence.workflow_run_id, 37893739588);
  assert.equal(d.protected_control_preview_evidence.verified_deployment_id, 'dpl_DW76MRuxtWujdUaF73YBQwcERhvU');
  assert.equal(d.protected_control_preview_evidence.verified_deployment_sha, d.release_control_ci_evidence.verified_base_pr_head_sha);
  assert.equal(d.protected_control_preview_evidence.checks.production_deployment, 'NOT_EXECUTED');
  assert.equal(d.final_control_sha_binding.source, 'OFFICIAL_WORKFLOW_DISPATCH_EVENT_GITHUB_SHA');
  assert.equal(d.final_control_sha_binding.embedded_in_manifest, false);
  assert.equal(Object.hasOwn(d, 'release_control_sha'), false);
});

test('R5-B draft is still rejected, while staged official R5-B decision payload remains non-dispatch-authorized', () => {
  const d = release('r5-b-production-manifest-draft.json');
  assert.equal(d.manifest_state, 'DRAFT_SEPARATE_PRODUCTION_APPROVAL_REQUIRED');
  assert.equal(d.owner_action, 'PENDING_SEPARATE_PRODUCTION_APPROVAL');
  assert.equal(d.production_dispatch_authorized, false);
  assert.equal(d.owner_batch_frozen_sha_approval, 'PENDING_NOT_AUTHORIZED');
  assert.throws(() => validateReleaseManifest(d), /manifest_state is not approved/);
  const official = release('approved-production.json');
  const parsed = validateReleaseManifest(official);
  assert.equal(official.release_batch_id, 'R5-B');
  assert.equal(parsed.commitSha, d.commit_sha);
  assert.equal(parsed.treeSha, d.tree_sha);
  assert.equal(official.production_dispatch_authorized, false);
  assert.equal(official.owner_batch_frozen_sha_approval, 'PENDING_NOT_AUTHORIZED');
  assert.equal(official.release_control_transition_owner_scope, 'RELEASE_CONTROL_PREPARATION_ONLY_NO_PRODUCTION_DISPATCH');
  const archived = release('r5-a-production-manifest-archive-20261009.json');
  assert.equal(archived.release_batch_id, 'R5-A');
  assert.equal(archived.production_dispatch_authorized, false);
});

test('R5-B draft matches official target, rollback, and policy schema without granting authorization', () => {
  const d = release('r5-b-production-manifest-draft.json');
  // In-memory projection only; the actual draft is immutable and rejected above.
  const projected = {...d, manifest_state: 'APPROVED_FOR_OWNER_PRODUCTION_DECISION', owner_action: 'APPROVE_PRODUCTION_ONLY'};
  const parsed = validateReleaseManifest(projected);
  assert.equal(parsed.commitSha, APP);
  assert.equal(parsed.treeSha, TREE);
  assert.equal(parsed.currentProductionSourceSha, CURRENT);
  assert.equal(parsed.rollbackDeploymentId, ROLLBACK);
  assert.equal(parsed.runMigrations, false);
  assert.equal(parsed.databaseChangePolicy, 'NO_DATABASE_CHANGES');
  assert.equal(d.owner_action, 'PENDING_SEPARATE_PRODUCTION_APPROVAL');
});
test('prior draft-head CI is retained as historical evidence, not current-head validation', () => {
  const d = release('r5-b-production-manifest-draft.json');
  const e = d.previous_draft_control_ci_evidence;
  assert.equal(e.source_pr_number, 580);
  assert.equal(e.validation_only_pr_number, 581);
  assert.equal(e.run_id, 37913878617);
  assert.equal(e.conclusion, 'SUCCESS');
  assert.equal(e.exact_head_sha, 'fefe526a49f8fc17a77d4ef5962f6aa4c30687b1');
  assert.equal(e.preview_deployment_id, 'dpl_ATn9cWXUAY6aXWLS5WAkWTyeKQKM');
  assert.equal(d.production_dispatch_authorized, false);
});

test('latest Integration evidence keeps App and Control identities separate and records protected Smoke/CORS', () => {
  const d = release('r5-b-production-manifest-draft.json');
  const e = d.latest_integration_control_preview_evidence;
  assert.equal(d.commit_sha, APP);
  assert.equal(d.tree_sha, TREE);
  assert.equal(e.evidence_scope, 'LATEST_INTEGRATION_CONTROL_PREVIEW_SEPARATE_FROM_FROZEN_APPLICATION_SHA');
  assert.equal(e.integration_control_sha, 'e3ff848f0b5aa0e8f15887bef02ce81e6a9b165b');
  assert.equal(e.integration_control_ci_run_id, 37916840107);
  assert.equal(e.preview_deployment_id, 'dpl_CrAgeJxHdqaq2FBziFTPGuBB3w9v');
  assert.equal(e.preview_github_commit_sha, e.integration_control_sha);
  assert.equal(e.preview_project_id, 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s');
  assert.equal(e.preview_state, 'READY');
  assert.equal(e.technical_smoke_run_id, 37924283107);
  assert.equal(e.technical_smoke_status, 'SUCCESS');
  assert.equal(e.technical_smoke_passed, 11);
  assert.equal(e.technical_smoke_failed, 0);
  assert.equal(e.technical_smoke_skipped, 72);
  assert.equal(e.technical_smoke_artifact_leak_count, 0);
  assert.equal(e.technical_smoke_harness_sha, 'ccb6b840ecc090e79bbf906ea45d665a8b790393');
  assert.equal(e.preview_cors_protected_run_id, 37929488390);
  assert.equal(e.preview_cors_status, 'SUCCESS');
  assert.equal(e.preview_health, 'PASS_HTTP_200');
  assert.equal(e.preview_database_readiness, 'PASS_HTTP_200_DATABASE_OK');
  assert.equal(e.preview_trusted_cors, 'PASS_HTTP_204_EXACT_ORIGIN_CREDENTIALS_TRUE');
  assert.equal(e.preview_untrusted_cors, 'PASS_HTTP_403_NO_ALLOW_ORIGIN');
  assert.equal(e.project_auto_assign_custom_domains_verified, false);
  assert.equal(e.preview_cors_business_mutations, 'NOT_EXECUTED_GET_OPTIONS_ONLY');
  assert.equal(e.main_release_workflow_ci_run_id, 37929455775);
  assert.equal(e.owner_production_approval, 'PENDING_SEPARATE_APPROVAL_NOT_AUTHORIZED');
  assert.equal(d.production_dispatch_authorized, false);
});
