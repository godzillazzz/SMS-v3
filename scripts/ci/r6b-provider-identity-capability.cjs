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
const HEX64 = /^[0-9a-f]{64}$/;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

function fail(reason) { throw new Error(reason); }
function exactKeys(value, keys, reason) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(reason);
}
function assertNoSecrets(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (/secret|token|password|jwt|apikey|authorization|rawurl|connectionstring|servicekey/i.test(key))
      fail('CREDENTIAL_FIELD_FORBIDDEN');
    assertNoSecrets(v);
  }
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
function parseCluster(record) {
  exactKeys(record, ['clusterFingerprintSha256','executingRole'], 'CLUSTER_WITNESS_SHAPE');
  assertNoSecrets(record);
  if (typeof record.clusterFingerprintSha256 !== 'string'
    || !HEX64.test(record.clusterFingerprintSha256)
    || typeof record.executingRole !== 'string'
    || !ROLE.test(record.executingRole)) fail('CLUSTER_WITNESS_INVALID');
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
async function inspectOne(adapter, expected) {
  assertScopedClient(adapter);
  // A real adapter must authenticate against its own expected Project scope;
  // no supplied metadata string can prove it did so.
  const project = parseProject(await adapter.getProjectMetadata(), expected);
  const bucket = parseBucket(await adapter.getPrivateBucketMetadata(expected.bucket), expected);
  const witness = parseCluster(await adapter.getProviderClusterWitness(PG_READONLY_CLUSTER_SQL));
  const capability = parseRoleCapability(
    await adapter.getManagementRoleCapability(PG_ROLE_CAPABILITY_SQL));
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
async function inspectProviderIdentityCapabilities({ previewClient, productionClient } = {}) {
  const preview = await inspectOne(previewClient, PROJECT.preview);
  const production = await inspectOne(productionClient, PROJECT.production);
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
module.exports = {
  PROJECT, PG_ROLE_CAPABILITY_SQL, PG_READONLY_CLUSTER_SQL,
  inspectProviderIdentityCapabilities
};
