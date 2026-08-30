'use strict';

const fs = require('node:fs');

const EXPECTED = Object.freeze({
  schemaVersion: 1,
  projectName: 'sms-v3-staging',
  projectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  orgId: 'team_nemCExHbZ8EAhSgsvefHPAEz',
  environment: 'production',
  canonicalUrl: 'https://sms-v3-staging-ten.vercel.app',
  sourceBranch: 'fix/serverless-database-reliability',
});

const shaPattern = /^[0-9a-f]{40}$/;
const deploymentPattern = /^dpl_[A-Za-z0-9]+$/;
const releaseIdPattern = /^sms-v3-prod-[0-9a-f]{7,12}-[0-9]{8}$/;

function assert(condition, message) {
  if (!condition) throw new Error(`release manifest guard: ${message}`);
}

function validateReleaseManifest(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'manifest must be a JSON object');
  assert(input.schema_version === EXPECTED.schemaVersion, 'unsupported schema_version');
  assert(releaseIdPattern.test(input.release_id || ''), 'invalid release_id');
  assert(input.manifest_state === 'APPROVED_FOR_OWNER_PRODUCTION_DECISION', 'manifest_state is not approved for Owner decision');
  assert(shaPattern.test(input.commit_sha || ''), 'invalid commit_sha');
  assert(shaPattern.test(input.tree_sha || ''), 'invalid tree_sha');
  assert(shaPattern.test(input.current_production_source_sha || ''), 'invalid current_production_source_sha');
  assert(deploymentPattern.test(input.rollback_deployment_id || ''), 'invalid rollback_deployment_id');
  assert(input.target_project_name === EXPECTED.projectName, 'target_project_name mismatch');
  assert(input.target_project_id === EXPECTED.projectId, 'target_project_id mismatch');
  assert(input.target_org_id === EXPECTED.orgId, 'target_org_id mismatch');
  assert(input.target_environment === EXPECTED.environment, 'target_environment mismatch');
  assert(input.canonical_url === EXPECTED.canonicalUrl, 'canonical_url mismatch');
  assert(input.source_branch === EXPECTED.sourceBranch, 'source_branch mismatch');
  assert(input.run_migrations === false, 'run_migrations must be false until the migration-aware manifest policy is implemented');
  assert(input.owner_action === 'APPROVE_PRODUCTION_ONLY', 'owner_action must be APPROVE_PRODUCTION_ONLY');
  assert(input.rollback_policy === 'AUTO_ROLLBACK_ON_POST_DEPLOY_VERIFY_FAILURE', 'rollback_policy mismatch');

  return Object.freeze({
    schemaVersion: input.schema_version,
    releaseId: input.release_id,
    commitSha: input.commit_sha,
    treeSha: input.tree_sha,
    currentProductionSourceSha: input.current_production_source_sha,
    rollbackDeploymentId: input.rollback_deployment_id,
    targetProjectName: input.target_project_name,
    targetProjectId: input.target_project_id,
    targetOrgId: input.target_org_id,
    targetEnvironment: input.target_environment,
    canonicalUrl: input.canonical_url,
    sourceBranch: input.source_branch,
    runMigrations: input.run_migrations,
    ownerAction: input.owner_action,
    rollbackPolicy: input.rollback_policy,
  });
}

function outputLines(manifest) {
  return [
    'RELEASE_MANIFEST_GUARD=PASS',
    `release_id=${manifest.releaseId}`,
    `commit_sha=${manifest.commitSha}`,
    `tree_sha=${manifest.treeSha}`,
    `current_production_source_sha=${manifest.currentProductionSourceSha}`,
    `rollback_deployment_id=${manifest.rollbackDeploymentId}`,
    `target_project_name=${manifest.targetProjectName}`,
    `target_project_id=${manifest.targetProjectId}`,
    `target_org_id=${manifest.targetOrgId}`,
    `target_environment=${manifest.targetEnvironment}`,
    `canonical_url=${manifest.canonicalUrl}`,
    `source_branch=${manifest.sourceBranch}`,
    `run_migrations=${manifest.runMigrations}`,
    `owner_action=${manifest.ownerAction}`,
    `rollback_policy=${manifest.rollbackPolicy}`,
  ];
}

function main() {
  const file = process.argv[2];
  assert(file, 'manifest path is required');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const manifest = validateReleaseManifest(parsed);
  process.stdout.write(`${outputLines(manifest).join('\n')}\n`);
}

if (require.main === module) main();

module.exports = { EXPECTED, outputLines, validateReleaseManifest };
