'use strict';

/**
 * R6-B independent Supabase provider identity inspection — DRAFT ONLY.
 * This module accepts two independently scoped, read-only adapter instances
 * (one per Supabase project). It makes no network requests on its own and
 * cannot authenticate a callback's provenance. Never connect its output to
 * a release gate or use it to trigger the protected Runtime Probe.
 */
const { EXPECTED, RELEASE_HOLD } = require('./r6b-provider-witness-contract.cjs');

const PROJECT = Object.freeze({
  preview: Object.freeze({
    ref: EXPECTED.previewProjectRef,
    name: 'sms-v3-preview',
    databaseHost: 'db.ezxanpfagitckpfsnflp.supabase.co',
    bucket: EXPECTED.previewBucket
  }),
  production: Object.freeze({
    ref: EXPECTED.productionProjectRef,
    name: 'sms-v3-development', // Owner-confirmed Production despite name.
    databaseHost: 'db.jkexwnlxnxbemwavsebv.supabase.co',
    bucket: EXPECTED.productionBucket
  })
});

// SQL templates only. This module never executes SQL.
// pg_control_system() may be unavailable for an effective Prisma role.
// No role grants or privileged role impersonation are permitted.
const PG_ROLE_CAPABILITY_SQL =
  "SELECT current_user AS executing_role, " +
  "has_function_privilege(current_user, 'pg_catalog.pg_control_system()', 'EXECUTE') " +
  "AS may_read_cluster_identity";
const PG_READONLY_CLUSTER_SQL =
  "SELECT encode(sha256(convert_to((pg_control_system()).system_identifier::text,'UTF8')),'hex') " +
  "AS cluster_fingerprint_sha256, current_user AS executing_role";
const PG_ENFORCE_READ_ONLY_SQL = 'SET TRANSACTION READ ONLY';
const PG_VERIFY_READ_ONLY_SQL = 'SHOW transaction_read_only';
const PG_RUNTIME_CLUSTER_SQL = PG_READONLY_CLUSTER_SQL;
const HEX64 = /^[0-9a-f]{64}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const APPLICATION_SHA = /^[a-f0-9]{40}$/;
const MAX_EVIDENCE_AGE_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;

const STORAGE_CREDENTIAL_ISSUER_ATTESTATION = Object.freeze({
  status: 'UNAVAILABLE_WITH_NONSECRET_METADATA',
  providerDocumentedIssuerBindingFound: false,
  rawKeyApiPermitted: false,
  bucketMetadataProvesIssuer: false,
  endpointProjectRefProvesIssuer: false
});

