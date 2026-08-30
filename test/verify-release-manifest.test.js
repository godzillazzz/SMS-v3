const test = require('node:test');
const assert = require('node:assert/strict');

const { validateReleaseManifest } = require('../scripts/ci/verify-release-manifest');

function validManifest() {
  return {
    schema_version: 1,
    release_id: 'sms-v3-prod-86a495a-20260830',
    manifest_state: 'APPROVED_FOR_OWNER_PRODUCTION_DECISION',
    commit_sha: '86a495a60e989ff25e08cf5d204ba5ad6e7e064c',
    tree_sha: 'ccf7e9858b5a52dcd2be61a05f5bc2d4bcfaf6e1',
    current_production_source_sha: '7b9757facdea9934b63417fe955cbec418151d05',
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
  };
}

test('accepts the exact approved production release manifest shape', () => {
  const result = validateReleaseManifest(validManifest());
  assert.equal(result.commitSha, '86a495a60e989ff25e08cf5d204ba5ad6e7e064c');
  assert.equal(result.runMigrations, false);
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
