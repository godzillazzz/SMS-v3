'use strict';
/**
 * R6-B source-review contract for future independent provider evidence.
 * Pure, mock-testable code only. It never calls provider APIs, reads
 * credentials, executes SQL or certifies an isolation/release PASS.
 *
 * A trusted future runner MUST authenticate the source of every input.
 * User-supplied values, Preview receipts and mutable env variables MUST NOT
 * be promoted to provider attestations by this module.
 */
const EXPECTED = Object.freeze({
  productionProjectRef: 'jkexwnlxnxbemwavsebv',
  previewProjectRef: 'ezxanpfagitckpfsnflp',
  productionBucket: 'sms-v3-license-documents',
  previewBucket: 'license-documents-g05-preview'
});
const SHA256 = /^[a-f0-9]{64}$/;
const REF = /^[a-z0-9]{20}$/;
const ID = /^[A-Za-z0-9_-]{6,128}$/;
const RELEASE_HOLD = Object.freeze({
  databaseIsolation: 'UNVERIFIED',
  storageIsolation: 'UNVERIFIED',
  productionSeparation: 'UNVERIFIED',
  rlsSecurity: 'HOLD',
  r6bRelease: 'HOLD'
});
function fail(reason) { throw new Error(reason); }
function requireObject(obj, keys, category) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)
    || Object.keys(obj).sort().join('|') !== [...keys].sort().join('|')) {
    fail(category + '_EVIDENCE_SHAPE_UNVERIFIED');
  }
}
function requireString(value, pattern, category) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail(category + '_EVIDENCE_UNVERIFIED');
  }
}
/**
 * Evaluates a MOCKABLE proposed evidence contract and returns candidate
 * comparisons, not authenticated attestations. No release PASS is possible.
 *
 * providerPreview and providerProduction MUST ultimately be collected
 * independently via separate, authenticated provider scopes.
 * runtimePreview MUST ultimately originate from the source-reviewed, signed,
 * exact-Deployment nonce-bound runtime with the actual Prisma principal.
 */
function assessCandidateEvidence({ providerPreview, providerProduction, runtimePreview } = {}) {
  for (const [name, value, expectedRef, expectedBucket] of [
    ['PREVIEW', providerPreview, EXPECTED.previewProjectRef, EXPECTED.previewBucket],
    ['PRODUCTION', providerProduction, EXPECTED.productionProjectRef, EXPECTED.productionBucket]
  ]) {
    requireObject(value,
      ['projectRef', 'clusterFingerprintSha256', 'bucketName', 'bucketPrivate',
       'storageKeyIdentifier', 'storageAuditRequestId'], name);
    requireString(value.projectRef, REF, name + '_PROJECT');
    if (value.projectRef !== expectedRef || value.bucketName !== expectedBucket) {
      fail(name + '_PROJECT_SCOPE_MISMATCH');
    }
    requireString(value.clusterFingerprintSha256, SHA256, name + '_CLUSTER');
    if (value.bucketPrivate !== true) fail(name + '_BUCKET_NOT_PRIVATE');
    // Key IDs and audit IDs are nonsecret metadata, never a raw credential.
    if (value.storageKeyIdentifier !== null)
      requireString(value.storageKeyIdentifier, ID, name + '_KEY_ID');
    if (value.storageAuditRequestId !== null)
      requireString(value.storageAuditRequestId, ID, name + '_AUDIT_ID');
  }
  if (providerPreview.projectRef === providerProduction.projectRef) fail('PROVIDER_PROJECT_COLLISION');
  if (providerPreview.clusterFingerprintSha256 === providerProduction.clusterFingerprintSha256)
    fail('DATABASE_CLUSTER_COLLISION');
  requireObject(runtimePreview,
    ['deploymentId', 'applicationSha', 'nonce', 'clusterFingerprintSha256',
     'storageKeyIdentifier', 'storageAuditRequestId'], 'RUNTIME');
  requireString(runtimePreview.deploymentId, /^dpl_[A-Za-z0-9]+$/, 'RUNTIME_DEPLOYMENT');
  requireString(runtimePreview.applicationSha, /^[a-f0-9]{40}$/, 'RUNTIME_SHA');
  requireString(runtimePreview.nonce, /^[a-f0-9]{32}$/, 'RUNTIME_NONCE');
  if (runtimePreview.clusterFingerprintSha256 !== null)
    requireString(runtimePreview.clusterFingerprintSha256, SHA256, 'RUNTIME_CLUSTER');
  if (runtimePreview.storageKeyIdentifier !== null)
    requireString(runtimePreview.storageKeyIdentifier, ID, 'RUNTIME_KEY_ID');
  if (runtimePreview.storageAuditRequestId !== null)
    requireString(runtimePreview.storageAuditRequestId, ID, 'RUNTIME_AUDIT_ID');

  const dbComparable = runtimePreview.clusterFingerprintSha256 !== null;
  const dbMatches = dbComparable
    && runtimePreview.clusterFingerprintSha256 === providerPreview.clusterFingerprintSha256
    && runtimePreview.clusterFingerprintSha256 !== providerProduction.clusterFingerprintSha256;
  if (dbComparable && !dbMatches) fail('RUNTIME_DATABASE_CLUSTER_UNVERIFIED');
  const storageComparable = providerPreview.storageKeyIdentifier !== null
    && providerProduction.storageKeyIdentifier !== null
    && providerPreview.storageAuditRequestId !== null
    && runtimePreview.storageKeyIdentifier !== null
    && runtimePreview.storageAuditRequestId !== null;
  const storageMatches = storageComparable
    && runtimePreview.storageKeyIdentifier === providerPreview.storageKeyIdentifier
    && runtimePreview.storageKeyIdentifier !== providerProduction.storageKeyIdentifier
    && runtimePreview.storageAuditRequestId === providerPreview.storageAuditRequestId;
  if (storageComparable && !storageMatches) fail('RUNTIME_STORAGE_ISSUER_UNVERIFIED');

  return Object.freeze({
    providerProjects: 'DISTINCT_CANDIDATE',
    providerClusters: 'DISTINCT_CANDIDATE',
    runtimeDatabaseCluster: dbMatches ? 'MATCH_CANDIDATE' : 'NOT_ATTESTED',
    runtimeStorageKey: storageMatches ? 'MATCH_CANDIDATE' : 'NOT_ATTESTED',
    independentSourceAuthentication: 'NOT_IMPLEMENTED',
    ...RELEASE_HOLD
  });
}
module.exports = { EXPECTED, RELEASE_HOLD, assessCandidateEvidence };
