'use strict';
const { randomBytes } = require('node:crypto');
const { fail } = require('./config');
const { EXPECTED, signRuntimeChallenge, verifyRuntimeReceipt } = require('../../scripts/ci/r6b-exact-deployment-isolation.cjs');
// Reuse the existing integration attestation protocol and verifier. Configured
// fingerprints and /ready alone are never proof of the effective runtime target.
async function verifyRuntimeIsolation(target, deployment, readiness, { fetcher = fetch, env = process.env } = {}) {
  if (readiness?.status !== 'ready' || readiness.database !== 'ok') fail('UAT_RUNTIME_DATABASE_READINESS_FAILED');
  if (target.authorized !== true || target.database_isolation_verified !== true) fail('UAT_DISPOSABLE_TARGET_NOT_AUTHORIZED');
  if (!env.RUNTIME_ISOLATION_PROBE_HMAC_SECRET || Buffer.byteLength(env.RUNTIME_ISOLATION_PROBE_HMAC_SECRET) < 32) fail('UAT_RUNTIME_RECEIPT_REQUIRED');
  const host = new URL(target.url).host;
  if (deployment.id !== target.deployment_id || deployment.url !== host || deployment.meta?.githubCommitSha !== target.source_sha || deployment.meta?.githubCommitRef !== target.source_branch) fail('UAT_RUNTIME_PROVENANCE_REQUIRED');
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  const signature = signRuntimeChallenge(env.RUNTIME_ISOLATION_PROBE_HMAC_SECRET, { host, deploymentId: target.deployment_id, sha: target.source_sha, nonce, issuedAt });
  const params = new URLSearchParams({ nonce, sha: target.source_sha, deploymentId: target.deployment_id, issuedAt: String(issuedAt) });
  const response = await fetcher(target.url + EXPECTED.probePath + '?' + params, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'x-smsv3-probe-signature': signature, 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } });
  if (response.status !== 200) fail('UAT_RUNTIME_RECEIPT_REQUIRED');
  const receipt = await response.json();
  if (receipt?.signedChallengeIdentity?.host !== host || receipt.signedChallengeIdentity.issuedAt !== issuedAt) fail('UAT_RUNTIME_CHALLENGE_MISMATCH');
  return verifyRuntimeReceipt(receipt, nonce, {
    deploymentVerified: true, deploymentId: target.deployment_id,
    applicationSha: target.source_sha, integrationRef: target.source_branch,
    approvedRuntimePrincipal: target.approved_runtime_principal,
    approvedPreviewClusterFingerprintSha256: target.approved_preview_cluster_fingerprint_sha256,
    approvedProductionClusterFingerprintSha256: target.approved_production_cluster_fingerprint_sha256,
    approvedProductionDatabaseRef: target.approved_production_database_ref,
    approvedProductionStorageRef: target.approved_production_storage_ref
  });
}
module.exports = { verifyRuntimeIsolation };
