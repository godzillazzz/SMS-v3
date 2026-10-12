'use strict';

const PREVIEW_PROJECT_REF = 'ezxanpfagitckpfsnflp';
const PREVIEW_BUCKET = 'license-documents-g05-preview';

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
    'gitCommitRef', 'database', 'storage'
  ]), 'RUNTIME_RECEIPT_FIELDS_UNTRUSTED');
  ensure(receipt.contract === 'sms-v3-preview-isolation/v2'
    && receipt.nonce === nonce
    && /^[a-f0-9]{32}$/.test(nonce || '')
    && receipt.deploymentId === plan.deploymentId
    && receipt.applicationSha === plan.integrationSha
    && receipt.vercelProjectId === plan.projectId
    && receipt.gitCommitRef === plan.integrationRef,
  'RUNTIME_PROBE_IDENTITY_UNVERIFIED');

  const database = receipt.database;
  ensure(hasExactKeys(database, [
    'configuredDatabaseProjectRef', 'configuredDirectProjectRef',
    'configuredDatabaseName', 'observedDatabaseName', 'targetGuardMatched',
    'databaseReadOnlyQuerySucceeded'
  ]), 'RUNTIME_RECEIPT_FIELDS_UNTRUSTED');
  ensure(database.configuredDatabaseProjectRef === PREVIEW_PROJECT_REF
    && database.configuredDirectProjectRef === PREVIEW_PROJECT_REF
    && typeof database.configuredDatabaseName === 'string'
    && database.configuredDatabaseName.length > 0
    && database.observedDatabaseName === database.configuredDatabaseName
    && database.targetGuardMatched === true
    && database.databaseReadOnlyQuerySucceeded === true,
  'RUNTIME_DATABASE_CHECK_UNVERIFIED');

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
