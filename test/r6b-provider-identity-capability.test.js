'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROJECT, PG_ROLE_CAPABILITY_SQL, PG_READONLY_CLUSTER_SQL,
  PG_ENFORCE_READ_ONLY_SQL, PG_VERIFY_READ_ONLY_SQL, PG_RUNTIME_CLUSTER_SQL,
  STORAGE_CREDENTIAL_ISSUER_ATTESTATION,
  inspectProviderIdentityCapabilities: inspect,
  collectPrismaRuntimeWitness
} = require('../scripts/ci/r6b-provider-identity-capability.cjs');

const NOW = 1791849600000;

function makeClient(expected, fingerprint, managementRole='postgres', observedAtMs=NOW) {
  const stats = {calls:[], dbReads:0, storageReads:0, secretReads:0};
  const client = {
    async getProjectMetadata() {
      stats.calls.push('project');
      return {id:expected.ref,name:expected.name,status:'ACTIVE_HEALTHY',
        databaseHost:expected.databaseHost};
    },
    async getPrivateBucketMetadata(bucket) {
      stats.calls.push('bucket');
      assert.equal(bucket,expected.bucket);
      return {id:expected.bucket,public:false};
    },
    async getProviderClusterWitness(sql) {
      stats.calls.push('cluster');
      assert.equal(sql,PG_READONLY_CLUSTER_SQL);
      assert.match(sql,/pg_control_system/);
      assert.match(sql,/sha256/);
      assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i);
      return {clusterFingerprintSha256:fingerprint,executingRole:managementRole,observedAtMs};
    },
    async getManagementRoleCapability(sql) {
      stats.calls.push('capability');
      assert.equal(sql,PG_ROLE_CAPABILITY_SQL);
      assert.match(sql,/has_function_privilege/);
      return {executingRole:managementRole,mayReadClusterIdentity:true};
    }
  };
  return {client,stats};
}
function setup(){
  const preview=makeClient(PROJECT.preview,'a'.repeat(64));
  const production=makeClient(PROJECT.production,'b'.repeat(64));
  return { preview, production,
    args:{previewClient:preview.client,productionClient:production.client,nowMs:NOW}};
}
test('Owner Production designation is encoded without aliasing Preview',()=>{
  assert.equal(PROJECT.production.ref,'jkexwnlxnxbemwavsebv');
  assert.equal(PROJECT.preview.ref,'ezxanpfagitckpfsnflp');
  assert.equal(PROJECT.production.name,'sms-v3-development');
});
test('provider-scoped metadata and cluster only give capability review',async()=>{
  const {args,preview,production}=setup();
  const result=await inspect(args);
  assert.deepEqual(result.preview,{
    projectRef:PROJECT.preview.ref,databaseHost:PROJECT.preview.databaseHost,
    bucket:PROJECT.preview.bucket,bucketPrivate:true,clusterFingerprintObserved:true,
    managementRoleCapability:true,effectivePrismaRole:'UNVERIFIED'
  });
  assert.equal(result.providerProjectsDistinct,true);
  assert.equal(result.providerClusterWitnessesDistinct,true);
  assert.equal(result.effectiveRuntimePrismaClusterBinding,'UNVERIFIED');
  assert.equal(result.storageCredentialIssuerMetadata,'NOT_AVAILABLE_IN_CURRENT_READONLY_CONNECTOR');
  assert.equal(result.independentSourceAuthentication,'ADAPTER_BOUNDARY_UNVERIFIED');
  assert.equal(result.databaseIsolation,'UNVERIFIED');
  assert.equal(result.storageIsolation,'UNVERIFIED');
  assert.equal(result.productionSeparation,'UNVERIFIED');
  assert.equal(result.r6bRelease,'HOLD');
  assert.equal(result.storageApiKeyEndpointInvoked,false);
  for(const x of [preview,production])
    assert.deepEqual(x.stats.calls,['project','bucket','cluster','capability']);
  assert.doesNotMatch(JSON.stringify(result),/[ab]{64}/);
});
test('refuse wrong provider project',async()=>{
  const {args}=setup();
  args.productionClient.getProjectMetadata=async()=>({
    id:PROJECT.preview.ref,name:PROJECT.production.name,status:'ACTIVE_HEALTHY',
    databaseHost:PROJECT.production.databaseHost
  });
  await assert.rejects(()=>inspect(args),/PROJECT_PROVIDER_RECORD_MISMATCH/);
});
test('reject same cluster witness',async()=>{
  const {args}=setup();
  args.productionClient.getProviderClusterWitness=async()=>({
    clusterFingerprintSha256:'a'.repeat(64),executingRole:'postgres',observedAtMs:NOW});
  await assert.rejects(()=>inspect(args),/CLUSTER_ID_COLLISION/);
});
test('refuse any secret, connection string or unknown field',async()=>{
  for(const bad of [
    {field:'password',value:'not-a-real-secret'},
    {field:'apiKey',value:'test'},
    {field:'connectionString',value:'postgres://fake'},
    {field:'claimedProductionRef',value:PROJECT.production.ref}
  ]){
    const {args}=setup();
    const orig=args.previewClient.getProjectMetadata;
    args.previewClient.getProjectMetadata=async()=>({...await orig(),[bad.field]:bad.value});
    await assert.rejects(()=>inspect(args),/PROJECT_METADATA_SHAPE/);
  }
});
test('reject private bucket metadata that is public',async()=>{
  const {args}=setup();
  args.previewClient.getPrivateBucketMetadata=async()=>({
    id:PROJECT.preview.bucket,public:true});
  await assert.rejects(()=>inspect(args),/PRIVATE_BUCKET_UNVERIFIED/);
});
test('reject invalid cluster digest and malformed role',async()=>{
  const {args}=setup();
  args.previewClient.getProviderClusterWitness=async()=>({
    clusterFingerprintSha256:'not-a-digest',executingRole:'postgres',observedAtMs:NOW});
  await assert.rejects(()=>inspect(args),/CLUSTER_WITNESS_INVALID/);
  const other=setup();
  other.args.previewClient.getManagementRoleCapability=async()=>({
    executingRole:'postgres; DROP TABLE users',mayReadClusterIdentity:true});
  await assert.rejects(()=>inspect(other.args),/ROLE_CAPABILITY_INVALID/);
});

