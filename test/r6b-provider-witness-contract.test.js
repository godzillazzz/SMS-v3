'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPECTED, RELEASE_HOLD, assessCandidateEvidence } =
  require('../scripts/ci/r6b-provider-witness-contract.cjs');
const PREVIEW_FP = 'a'.repeat(64);
const PRODUCTION_FP = 'b'.repeat(64);
const NONCE = 'f'.repeat(32);
function fixture() {
  return {
    providerPreview: {
      projectRef: EXPECTED.previewProjectRef,
      clusterFingerprintSha256: PREVIEW_FP,
      bucketName: EXPECTED.previewBucket, bucketPrivate: true,
      storageKeyIdentifier: 'preview_key_identifier',
      storageAuditRequestId: 'preview_audit_request'
    },
    providerProduction: {
      projectRef: EXPECTED.productionProjectRef,
      clusterFingerprintSha256: PRODUCTION_FP,
      bucketName: EXPECTED.productionBucket, bucketPrivate: true,
      storageKeyIdentifier: 'production_key_identifier',
      storageAuditRequestId: null
    },
    runtimePreview: {
      deploymentId: 'dpl_testImmutable1',
      applicationSha: 'c'.repeat(40), nonce: NONCE,
      clusterFingerprintSha256: PREVIEW_FP,
      storageKeyIdentifier: 'preview_key_identifier',
      storageAuditRequestId: 'preview_audit_request'
    }
  };
}
const clone = x => JSON.parse(JSON.stringify(x));
function reject(edit, code) {
  const f=fixture();edit(f);
  assert.throws(() => assessCandidateEvidence(f), new RegExp(code));
}
test('owner-confirmed Production mapping is distinct from Preview', () => {
  assert.equal(EXPECTED.productionProjectRef, 'jkexwnlxnxbemwavsebv');
  assert.equal(EXPECTED.previewProjectRef, 'ezxanpfagitckpfsnflp');
  assert.notEqual(EXPECTED.productionBucket, EXPECTED.previewBucket);
});
test('mock matched clusters/key correlation are never isolation PASS', () => {
  const result = assessCandidateEvidence(fixture());
  assert.equal(result.providerProjects,'DISTINCT_CANDIDATE');
  assert.equal(result.providerClusters,'DISTINCT_CANDIDATE');
  assert.equal(result.runtimeDatabaseCluster,'MATCH_CANDIDATE');
  assert.equal(result.runtimeStorageKey,'MATCH_CANDIDATE');
  assert.equal(result.independentSourceAuthentication,'NOT_IMPLEMENTED');
  for (const [key,value] of Object.entries(RELEASE_HOLD))
    assert.equal(result[key],value);
  assert.doesNotMatch(JSON.stringify(result), /"databaseIsolation":"PASS"/);
});
test('missing runtime cluster witness never gives DB PASS', () => {
  const f=fixture();f.runtimePreview.clusterFingerprintSha256=null;
  const result=assessCandidateEvidence(f);
  assert.equal(result.runtimeDatabaseCluster,'NOT_ATTESTED');
  assert.equal(result.databaseIsolation,'UNVERIFIED');
});
test('unavailable provider key IDs/audit receipts never give Storage PASS', () => {
  for (const change of [
    x=>x.providerPreview.storageKeyIdentifier=null,
    x=>x.providerPreview.storageAuditRequestId=null,
    x=>x.runtimePreview.storageKeyIdentifier=null,
    x=>x.runtimePreview.storageAuditRequestId=null,
    x=>x.providerProduction.storageKeyIdentifier=null
  ]) {
    const f=fixture();change(f);const r=assessCandidateEvidence(f);
    assert.equal(r.runtimeStorageKey,'NOT_ATTESTED');
    assert.equal(r.storageIsolation,'UNVERIFIED');
  }
});
test('reject same Production/Preview project or wrong expected ref', () => {
  reject(x=>x.providerProduction.projectRef=x.providerPreview.projectRef,
    'PRODUCTION_PROJECT_SCOPE_MISMATCH');
  reject(x=>x.providerPreview.projectRef='x'.repeat(20),'PREVIEW_PROJECT_SCOPE_MISMATCH');
});
test('reject identical database cluster witnesses', () => {
  reject(x=>x.providerProduction.clusterFingerprintSha256=PREVIEW_FP,
    'DATABASE_CLUSTER_COLLISION');
});
test('reject mismatching Runtime cluster', () => {
  reject(x=>x.runtimePreview.clusterFingerprintSha256=PRODUCTION_FP,
    'RUNTIME_DATABASE_CLUSTER_UNVERIFIED');
  reject(x=>x.runtimePreview.clusterFingerprintSha256='d'.repeat(64),
    'RUNTIME_DATABASE_CLUSTER_UNVERIFIED');
});
test('reject storage credentials claiming Production issuer or wrong audit correlation', () => {
  reject(x=>x.runtimePreview.storageKeyIdentifier='production_key_identifier',
    'RUNTIME_STORAGE_ISSUER_UNVERIFIED');
  reject(x=>x.runtimePreview.storageAuditRequestId='different_request_id',
    'RUNTIME_STORAGE_ISSUER_UNVERIFIED');
});
test('reject Production Storage bucket claim or public bucket metadata', () => {
  reject(x=>x.providerProduction.bucketName=EXPECTED.previewBucket,'PRODUCTION_PROJECT_SCOPE_MISMATCH');
  reject(x=>x.providerPreview.bucketPrivate=false,'PREVIEW_BUCKET_NOT_PRIVATE');
});
test('reject malformed fingerprint, nonce and Deployment', () => {
  reject(x=>x.providerPreview.clusterFingerprintSha256='raw-cluster-id',
    'PREVIEW_CLUSTER_EVIDENCE_UNVERIFIED');
  reject(x=>x.runtimePreview.nonce='wrong','RUNTIME_NONCE_EVIDENCE_UNVERIFIED');
  reject(x=>x.runtimePreview.deploymentId='production','RUNTIME_DEPLOYMENT_EVIDENCE_UNVERIFIED');
});
test('reject unknown fields and credential material', () => {
  for (const mut of [
    x=>x.providerPreview.secret='sb_secret_test',
    x=>x.providerProduction.rawConnectionString='postgresql://u:p@host/db',
    x=>x.runtimePreview.serviceRoleKey='test',
    x=>x.runtimePreview.previewClaimedProductionProjectRef=EXPECTED.productionProjectRef
  ]) reject(mut, '_EVIDENCE_SHAPE_UNVERIFIED');
});
test('empty or unverifiable witnesses never become PASS', () => {
  assert.throws(()=>assessCandidateEvidence({}),/PREVIEW_EVIDENCE_SHAPE_UNVERIFIED/);
  const f=fixture();f.providerPreview.storageAuditRequestId=null;
  const result=assessCandidateEvidence(clone(f));
  for (const [k,v] of Object.entries(RELEASE_HOLD)) assert.equal(result[k],v);
});
