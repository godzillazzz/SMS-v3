'use strict';
const { fail } = require('./config');
const { targetFingerprint } = require('../../src/utils/database-target-identity');

const PREVIEW_REF = 'ezxanpfagitckpfsnflp';
const EXPECTED_BUCKET = 'license-documents-g05-preview';
const HEX64 = /^[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const NONCE = /^[0-9a-f]{32}$/;
function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

// Accept only a signed-challenge identity and a direct, transaction-read-only
// runtime witness from the pinned immutable Preview deployment. Never use
// mutable project-level Vercel settings or caller assertions as evidence.
function verifyRuntimeIsolation(target, receipt, expected) {
  if (target?.authorized !== true || target?.database_isolation_verified !== true) fail('UAT_ISOLATION_NOT_AUTHORIZED');
  if (!exactKeys(receipt, [
    'contract', 'nonce', 'deploymentId', 'applicationSha', 'vercelProjectId',
    'gitCommitRef', 'signedChallengeIdentity', 'database', 'storage'
  ]) || receipt.contract !== 'sms-v3-preview-isolation/v3'
    || !NONCE.test(expected?.nonce || '') || receipt.nonce !== expected.nonce
    || !SHA.test(expected?.sha || '') || receipt.applicationSha !== expected.sha
    || receipt.deploymentId !== expected.deploymentId
    || receipt.gitCommitRef !== expected.ref
    || receipt.vercelProjectId !== 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s') {
    fail('UAT_SIGNED_RUNTIME_IDENTITY_UNVERIFIED');
  }
  const challenge = receipt.signedChallengeIdentity;
  if (!exactKeys(challenge, ['host', 'deploymentId', 'applicationSha', 'nonce', 'issuedAt', 'signatureVerified'])
    || challenge.signatureVerified !== true || challenge.host !== expected.host
    || challenge.deploymentId !== expected.deploymentId
    || challenge.applicationSha !== expected.sha || challenge.nonce !== expected.nonce
    || challenge.issuedAt !== expected.issuedAt) fail('UAT_SIGNED_CHALLENGE_UNVERIFIED');

  const db = receipt.database;
  if (!exactKeys(db, [
    'configuredDatabaseProjectRef', 'configuredDirectProjectRef',
    'configuredDatabaseName', 'observedDatabaseName', 'runtimePrincipal',
    'runtimeClusterFingerprintSha256',
    'targetGuardMatched', 'databaseReadOnlyQuerySucceeded', 'transactionReadOnly',
    'runtimeWitnessVerified'
  ]) || db.configuredDatabaseProjectRef !== PREVIEW_REF
    || db.configuredDirectProjectRef !== PREVIEW_REF
    || db.configuredDatabaseName !== 'postgres' || db.observedDatabaseName !== 'postgres'
    || db.runtimePrincipal !== target.preview_runtime_principal
    || !/^[a-z_][a-z0-9_]{0,62}$/.test(target.preview_runtime_principal || '')
    || db.targetGuardMatched !== true || db.databaseReadOnlyQuerySucceeded !== true
    || db.transactionReadOnly !== true || db.runtimeWitnessVerified !== true
    || target.database_target_fingerprint !== targetFingerprint({ provider: 'supabase', projectRef: PREVIEW_REF, database: 'postgres' })
    || !HEX64.test(db.runtimeClusterFingerprintSha256 || '')
    || db.runtimeClusterFingerprintSha256 !== target.preview_database_cluster_fingerprint_sha256) {
    fail('UAT_RUNTIME_DATABASE_WITNESS_UNVERIFIED');
  }
  if (!HEX64.test(target.production_database_target_fingerprint || '')
    || target.production_database_target_fingerprint === target.database_target_fingerprint
    || !HEX64.test(target.production_database_cluster_fingerprint_sha256 || '')
    || target.production_database_cluster_fingerprint_sha256 === db.runtimeClusterFingerprintSha256) {
    fail('UAT_PRODUCTION_DATABASE_NOT_DISTINCT');
  }
  const storage = receipt.storage;
  if (!exactKeys(storage, [
    'configuredEndpointProjectRef', 'bucket', 'privateBucketMetadataReadSucceeded', 'bucketIsPrivate'
  ]) || storage.configuredEndpointProjectRef !== PREVIEW_REF
    || storage.bucket !== EXPECTED_BUCKET
    || storage.privateBucketMetadataReadSucceeded !== true
    || storage.bucketIsPrivate !== true) fail('UAT_PREVIEW_STORAGE_UNVERIFIED');

  return { approvedFingerprintMatch: true, productionDistinct: true, runtimeReadiness: 'PASS' };
}

module.exports = { verifyRuntimeIsolation };
