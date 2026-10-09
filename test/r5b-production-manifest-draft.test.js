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
  assert.equal(d.preview_live_readonly_status, 'BLOCKED_PROTECTED_SSO_REQUIRES_APPROVED_BYPASS');
  assert.equal(d.preview_prior_owner_protected_readonly_run_id, 37877103246);
  assert.equal(d.production_release_go_no_go, 'NO_GO_AWAITING_PROTECTED_PREVIEW_PREFLIGHT_ROLLBACK_AND_SEPARATE_OWNER_PRODUCTION_APPROVAL');
});

test('R5-B draft is rejected by the official Production manifest guard, and dispatcher has no R5-B manifest', () => {
  const d = release('r5-b-production-manifest-draft.json');
  assert.equal(d.manifest_state, 'DRAFT_SEPARATE_PRODUCTION_APPROVAL_REQUIRED');
  assert.equal(d.owner_action, 'PENDING_SEPARATE_PRODUCTION_APPROVAL');
  assert.equal(d.production_dispatch_authorized, false);
  assert.equal(d.owner_batch_frozen_sha_approval, 'PENDING_NOT_AUTHORIZED');
  assert.throws(() => validateReleaseManifest(d), /manifest_state is not approved/);
  const official = release('approved-production.json');
  assert.equal(official.release_batch_id, 'R5-A');
  assert.notEqual(official.commit_sha, d.commit_sha);
  assert.notEqual(official.release_id, d.release_id);
  assert.equal(official.production_dispatch_authorized, false);
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
