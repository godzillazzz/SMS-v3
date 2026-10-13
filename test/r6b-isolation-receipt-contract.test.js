'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PREVIEW_PROJECT_REF,
  PREVIEW_BUCKET,
  verifyRuntimeReceipt
} = require('../scripts/ci/r6b-isolation-receipt-contract');

const nonce = 'b'.repeat(32);
const plan = {
  deploymentId: 'dpl_NewPreviewDeployment007',
  integrationSha: '7'.repeat(40),
  projectId: 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  integrationRef: 'fix/serverless-database-reliability'
};
const deploymentProvenance = { deploymentVerified: true };

function receipt() {
  return {
    contract: 'sms-v3-preview-isolation/v3',
    nonce,
    deploymentId: plan.deploymentId,
    applicationSha: plan.integrationSha,
    vercelProjectId: plan.projectId,
    gitCommitRef: plan.integrationRef,
    signedChallengeIdentity: {
      host: 'sms-v3-staging-preview.vercel.app',
      deploymentId: plan.deploymentId,
      applicationSha: plan.integrationSha,
      nonce,
      issuedAt: 1760000000000,
      signatureVerified: true
    },
    database: {
      configuredDatabaseProjectRef: PREVIEW_PROJECT_REF,
      configuredDirectProjectRef: PREVIEW_PROJECT_REF,
      configuredDatabaseName: 'postgres',
      observedDatabaseName: 'postgres',
      runtimePrincipal: 'postgres',
      runtimeClusterFingerprintSha256: 'a'.repeat(64),
      targetGuardMatched: true,
      databaseReadOnlyQuerySucceeded: true,
      transactionReadOnly: true,
      runtimeWitnessVerified: true
    },
    storage: {
      configuredEndpointProjectRef: PREVIEW_PROJECT_REF,
      bucket: PREVIEW_BUCKET,
      privateBucketMetadataReadSucceeded: true,
      bucketIsPrivate: true
    }
  };
}

function verify(value = receipt(), provenance = deploymentProvenance) {
  return verifyRuntimeReceipt(value, plan, nonce, provenance);
}

test('accepts exact deployment and reports read-only checks without claiming isolation PASS', () => {
  assert.deepEqual(verify(), {
    deploymentIdentity: 'PASS',
    configuredDatabaseTarget: 'MATCH',
    databaseReadOnlyCheck: 'PASS',
    databaseIsolation: 'UNVERIFIED',
    configuredStorageEndpoint: 'MATCH',
    privateBucketMetadataGet: 'PASS',
    storageIsolation: 'UNVERIFIED',
    productionSeparation: 'UNVERIFIED'
  });
});

test('fails closed on wrong deployment, SHA, project, branch, nonce or missing deployment provenance', () => {
  const cases = [
    [x => { x.deploymentId = 'dpl_Other'; }, 'RUNTIME_PROBE_IDENTITY_UNVERIFIED'],
    [x => { x.applicationSha = '8'.repeat(40); }, 'RUNTIME_PROBE_IDENTITY_UNVERIFIED'],
    [x => { x.vercelProjectId = 'prj_Other'; }, 'RUNTIME_PROBE_IDENTITY_UNVERIFIED'],
    [x => { x.gitCommitRef = 'untrusted'; }, 'RUNTIME_PROBE_IDENTITY_UNVERIFIED'],
    [x => { x.nonce = 'c'.repeat(32); }, 'RUNTIME_PROBE_IDENTITY_UNVERIFIED']
  ];
  for (const [mutate, code] of cases) {
    const value = receipt(); mutate(value);
    assert.throws(() => verify(value), error => error.code === code);
  }
  assert.throws(
    () => verify(receipt(), { deploymentVerified: false }),
    error => error.code === 'DEPLOYMENT_PROVENANCE_REQUIRED'
  );
});

test('distinguishes configured Database URL refs from the observed read-only database check', () => {
  const cases = [
    x => { x.database.configuredDatabaseProjectRef = 'otherref12345678901234'; },
    x => { x.database.configuredDirectProjectRef = 'otherref12345678901234'; },
    x => { x.database.observedDatabaseName = 'differentdb'; },
    x => { x.database.targetGuardMatched = false; },
    x => { x.database.databaseReadOnlyQuerySucceeded = false; }
  ];
  for (const mutate of cases) {
    const value = receipt(); mutate(value);
    assert.throws(() => verify(value), error => error.code === 'RUNTIME_DATABASE_CHECK_UNVERIFIED');
  }
});

test('accepts only the private-bucket metadata GET claim, not a credential project claim', () => {
  const cases = [
    x => { x.storage.configuredEndpointProjectRef = 'otherref12345678901234'; },
    x => { x.storage.bucket = 'production-bucket'; },
    x => { x.storage.privateBucketMetadataReadSucceeded = false; },
    x => { x.storage.bucketIsPrivate = false; }
  ];
  for (const mutate of cases) {
    const value = receipt(); mutate(value);
    assert.throws(() => verify(value), error => error.code === 'RUNTIME_STORAGE_METADATA_UNVERIFIED');
  }
  const credentialClaim = receipt();
  credentialClaim.storage.credentialProjectRef = PREVIEW_PROJECT_REF;
  assert.throws(() => verify(credentialClaim), error => error.code === 'RUNTIME_RECEIPT_FIELDS_UNTRUSTED');
});

test('editable Production refs cannot turn unverified Preview identities into isolation PASS', () => {
  const output = verify(receipt(), {
    deploymentVerified: true,
    approvedProductionDatabaseRef: 'prodref12345678901234',
    approvedProductionStorageRef: 'prodstore1234567890123'
  });
  assert.equal(output.databaseIsolation, 'UNVERIFIED');
  assert.equal(output.storageIsolation, 'UNVERIFIED');
  assert.equal(output.productionSeparation, 'UNVERIFIED');
});

test('rejects Preview-supplied Production claims and secret-bearing receipt fields', () => {
  const productionClaim = receipt();
  productionClaim.productionDatabaseRef = 'prodref12345678901234';
  assert.throws(() => verify(productionClaim), error => error.code === 'RUNTIME_RECEIPT_FIELDS_UNTRUSTED');
  const secretClaim = receipt();
  secretClaim.storage.serviceRoleKey = 'TEST_ONLY_REDACTED_SECRET';
  assert.throws(() => verify(secretClaim), error => error.code === 'RUNTIME_RECEIPT_FIELDS_UNTRUSTED');
});
