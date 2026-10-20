'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SELFIE_MANIFEST,
  parseBoundedJson,
  verifySafeRecordPath,
  validateManifestValue,
  invariantFingerprint,
  sanitizeBaseline,
} = require('./trusted-production-baseline-collector');

function fail(message) { throw new Error(`pre-applied Production baseline guard: ${message}`); }
function assert(ok, message) { if (!ok) fail(message); }
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function validateProductionBaseline(input, { repositoryRoot = path.resolve(__dirname, '..', '..'), manifestPath = SELFIE_MANIFEST, fsApi = fs } = {}) {
  assert(object(input), 'inputs are missing');
  const manifest = parseBoundedJson(fsApi.readFileSync(path.resolve(repositoryRoot, manifestPath)), 'migration manifest');
  validateManifestValue({ ...manifest, manifest_path: manifestPath }, repositoryRoot);
  const release = input.release;
  assert(object(release), 'release evidence is missing');
  assert(/^[0-9a-f]{40}$/.test(release.currentProductionSourceSha || ''), 'release source SHA is malformed');
  assert(/^dpl_[A-Za-z0-9]+$/.test(release.rollbackDeploymentId || ''), 'rollback deployment ID is malformed');
  const current = manifest.current_production_deployment_id;
  if (current !== null) {
    assert(current === release.rollbackDeploymentId, 'non-null deployment does not equal rollback');
    return Object.freeze({ mode: 'NON_NULL_EXACT', rollbackDeploymentId: current });
  }
  assert(typeof input.recordPath === 'string', 'record path is missing');
  const evidence = verifySafeRecordPath(repositoryRoot, input.recordPath, fsApi);
  const record = parseBoundedJson(fsApi.readFileSync(evidence.absolute), 'post-release record');
  assert(input.postReleaseRecordVerifierPassed === true, 'post-release record verifier did not pass');
  assert(record?.deployed?.deployment_id === release.rollbackDeploymentId, 'record deployment mismatch');
  assert(record?.deployed?.source_sha === release.currentProductionSourceSha, 'record source mismatch');
  assert(input.github?.paginationComplete === true, 'GitHub evidence incomplete');
  assert(input.github.latestStatus === 'success', 'GitHub latest status is not success');
  assert(input.vercel?.readyState === 'READY' && input.vercel?.target === 'production', 'Vercel evidence is not READY Production');
  assert(input.runtime?.health?.status === 'ok' && input.runtime?.ready?.status === 'ready' && input.runtime?.ready?.database === 'ok', 'runtime evidence failed');
  const baseline = sanitizeBaseline({ release, github: input.github, vercel: input.vercel, runtime: input.runtime, record: { deploymentId: record.deployed.deployment_id, sourceSha: record.deployed.source_sha } });
  return Object.freeze({ mode: 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE', rollbackDeploymentId: release.rollbackDeploymentId, invariantFingerprint: invariantFingerprint(baseline), baseline });
}

if (require.main === module) {
  const file = process.argv[2];
  assert(file, 'input path is required');
  const result = validateProductionBaseline(parseBoundedJson(fs.readFileSync(file), 'baseline input'));
  process.stdout.write(`PRE_APPLIED_MIGRATION_PRODUCTION_BASELINE=${result.mode}\nIMMUTABLE_INVARIANT_FINGERPRINT=${result.invariantFingerprint || 'NON_NULL_EXACT'}\n`);
}

module.exports = { MIGRATION_ID: 'SELFIE-POLICY', MIGRATION_PATH: SELFIE_MANIFEST, validateProductionBaseline };