function fail(reason) { throw new Error(reason); }
function exactKeys(value, keys, reason) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(reason);
}
function assertNoSecrets(value) {
  if (typeof value === 'string'
    && /(?:postgres(?:ql)?:\/\/|sb_secret_|\bBearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i.test(value)) {
    fail('CREDENTIAL_VALUE_FORBIDDEN');
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (/secret|token|password|jwt|apikey|authorization|rawurl|connectionstring|servicekey/i.test(key))
      fail('CREDENTIAL_FIELD_FORBIDDEN');
    assertNoSecrets(v);
  }
}
function assertFresh(observedAtMs, nowMs, maxEvidenceAgeMs, reason) {
  if (!Number.isSafeInteger(observedAtMs) || !Number.isSafeInteger(nowMs)
    || !Number.isSafeInteger(maxEvidenceAgeMs) || maxEvidenceAgeMs <= 0
    || maxEvidenceAgeMs > MAX_EVIDENCE_AGE_MS
    || observedAtMs > nowMs + CLOCK_SKEW_MS
    || nowMs - observedAtMs > maxEvidenceAgeMs) fail(reason);
}
function parseProject(record, expected) {
  exactKeys(record, ['id','name','status','databaseHost'], 'PROJECT_METADATA_SHAPE');
  assertNoSecrets(record);
  if (record.id !== expected.ref || record.name !== expected.name
      || record.databaseHost !== expected.databaseHost
      || record.status !== 'ACTIVE_HEALTHY') fail('PROJECT_PROVIDER_RECORD_MISMATCH');
  return { projectRef: record.id, databaseHost: record.databaseHost };
}
function parseBucket(bucket, expected) {
  exactKeys(bucket, ['id','public'], 'BUCKET_METADATA_SHAPE');
  assertNoSecrets(bucket);
  if (bucket.id !== expected.bucket || bucket.public !== false) fail('PRIVATE_BUCKET_UNVERIFIED');
  return { bucket: bucket.id, bucketPrivate: true };
}
function parseCluster(record, nowMs, maxEvidenceAgeMs) {
  exactKeys(record, ['clusterFingerprintSha256','executingRole','observedAtMs'],
    'CLUSTER_WITNESS_SHAPE');
  assertNoSecrets(record);
  if (typeof record.clusterFingerprintSha256 !== 'string'
    || !HEX64.test(record.clusterFingerprintSha256)
    || typeof record.executingRole !== 'string'
    || !ROLE.test(record.executingRole)) fail('CLUSTER_WITNESS_INVALID');
  assertFresh(record.observedAtMs, nowMs, maxEvidenceAgeMs, 'CLUSTER_WITNESS_STALE');
  return record;
}
function parseRoleCapability(record) {
  exactKeys(record, ['executingRole','mayReadClusterIdentity'], 'ROLE_CAPABILITY_SHAPE');
  assertNoSecrets(record);
  if (typeof record.executingRole !== 'string' || !ROLE.test(record.executingRole)
    || typeof record.mayReadClusterIdentity !== 'boolean') fail('ROLE_CAPABILITY_INVALID');
  return record;
}
function assertScopedClient(adapter) {
  exactKeys(adapter, ['getProjectMetadata','getPrivateBucketMetadata',
    'getProviderClusterWitness','getManagementRoleCapability'], 'READONLY_ADAPTER_REQUIRED');
  for (const method of Object.values(adapter))
    if (typeof method !== 'function') fail('READONLY_ADAPTER_REQUIRED');
}
async function inspectOne(adapter, expected, nowMs, maxEvidenceAgeMs) {
  assertScopedClient(adapter);
  // A real adapter must authenticate against its own expected Project scope;
  // no supplied metadata string can prove it did so.
  const project = parseProject(await adapter.getProjectMetadata(), expected);
  const bucket = parseBucket(await adapter.getPrivateBucketMetadata(expected.bucket), expected);
  const witness = parseCluster(await adapter.getProviderClusterWitness(PG_READONLY_CLUSTER_SQL),
    nowMs, maxEvidenceAgeMs);
  const capability = parseRoleCapability(
    await adapter.getManagementRoleCapability(PG_ROLE_CAPABILITY_SQL));
  // A capability check under one SQL principal cannot validate a witness
  // measured under another. This is only a consistency check; adapter
  // provenance and the effective Prisma principal remain UNVERIFIED.
  if (witness.executingRole !== capability.executingRole)
    fail('PROVIDER_ROLE_WITNESS_MISMATCH');
  return { ...project, ...bucket,
    clusterFingerprintSha256: witness.clusterFingerprintSha256,
    clusterWitnessQueryRole: witness.executingRole,
    providerManagementRoleCanReadCluster: capability.mayReadClusterIdentity,
    managementCapabilityQueryRole: capability.executingRole };
}

/**
 * Capability review only. Provider callbacks are injected and mockable.
 * API key management endpoints are deliberately NOT called: some APIs can
 * return secret material. Storage issuer binding is NOT_IMPLEMENTED.
 */
async function inspectProviderIdentityCapabilities({ previewClient, productionClient,
  nowMs = Date.now(), maxEvidenceAgeMs = MAX_EVIDENCE_AGE_MS } = {}) {
  const preview = await inspectOne(previewClient, PROJECT.preview, nowMs, maxEvidenceAgeMs);
  const production = await inspectOne(productionClient, PROJECT.production, nowMs,
    maxEvidenceAgeMs);
  if (preview.projectRef === production.projectRef) fail('PROJECT_ID_COLLISION');
  if (preview.clusterFingerprintSha256 === production.clusterFingerprintSha256)
    fail('CLUSTER_ID_COLLISION');
  // Only non-secret, non-authoritative information can leave the inspector.
  const withoutHash = item => ({
    projectRef: item.projectRef, databaseHost: item.databaseHost,
    bucket: item.bucket, bucketPrivate: item.bucketPrivate,
    clusterFingerprintObserved: true,
    managementRoleCapability: item.providerManagementRoleCanReadCluster,
    // This management role is NOT necessarily the effective app Runtime role.
    effectivePrismaRole: 'UNVERIFIED'
  });
  return {
    preview: withoutHash(preview),
    production: withoutHash(production),
    providerProjectsDistinct: true,
    providerClusterWitnessesDistinct: true,
    effectiveRuntimePrismaClusterBinding: 'UNVERIFIED',
    storageCredentialIssuerMetadata: 'NOT_AVAILABLE_IN_CURRENT_READONLY_CONNECTOR',
    storageApiKeyEndpointInvoked: false,
    independentSourceAuthentication: 'ADAPTER_BOUNDARY_UNVERIFIED',
    ...RELEASE_HOLD
  };
}

/**
 * MOCK-ONLY Prisma Runtime Principal witness scaffold.
 *
 * The injected object must be the same Prisma client used by the future
 * Preview runtime. The fixed SET command is the first statement inside the
 * interactive transaction. Tests use a mock; this PR performs no SQL.
 * This result remains candidate evidence and cannot change a release gate.
 */
async function collectPrismaRuntimeWitness({ prisma, expectedRole, deploymentId,
  applicationSha, issuedAtMs, nowMs = Date.now(),
  maxEvidenceAgeMs = MAX_EVIDENCE_AGE_MS } = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') fail('PRISMA_RUNTIME_REQUIRED');
  if (typeof expectedRole !== 'string' || !ROLE.test(expectedRole))
    fail('EXPECTED_RUNTIME_ROLE_INVALID');
  if (typeof deploymentId !== 'string' || !DEPLOYMENT.test(deploymentId))
    fail('RUNTIME_DEPLOYMENT_INVALID');
  if (typeof applicationSha !== 'string' || !APPLICATION_SHA.test(applicationSha))
    fail('RUNTIME_SHA_INVALID');
  assertFresh(issuedAtMs, nowMs, maxEvidenceAgeMs, 'RUNTIME_EVIDENCE_STALE');

  const observed = await prisma.$transaction(async tx => {
    if (!tx || typeof tx.$executeRawUnsafe !== 'function'
      || typeof tx.$queryRawUnsafe !== 'function') fail('PRISMA_TRANSACTION_REQUIRED');
    await tx.$executeRawUnsafe(PG_ENFORCE_READ_ONLY_SQL);
    const modeRows = await tx.$queryRawUnsafe(PG_VERIFY_READ_ONLY_SQL);
    if (!Array.isArray(modeRows) || modeRows.length !== 1) fail('READ_ONLY_MODE_UNVERIFIED');
    exactKeys(modeRows[0], ['transaction_read_only'], 'READ_ONLY_MODE_SHAPE');
    if (modeRows[0].transaction_read_only !== 'on') fail('READ_ONLY_MODE_UNVERIFIED');
    const witnessRows = await tx.$queryRawUnsafe(PG_RUNTIME_CLUSTER_SQL);
    if (!Array.isArray(witnessRows) || witnessRows.length !== 1)
      fail('RUNTIME_WITNESS_MISSING');
    exactKeys(witnessRows[0], ['cluster_fingerprint_sha256','executing_role'],
      'RUNTIME_WITNESS_SHAPE');
    assertNoSecrets(witnessRows[0]);
    return parseCluster({
      clusterFingerprintSha256: witnessRows[0].cluster_fingerprint_sha256,
      executingRole: witnessRows[0].executing_role,
      observedAtMs: nowMs
    }, nowMs, maxEvidenceAgeMs);
  }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 5000 });

  if (observed.executingRole !== expectedRole) fail('RUNTIME_PRINCIPAL_MISMATCH');
  const result = Object.freeze({
    deploymentId,
    applicationSha,
    executingRole: observed.executingRole,
    clusterFingerprintSha256: observed.clusterFingerprintSha256,
    transactionReadOnly: true,
    observedAtMs: nowMs,
    evidenceAuthority: 'MOCK_ONLY_RUNTIME_CANDIDATE',
    ...RELEASE_HOLD
  });
  assertNoSecrets(result);
  return result;
}
module.exports = {
  PROJECT, PG_ROLE_CAPABILITY_SQL, PG_READONLY_CLUSTER_SQL,
  PG_ENFORCE_READ_ONLY_SQL, PG_VERIFY_READ_ONLY_SQL, PG_RUNTIME_CLUSTER_SQL,
  STORAGE_CREDENTIAL_ISSUER_ATTESTATION,
  inspectProviderIdentityCapabilities, collectPrismaRuntimeWitness
};
