'use strict';

const PREVIEW_PROJECT_REF = 'ezxanpfagitckpfsnflp';
const PREVIEW_BUCKET = 'license-documents-g05-preview';
const RUNTIME_ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const CLUSTER_FINGERPRINT = /^[0-9a-f]{64}$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function ensure(condition, code) {
  if (!condition) fail(code);
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function verifyRuntimeReceipt(receipt, plan, nonce, provenance) {
  ensure(provenance?.deploymentVerified === true, 'DEPLOYMENT_PROVENANCE_REQUIRED');
  ensure(hasExactKeys(receipt, [
    'contract', 'nonce', 'deploymentId', 'applicationSha', 'vercelProjectId',
    'gitCommitRef', 'signedChallengeIdentity', 'database', 'storage'
  ]), 'RUNTIME_RECEIPT_FIELDS_UNTRUSTED');
  ensure(receipt.contract === 'sms-v3-preview-isolation/v3'
    && receipt.nonce === nonce
    && /^[a-f0-9]{32}$/.test(nonce || '')
    && receipt.deploymentId === plan.deploymentId
    && receipt.applicationSha === plan.integrationSha
    && receipt.vercelProjectId === plan.projectId
    && receipt.gitCommitRef === plan.integrationRef,
  'RUNTIME_PROBE_IDENTITY_UNVERIFIED');

  const database = receipt.database;
  const challenge = receipt.signedChallengeIdentity;
  ensure(hasExactKeys(challenge, [
    'host', 'deploymentId', 'applicationSha', 'nonce', 'issuedAt', 'signatureVerified'
  ])
    && typeof challenge.host === 'string'
    && /^[a-z0-9][a-z0-9.-]+\.vercel\.app$/.test(challenge.host)
    && challenge.deploymentId === receipt.deploymentId
    && challenge.applicationSha === receipt.applicationSha
    && challenge.nonce === receipt.nonce
    && Number.isSafeInteger(challenge.issuedAt)
    && challenge.signatureVerified === true,
  'RUNTIME_CHALLENGE_IDENTITY_UNVERIFIED');
  ensure(hasExactKeys(database, [
    'configuredDatabaseProjectRef', 'configuredDirectProjectRef',
    'configuredDatabaseName', 'observedDatabaseName', 'runtimePrincipal',
    'runtimeClusterFingerprintSha256', 'targetGuardMatched',
    'databaseReadOnlyQuerySucceeded', 'transactionReadOnly', 'runtimeWitnessVerified'
  ]), 'RUNTIME_RECEIPT_FIELDS_UNTRUSTED');
  ensure(database.configuredDatabaseProjectRef === PREVIEW_PROJECT_REF
    && database.configuredDirectProjectRef === PREVIEW_PROJECT_REF
    && typeof database.configuredDatabaseName === 'string'
    && database.configuredDatabaseName.length > 0
    && database.observedDatabaseName === database.configuredDatabaseName
    && database.targetGuardMatched === true
    && database.databaseReadOnlyQuerySucceeded === true,
  'RUNTIME_DATABASE_CHECK_UNVERIFIED');
  ensure(database.transactionReadOnly === true
    && database.runtimeWitnessVerified === true
    && typeof database.runtimePrincipal === 'string'
    && RUNTIME_ROLE.test(database.runtimePrincipal)
    && typeof database.runtimeClusterFingerprintSha256 === 'string'
    && CLUSTER_FINGERPRINT.test(database.runtimeClusterFingerprintSha256),
  'RUNTIME_DATABASE_WITNESS_UNVERIFIED');

  const storage = receipt.storage;
  ensure(hasExactKeys(storage, [
    'configuredEndpointProjectRef', 'bucket',
    'privateBucketMetadataReadSucceeded', 'bucketIsPrivate'
  ]), 'RUNTIME_RECEIPT_FIELDS_UNTRUSTED');
  ensure(storage.configuredEndpointProjectRef === PREVIEW_PROJECT_REF
    && storage.bucket === PREVIEW_BUCKET
    && storage.privateBucketMetadataReadSucceeded === true
    && storage.bucketIsPrivate === true,
  'RUNTIME_STORAGE_METADATA_UNVERIFIED');

  // URL-derived refs and endpoint acceptance are useful checks, not provider attestations.
  // This contract has no independent provider evidence for the effective Database/Storage
  // project identity or Production targets, so it must never return isolation PASS.
  return {
    deploymentIdentity: 'PASS',
    configuredDatabaseTarget: 'MATCH',
    databaseReadOnlyCheck: 'PASS',
    databaseIsolation: 'UNVERIFIED',
    configuredStorageEndpoint: 'MATCH',
    privateBucketMetadataGet: 'PASS',
    storageIsolation: 'UNVERIFIED',
    productionSeparation: 'UNVERIFIED'
  };
}

module.exports = { PREVIEW_PROJECT_REF, PREVIEW_BUCKET, verifyRuntimeReceipt };
