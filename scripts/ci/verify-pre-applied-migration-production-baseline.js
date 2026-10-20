'use strict';

// Pure, fail-closed validation for the already-applied SELFIE-POLICY baseline.
// All observations are supplied by the caller; this module performs no network,
// filesystem, GitHub, Vercel, database, or deployment operations.
const path = require('node:path');

const SHA = /^[0-9a-f]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const MIGRATION_PATH = '.github/releases/approved-attendance-selfie-policy-migration.json';
const MIGRATION_ID = 'SELFIE-POLICY';

function fail(message) { throw new Error(`pre-applied Production baseline guard: ${message}`); }
function requireThat(condition, message) { if (!condition) fail(message); }
function own(object, key) { return object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key); }
function nonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function fullSha(value) { return typeof value === 'string' && SHA.test(value); }
function deploymentId(value) { return typeof value === 'string' && DEPLOYMENT.test(value); }

function validateSafeRecordPath(input) {
  const recordPath = input.recordPath;
  requireThat(typeof recordPath === 'string' && recordPath.length > 0 && recordPath.trim() === recordPath, 'record path is missing or whitespace-padded');
  requireThat(!path.isAbsolute(recordPath), 'record path must be relative');
  const normalized = path.posix.normalize(recordPath.replaceAll('\\', '/'));
  requireThat(normalized === recordPath && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../'), 'record path traversal is forbidden');
  requireThat(input.recordPathExists === true, 'record path does not exist');
  requireThat(input.recordPathSymlinkEscape !== true, 'record path symlink escapes repository');
  if (input.repositoryRoot && input.recordPathResolved) {
    const root = path.resolve(input.repositoryRoot);
    const resolved = path.resolve(input.recordPathResolved);
    requireThat(resolved === root || resolved.startsWith(`${root}${path.sep}`), 'record path resolves outside repository');
  }
  return normalized;
}

function validateGitHub(github, expectedSha, rollbackId) {
  requireThat(github && typeof github === 'object', 'GitHub deployment snapshot is missing');
  requireThat(github.paginationComplete === true, 'GitHub deployment pagination is incomplete');
  requireThat(Array.isArray(github.deployments) && github.deployments.length > 0, 'GitHub deployments snapshot is empty or malformed');
  const rows = github.deployments;
  for (const row of rows) {
    requireThat(row && Number.isSafeInteger(row.id) && row.id > 0, 'GitHub deployment ID is not an integer');
    requireThat(fullSha(row.sha), 'GitHub deployment source SHA is malformed');
    requireThat(nonEmptyString(row.environment), 'GitHub deployment environment is missing');
    requireThat(Number.isFinite(Date.parse(row.created_at)), 'GitHub deployment timestamp is malformed');
  }
  const evidence = rows.find((row) => row.id === github.evidenceDeploymentId);
  requireThat(evidence, 'GitHub evidence deployment was not found');
  requireThat(evidence.id === github.evidenceDeploymentId && Number.isSafeInteger(evidence.id), 'GitHub evidence deployment ID is invalid');
  requireThat(evidence.sha === expectedSha, 'GitHub evidence source SHA mismatch');
  requireThat(evidence.environment === 'Production', 'GitHub evidence deployment environment mismatch');

  const latest = rows.reduce((a, b) => Date.parse(a.created_at) >= Date.parse(b.created_at) ? a : b);
  requireThat(latest.id === github.latestDeploymentId, 'latest GitHub Production deployment identity mismatch');
  requireThat(latest.sha === expectedSha, 'latest GitHub deployment source SHA mismatch');
  requireThat(latest.environment === 'Production', 'latest GitHub deployment environment mismatch');
  requireThat(latest.status === 'success', 'latest GitHub Production deployment status is not success');
  return Object.freeze({ evidenceId: evidence.id, latestId: latest.id });
}

function validateVercel(vercel, rollbackId, expectedSha) {
  requireThat(vercel && typeof vercel === 'object', 'Vercel snapshot is missing');
  const canonical = vercel.canonical;
  requireThat(canonical && canonical.id === rollbackId, 'canonical Vercel deployment ID does not equal rollback');
  requireThat(deploymentId(canonical.id), 'canonical Vercel deployment ID is malformed');
  requireThat(canonical.target === 'production' && canonical.state === 'READY', 'canonical Vercel deployment is not READY Production');
  requireThat(canonical.githubCommitSha === expectedSha || canonical.provenanceSha === expectedSha, 'canonical Vercel provenance SHA mismatch');
  requireThat(canonical.aliasAssigned === true || canonical.canonical === true, 'canonical Vercel deployment is not canonical');
  return Object.freeze({ id: canonical.id, target: canonical.target, state: canonical.state });
}

function validateRuntime(runtime) {
  requireThat(runtime && typeof runtime === 'object', 'runtime snapshot is missing');
  requireThat(runtime.health && runtime.health.httpStatus === 200 && runtime.health.status === 'ok', 'health check failed');
  requireThat(runtime.ready && runtime.ready.httpStatus === 200 && runtime.ready.status === 'ready' && runtime.ready.database === 'ok', 'ready check failed');
}

function validateProductionBaseline(input) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), 'inputs are missing');
  const release = input.release || {};
  const migration = input.migration || {};
  requireThat(fullSha(release.currentProductionSourceSha), 'release current Production source SHA is malformed');
  requireThat(deploymentId(release.rollbackDeploymentId), 'release rollback deployment ID is malformed');
  requireThat(migration.migrationId === MIGRATION_ID, 'migration ID must be SELFIE-POLICY');
  requireThat(migration.manifestPath === MIGRATION_PATH, 'migration manifest path mismatch');
  requireThat(migration.verifierPassed === true, 'existing migration verifier did not pass');

  const fieldPresent = migration.fieldPresent === true || own(migration, 'currentProductionDeploymentId');
  requireThat(fieldPresent, 'current Production deployment field is missing');
  const currentId = migration.currentProductionDeploymentId;
  if (currentId !== null) {
    requireThat(deploymentId(currentId), 'non-null current Production deployment ID is malformed');
    requireThat(currentId === release.rollbackDeploymentId, 'non-null current Production deployment ID does not equal rollback');
    return Object.freeze({ mode: 'NON_NULL_EXACT', rollbackDeploymentId: release.rollbackDeploymentId });
  }

  requireThat(migration.currentProductionDeploymentId === null, 'null exception requires literal null');
  requireThat(validateSafeRecordPath(input), 'record path validation failed');
  requireThat(input.postReleaseRecordVerifierPassed === true, 'post-release record verifier did not pass');
  const record = input.postReleaseRecord;
  requireThat(record && typeof record === 'object', 'post-release record is missing');
  const deployed = record.deployed || {};
  const evidence = record.evidence || {};
  requireThat(deployed.deployment_id === release.rollbackDeploymentId, 'record deployed deployment ID mismatch');
  requireThat(deployed.source_sha === release.currentProductionSourceSha, 'record deployed source SHA mismatch');
  requireThat(migration.currentProductionApplicationSha === release.currentProductionSourceSha, 'migration current Production application SHA mismatch');
  requireThat(Number.isSafeInteger(evidence.github_deployment_id) && evidence.github_deployment_id > 0, 'record GitHub deployment ID is not an integer');
  requireThat(evidence.github_source_sha === release.currentProductionSourceSha, 'record GitHub source SHA mismatch');
  validateGitHub(input.github, release.currentProductionSourceSha, release.rollbackDeploymentId);
  validateVercel(input.vercel, release.rollbackDeploymentId, release.currentProductionSourceSha);
  validateRuntime(input.runtime);
  return Object.freeze({ mode: 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE', rollbackDeploymentId: release.rollbackDeploymentId });
}

if (require.main === module) {
  const fs = require('node:fs');
  const inputPath = process.argv[2];
  requireThat(inputPath, 'input path is required');
  const result = validateProductionBaseline(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  process.stdout.write(`PRE_APPLIED_MIGRATION_PRODUCTION_BASELINE=${result.mode}\n`);
}

module.exports = {
  MIGRATION_ID,
  MIGRATION_PATH,
  validateSafeRecordPath,
  validateGitHub,
  validateVercel,
  validateProductionBaseline,
};
