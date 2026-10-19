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

  const current = load('r7.1-production-manifest-approved-20261017.json');
  const validated = validateReleaseManifest(current);
  assert.equal(current.release_batch_id, 'R7.1');
  assert.equal(validated.commitSha, 'a0250b8b0ca8072104a4d3593012220c4fe2fb84');
  assert.equal(validated.currentProductionSourceSha, 'f30bc45915acb8c87a94d2d8a2d0e90a86d6f16e');
  assert.equal(validated.rollbackDeploymentId, 'dpl_9CxiMbXdmBqp6LJG8YHKcVXgL1JN');
  assert.equal(current.production_environment_change_policy, 'OWNER_APPROVED_REGION_CHANGE_ONLY');

  // The live manifest is a separate, later release: it must carry its own evidence and must
  // never inherit the R7.1 approval SHA.
  const live = load('approved-production.json');
  const liveValidated = validateReleaseManifest(live);
  assert.equal(live.release_batch_id, 'R8.2');
  assert.equal(live.run_migrations, false);
  if (live.database_change_policy === 'PRE_APPLIED_APPROVED_MIGRATION') {
    // The evidence run id is refreshed whenever the evidence is re-collected, so assert the shape
    // and the cross-reference rather than a frozen number.
    assert.ok(Number.isSafeInteger(live.pre_applied_migration_evidence_run_id) && live.pre_applied_migration_evidence_run_id > 0);
    const evidence = load(path.basename(live.pre_applied_migration_manifest_path));
    assert.ok(evidence.canonical_health_readiness === 'PASS' || evidence.manifest_state === 'APPROVED_FOR_OWNER_PRODUCTION_MIGRATION_DECISION');
    assert.equal(evidence.application_deploy, false);
    assert.equal(evidence.destructive_rollback, false);
    assert.match(live.pre_applied_migration_manifest_path, /^[.]github\/releases\/approved-[a-z0-9-]+-(?:production-)?migration[.]json$/);
  } else {
    // A release that carries no schema change must not reference migration evidence at all.
    assert.equal(live.database_change_policy, 'NO_DATABASE_CHANGES');
    assert.equal(live.pre_applied_migration_manifest_path, null);
    assert.equal(live.pre_applied_migration_evidence_run_id, null);
  }
  assert.notEqual(liveValidated.commitSha, 'a0250b8b0ca8072104a4d3593012220c4fe2fb84');
  assert.equal(live.run_migrations, false);
  assert.match(current.production_environment_change_note, /OWNER approved Vercel function region/);
  assert.equal(current.production_dispatch_authorized, false);
  assert.equal(current.production_release_go_no_go, 'OWNER_PRODUCTION_DECISION_REQUIRED_NO_DISPATCH_AUTHORIZED');
});