function makePrismaRuntime({ role='prisma_runtime', fingerprint='c'.repeat(64),
  readOnly='on', includeWitness=true, credentialField=false } = {}) {
  const calls=[];
  const tx={
    async $executeRawUnsafe(sql){ calls.push(['execute',sql]); return 0; },
    async $queryRawUnsafe(sql){
      calls.push(['query',sql]);
      if(sql===PG_VERIFY_READ_ONLY_SQL) return [{transaction_read_only:readOnly}];
      if(sql===PG_RUNTIME_CLUSTER_SQL) {
        if(!includeWitness) return [];
        const row={cluster_fingerprint_sha256:fingerprint,executing_role:role};
        if(credentialField) row.service_role_key='sb_secret_mock_never_real';
        return [row];
      }
      throw new Error('UNEXPECTED_SQL');
    }
  };
  const prisma={
    async $transaction(callback, options){
      calls.push(['transaction',options]);
      return callback(tx);
    }
  };
  return {prisma,calls};
}
function runtimeArgs(prisma, overrides={}) {
  return {prisma,expectedRole:'prisma_runtime',deploymentId:'dpl_mockPreview1',
    applicationSha:'d'.repeat(40),issuedAtMs:NOW,nowMs:NOW,...overrides};
}

test('mock Prisma witness enforces read-only before reading actual runtime principal',async()=>{
  const mock=makePrismaRuntime();
  const result=await collectPrismaRuntimeWitness(runtimeArgs(mock.prisma));
  assert.deepEqual(mock.calls,[
    ['transaction',{isolationLevel:'Serializable',maxWait:5000,timeout:5000}],
    ['execute',PG_ENFORCE_READ_ONLY_SQL],
    ['query',PG_VERIFY_READ_ONLY_SQL],
    ['query',PG_RUNTIME_CLUSTER_SQL]
  ]);
  assert.equal(result.executingRole,'prisma_runtime');
  assert.equal(result.transactionReadOnly,true);
  assert.equal(result.evidenceAuthority,'MOCK_ONLY_RUNTIME_CANDIDATE');
  assert.equal(result.databaseIsolation,'UNVERIFIED');
  assert.equal(result.productionSeparation,'UNVERIFIED');
  assert.equal(result.r6bRelease,'HOLD');
});

test('missing runtime witness and mismatched runtime role fail closed',async()=>{
  const missing=makePrismaRuntime({includeWitness:false});
  await assert.rejects(()=>collectPrismaRuntimeWitness(runtimeArgs(missing.prisma)),
    /RUNTIME_WITNESS_MISSING/);
  const mismatch=makePrismaRuntime({role:'postgres'});
  await assert.rejects(()=>collectPrismaRuntimeWitness(runtimeArgs(mismatch.prisma)),
    /RUNTIME_PRINCIPAL_MISMATCH/);
});

test('read-only mode must be observed before runtime identity query',async()=>{
  const mock=makePrismaRuntime({readOnly:'off'});
  await assert.rejects(()=>collectPrismaRuntimeWitness(runtimeArgs(mock.prisma)),
    /READ_ONLY_MODE_UNVERIFIED/);
  assert.deepEqual(mock.calls.slice(1),[
    ['execute',PG_ENFORCE_READ_ONLY_SQL],['query',PG_VERIFY_READ_ONLY_SQL]
  ]);
});

