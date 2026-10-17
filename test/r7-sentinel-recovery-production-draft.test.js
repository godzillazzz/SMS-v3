'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseManifest } = require('../scripts/ci/verify-release-manifest');

const load = (filename) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.github', 'releases', filename), 'utf8'));
const app = '3cde5a61581c6239697dfb0cfb2fa5510ec8a239';
const tree = 'a009330394d04e0db8ef9c961177483c871a3d25';
const rollback = 'dpl_HbzTEkJnDsyVrRSvMpmVxSQfRCEV';

test('R7 recovered SHA is pinned to successful exact-sha CI, READY Preview, and technical smoke evidence', () => {
  const draft = load('r7-sentinel-recovery-production-draft-20261014.json');
  assert.equal(draft.release_batch_id, 'R7');
  assert.equal(draft.release_id, 'sms-v3-prod-3cde5a61581c-20261014');
  assert.equal(draft.commit_sha, app);
  assert.equal(draft.tree_sha, tree);
  assert.equal(draft.application_exact_sha_ci_run_id, 38518813007);
  assert.equal(draft.application_exact_sha_ci_status, 'SUCCESS');
  assert.equal(draft.preview_deployment_id, 'dpl_8rrGCJLGNrAnsYo87kDDAYCXXRPm');
  assert.equal(draft.preview_github_commit_sha, app);
  assert.equal(draft.preview_github_commit_ref, 'fix/serverless-database-reliability');
  assert.equal(draft.preview_state, 'READY');
  assert.equal(draft.preview_technical_smoke_run_id, 38522672163);
  assert.equal(draft.preview_technical_smoke_artifact_id, 11874670698);
  assert.equal(draft.preview_technical_smoke_status, 'SUCCESS');
  assert.equal(draft.preview_technical_smoke_passed, 11);
  assert.equal(draft.preview_technical_smoke_failed, 0);
  assert.equal(draft.preview_technical_smoke_skipped, 23);
  assert.equal(draft.preview_technical_smoke_artifact_leak_count, 0);
  assert.match(draft.preview_authenticated_full_uat_status, /NOT_RUN/);
});

test('R7 recovery draft retains R6 rollback and forbids data/migration/environment changes', () => {
  const d = load('r7-sentinel-recovery-production-draft-20261014.json');
  assert.equal(d.current_production_source_sha, '09486d684f2af89a1589ebf8dd11cbeb9f79050b');
  assert.equal(d.production_canonical_deployment_id_before_release, rollback);
  assert.equal(d.rollback_deployment_id, rollback);
  assert.equal(d.run_migrations, false);
  assert.equal(d.database_change_policy, 'NO_DATABASE_CHANGES');
  assert.equal(d.db_schema_mutation, 'NONE');
  assert.equal(d.db_data_mutation, 'NONE');
  assert.equal(d.production_data_mutation, 'NONE');
  assert.equal(d.production_environment_change_policy, 'NO_ENVIRONMENT_CHANGES');
  assert.equal(d.secret_changes, 'NONE');
  assert.equal(d.production_cors_config_changed, 'NO');
});

test('draft fails closed; prior R7 approval cannot be transferred to the current R7.1 source SHA', () => {
  const d = load('r7-sentinel-recovery-production-draft-20261014.json');
  assert.equal(d.manifest_state, 'DRAFT_SEPARATE_PRODUCTION_APPROVAL_REQUIRED');
  assert.equal(d.owner_action, 'PENDING_SEPARATE_PRODUCTION_APPROVAL');
  assert.equal(d.owner_batch_frozen_sha_approval, 'PENDING_NEW_SHA_OWNER_APPROVAL');
  assert.equal(d.production_dispatch_authorized, false);
  assert.match(d.production_release_go_no_go, /^NO_GO/);
  assert.throws(() => validateReleaseManifest(d), /manifest_state is not approved/);

  const original = load('r7-production-manifest-superseded-failed-20261014.json');
  assert.notEqual(original.commit_sha, app);
  assert.equal(original.commit_sha, '1b30ec935fb2fe3ed15c85d74d15245996bff62c');
  assert.equal(original.rollback_deployment_id, rollback);

  const current = load('approved-production.json');
  const validated = validateReleaseManifest(current);
  assert.equal(current.release_batch_id, 'R7.1');
  assert.equal(validated.commitSha, 'b757f3764966c9a42dbcab53b6c9cd51b2beadf3');
  assert.equal(validated.currentProductionSourceSha, '2e43619957ff4f1fb9bc88da5597a8e68e3eacee');
  assert.equal(validated.rollbackDeploymentId, 'dpl_GWCVv4MvfKvsm6zS8pmEswwCwiim');
  assert.equal(current.production_dispatch_authorized, false);
  assert.equal(current.production_release_go_no_go, 'OWNER_PRODUCTION_DECISION_REQUIRED_NO_DISPATCH_AUTHORIZED');
});