test('stale runtime and provider evidence fail closed',async()=>{
  const runtime=makePrismaRuntime();
  await assert.rejects(()=>collectPrismaRuntimeWitness(runtimeArgs(runtime.prisma,{
    issuedAtMs:NOW-(5*60*1000)-1
  })),/RUNTIME_EVIDENCE_STALE/);
  assert.deepEqual(runtime.calls,[]);
  const {args}=setup();
  args.previewClient.getProviderClusterWitness=async()=>({
    clusterFingerprintSha256:'a'.repeat(64),executingRole:'postgres',
    observedAtMs:NOW-(5*60*1000)-1
  });
  await assert.rejects(()=>inspect(args),/CLUSTER_WITNESS_STALE/);
});

test('callers cannot relax the five-minute freshness policy',async()=>{
  const runtime=makePrismaRuntime();
  await assert.rejects(()=>collectPrismaRuntimeWitness(runtimeArgs(runtime.prisma,{
    maxEvidenceAgeMs:(5*60*1000)+1
  })),/RUNTIME_EVIDENCE_STALE/);
  assert.deepEqual(runtime.calls,[]);
});

test('runtime credential fields and credential-like values are rejected',async()=>{
  const field=makePrismaRuntime({credentialField:true});
  await assert.rejects(()=>collectPrismaRuntimeWitness(runtimeArgs(field.prisma)),
    /RUNTIME_WITNESS_SHAPE/);
  const value=makePrismaRuntime({role:'prisma_runtime'});
  value.prisma.$transaction=async callback=>callback({
    async $executeRawUnsafe(){},
    async $queryRawUnsafe(sql){
      if(sql===PG_VERIFY_READ_ONLY_SQL) return [{transaction_read_only:'on'}];
      return [{cluster_fingerprint_sha256:'a'.repeat(64),
        executing_role:'sb_secret_mock_never_real'}];
    }
  });
  await assert.rejects(()=>collectPrismaRuntimeWitness(runtimeArgs(value.prisma)),
    /CREDENTIAL_VALUE_FORBIDDEN/);
});

test('Storage credential issuer attestation remains unavailable without reading keys',()=>{
  assert.deepEqual(STORAGE_CREDENTIAL_ISSUER_ATTESTATION,{
    status:'UNAVAILABLE_WITH_NONSECRET_METADATA',
    providerDocumentedIssuerBindingFound:false,
    rawKeyApiPermitted:false,
    bucketMetadataProvesIssuer:false,
    endpointProjectRefProvesIssuer:false
  });
});
test('management role may lack capability without becoming Runtime claim',async()=>{
  const {args}=setup();
  args.previewClient.getManagementRoleCapability=async()=>({
    executingRole:'postgres',mayReadClusterIdentity:false});
  const report=await inspect(args);
  assert.equal(report.preview.managementRoleCapability,false);
  assert.equal(report.preview.effectivePrismaRole,'UNVERIFIED');
  assert.equal(report.databaseIsolation,'UNVERIFIED');
});
test('requires two independent adapter objects (no same adapter identity)',async()=>{
  const {args}=setup();
  args.productionClient=args.previewClient;
  await assert.rejects(()=>inspect(args),/PROJECT_PROVIDER_RECORD_MISMATCH/);
});
test('reject ad-hoc data-fetch surfaces like secret key lookups',async()=>{
  const {args}=setup();
  args.previewClient.getApiKeys=async()=>[{key:'none'}];
  await assert.rejects(()=>inspect(args),/READONLY_ADAPTER_REQUIRED/);
});
test('no fake provider API adapter is accepted as a release attestation',async()=>{
  const {args}=setup();
  const r=await inspect(args);
  assert.notEqual(r.independentSourceAuthentication,'VERIFIED');
  for(const [k,v] of [['databaseIsolation','UNVERIFIED'],
    ['storageIsolation','UNVERIFIED'],['productionSeparation','UNVERIFIED'],
    ['rlsSecurity','HOLD'],['r6bRelease','HOLD']])
    assert.equal(r[k],v);
});


test('reject cluster witness and capability measured under different principals',async()=>{
  const {args}=setup();
  args.previewClient.getManagementRoleCapability=async(sql)=>{
    assert.equal(sql,PG_ROLE_CAPABILITY_SQL);
    return {executingRole:'authenticated',mayReadClusterIdentity:true};
  };
  await assert.rejects(()=>inspect(args),/PROVIDER_ROLE_WITNESS_MISMATCH/);
});
test('reject provider metadata with fields that could carry credential values',async()=>{
  for(const name of ['api_key','secret_jwt_template','Authorization','SUPABASE_SERVICE_ROLE_KEY']){
    const {args}=setup();
    const base=args.previewClient.getProjectMetadata;
    args.previewClient.getProjectMetadata=async()=>({
      ...await base(),[name]:'TEST_ONLY_NOT_A_CREDENTIAL'
    });
    await assert.rejects(()=>inspect(args),/PROJECT_METADATA_SHAPE/);
  }
});
