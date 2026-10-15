'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  EXPECTED, projectIsExpected, assertOwnerEvent, verifyEnvironment,
  verifyDeployment, verifyProduction, resolveCanonicalProduction, verifyCi, verifyRuntimeReceipt,
  signRuntimeChallenge, safeUrl, verifyPlan, verify, client
} = require('../scripts/ci/r6b-exact-deployment-isolation.cjs');

const MAIN_SHA = 'a'.repeat(40);
const NONCE = 'f'.repeat(32);
const INTEGRATION_SHA = 'a'.repeat(40);
const DEPLOYMENT_ID = 'dpl_TestPreviewV3';
const PRODUCTION_DEPLOYMENT_ID = 'dpl_TestProductionV7';
const PRODUCTION_SHA = 'b'.repeat(40);
const CI_RUN_ID = 12345678901;
const command = EXPECTED.command + ' sha=' + INTEGRATION_SHA
  + ' deployment=' + DEPLOYMENT_ID;
const copy = x => JSON.parse(JSON.stringify(x));

function event() {
  const user = { login: EXPECTED.owner, id: EXPECTED.ownerId, type: 'User' };
  return {
    action: 'created', issue: { number: EXPECTED.issue, state: 'open' },
    sender: { ...user },
    comment: { id: 123, body: command, author_association: 'OWNER', user: { ...user } }
  };
}
function env() {
  return {
    GITHUB_REPOSITORY: EXPECTED.repo, GITHUB_EVENT_NAME: 'issue_comment',
    GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: MAIN_SHA
  };
}
function environment() {
  return {
    name: EXPECTED.environment, can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [{ type: 'required_reviewers', reviewers: [
      { type: 'User', reviewer: { login: EXPECTED.owner, id: EXPECTED.ownerId } }
    ] }]
  };
}
const policies = () => ({ total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] });
function deployment() {
  return {
    id: DEPLOYMENT_ID, name: 'sms-v3-staging',
    project: { id: EXPECTED.projectId }, target: null, readyState: 'READY',
    url: 'sms-v3-staging-a0nfl2zk7-godzillazz.vercel.app',
    meta: {
      githubCommitSha: INTEGRATION_SHA,
      githubCommitRef: EXPECTED.integrationBranch,
      githubOrg: 'godzillazzz', githubRepo: 'SMS-v3'
    }
  };
}
function productionDeployment() {
  const d = deployment();
  d.id = PRODUCTION_DEPLOYMENT_ID;
  d.target = 'production';
  d.meta.githubCommitSha = PRODUCTION_SHA;
  return d;
}
function alias(aliasName, deploymentId = PRODUCTION_DEPLOYMENT_ID) {
  return { alias: aliasName, deploymentId, projectId: EXPECTED.projectId };
}
function receipt() {
  return {
    contract: 'sms-v3-preview-isolation/v3', nonce: NONCE,
    deploymentId: DEPLOYMENT_ID,
    applicationSha: INTEGRATION_SHA,
    vercelProjectId: EXPECTED.projectId,
    gitCommitRef: EXPECTED.integrationBranch,
    signedChallengeIdentity: {
      host: 'sms-v3-staging-a0nfl2zk7-godzillazz.vercel.app',
      deploymentId: DEPLOYMENT_ID, applicationSha: INTEGRATION_SHA,
      nonce: NONCE, issuedAt: 1760000000000, signatureVerified: true
    },
    database: {
      configuredDatabaseProjectRef: EXPECTED.previewRef,
      configuredDirectProjectRef: EXPECTED.previewRef,
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
      configuredEndpointProjectRef: EXPECTED.previewRef,
      bucket: EXPECTED.previewBucket,
      privateBucketMetadataReadSucceeded: true,
      bucketIsPrivate: true
    }
  };
}
const proof = () => ({
  deploymentVerified: true,
  deploymentId: DEPLOYMENT_ID,
  applicationSha: INTEGRATION_SHA,
  integrationRef: EXPECTED.integrationBranch,
  approvedRuntimePrincipal: 'postgres',
  approvedPreviewClusterFingerprintSha256: 'a'.repeat(64),
  approvedProductionClusterFingerprintSha256: 'b'.repeat(64),
  approvedProductionDatabaseRef: 'x'.repeat(20),
  approvedProductionStorageRef: 'y'.repeat(20)
});
const plan = () => ({
  version: 3, commentId: 123, mainSha: MAIN_SHA,
  integrationSha: INTEGRATION_SHA, integrationBranch: EXPECTED.integrationBranch,
  deploymentId: DEPLOYMENT_ID, ciRunId: CI_RUN_ID
});

test('owner-only exact command pins new SHA and deployment ID', () => {
  assert.deepEqual(assertOwnerEvent(event(), env()), {
    commentId: 123, integrationSha: INTEGRATION_SHA, deploymentId: DEPLOYMENT_ID
  });
});
test('wrong issue, PR comment, or forged owner are rejected', () => {
  const a=event();a.issue.number=615;
  assert.throws(() => assertOwnerEvent(a,env()),/EXACT_OWNER_ISSUE_COMMAND_REQUIRED/);
  const b=event();b.issue.pull_request={};
  assert.throws(() => assertOwnerEvent(b,env()),/EXACT_OWNER_ISSUE_COMMAND_REQUIRED/);
  const c=event();c.sender.id=2;
  assert.throws(() => assertOwnerEvent(c,env()),/OWNER_IDENTITY_REQUIRED/);
});
test('old command, missing fields, malformed identity and extra tokens rejected', () => {
  for(const value of [
    '/sms-v3-r6b-exact-isolation-attestation-20261012 sha='+INTEGRATION_SHA+' deployment='+DEPLOYMENT_ID,
    EXPECTED.command,
    EXPECTED.command+' sha='+INTEGRATION_SHA,
    EXPECTED.command+' sha=not-a-sha deployment='+DEPLOYMENT_ID,
    EXPECTED.command+' sha='+INTEGRATION_SHA+' deployment=not-a-deployment',
    command+' extra=yes'
  ]) {
    const a=event();a.comment.body=value;
    assert.throws(()=>assertOwnerEvent(a,env()),/EXACT_OWNER_ISSUE_COMMAND_REQUIRED/);
  }
});
test('only trusted first-attempt main issue_comment allowed',()=>{
  for (const extra of [
    {GITHUB_REF:'refs/heads/other'}, {GITHUB_RUN_ATTEMPT:'2'},
    {GITHUB_EVENT_NAME:'pull_request'}, {GITHUB_SHA:'not-hex'}
  ]) assert.throws(()=>assertOwnerEvent(event(),{...env(),...extra}),/TRUSTED_MAIN_REQUIRED/);
});
test('Hosted UAT owner reviewer / branch only / no bypass',()=>{
  assert.doesNotThrow(()=>verifyEnvironment(environment(),policies()));
  const a=environment();a.can_admins_bypass=true;
  assert.throws(()=>verifyEnvironment(a,policies()),/ENVIRONMENT_BYPASS_REJECTED/);
  const b=environment();b.protection_rules=[];
  assert.throws(()=>verifyEnvironment(b,policies()),/HUMAN_OWNER_APPROVAL_REQUIRED/);
  const c=policies();c.branch_policies[0].name='*';
  assert.throws(()=>verifyEnvironment(environment(),c),/MAIN_ONLY_ENVIRONMENT_REQUIRED/);
});
test('strict project identity rejects conflicting or missing IDs',()=>{
  assert.equal(projectIsExpected({projectId:EXPECTED.projectId}),true);
  assert.equal(projectIsExpected({project:EXPECTED.projectId}),true);
  assert.equal(projectIsExpected({project:{id:EXPECTED.projectId}}),true);
  assert.equal(projectIsExpected({projectId:EXPECTED.projectId,project:{id:'wrong'}}),false);
  assert.equal(projectIsExpected({}),false);
});
test('Preview pinned deployment requires READY, preview, host, ref and project',()=>{
  const d=deployment();
  assert.doesNotThrow(()=>verifyDeployment(d,d.url,plan()));
  for(const mutation of [
    x=>x.meta.githubCommitSha='e'.repeat(40),
    x=>x.target='production',
    x=>x.project.id='other',
    x=>x.readyState='ERROR',
    x=>x.url='evil.vercel.app',
    x=>x.meta.githubCommitRef='main'
  ]){
    const x=copy(d);mutation(x);
    assert.throws(()=>verifyDeployment(x,d.url,plan()),/EXACT_PREVIEW_DEPLOYMENT_REQUIRED/);
  }
});
test('canonical Production deployment requires READY production source provenance',()=>{
  const d=productionDeployment();
  assert.deepEqual(verifyProduction(d,PRODUCTION_DEPLOYMENT_ID),{
    deploymentId:PRODUCTION_DEPLOYMENT_ID,applicationSha:PRODUCTION_SHA
  });
  for (const mutation of [
    x=>x.target='preview',
    x=>x.readyState='ERROR',
    x=>x.project.id='wrong',
    x=>x.meta.githubCommitSha='not-a-sha',
    x=>x.meta.githubCommitRef='main',
    x=>x.meta.githubRepo='other'
  ]) {
    const x=copy(d);mutation(x);
    assert.throws(()=>verifyProduction(x,PRODUCTION_DEPLOYMENT_ID),
      /CANONICAL_PRODUCTION_UNVERIFIED/);
  }
  assert.throws(()=>verifyProduction(d,'not-a-deployment'),
    /CANONICAL_PRODUCTION_UNVERIFIED/);
});
test('canonical Production aliases must converge on one expected project deployment',async()=>{
  const api={vercel:async path=>{
    for (const name of EXPECTED.aliases) if(path.endsWith('/v4/aliases/'+name)) return alias(name);
    if(path.endsWith('/v13/deployments/'+PRODUCTION_DEPLOYMENT_ID)) return productionDeployment();
    throw Error('unexpected '+path);
  }};
  const out=await resolveCanonicalProduction(api);
  assert.equal(out.deploymentId,PRODUCTION_DEPLOYMENT_ID);
  assert.equal(out.applicationSha,PRODUCTION_SHA);

  const divergent={vercel:async path=>{
    if(path.endsWith('/v4/aliases/'+EXPECTED.aliases[0])) return alias(EXPECTED.aliases[0]);
    if(path.endsWith('/v4/aliases/'+EXPECTED.aliases[1])) return alias(EXPECTED.aliases[1],'dpl_OtherProduction');
    throw Error('unexpected '+path);
  }};
  await assert.rejects(()=>resolveCanonicalProduction(divergent),/PRODUCTION_ALIAS_DIVERGENCE/);

  const wrongProject={vercel:async path=>{
    if(path.includes('/v4/aliases/')) {
      const name=path.split('/').at(-1);
      return {...alias(name),projectId:'prj_wrong'};
    }
    throw Error('unexpected '+path);
  }};
  await assert.rejects(()=>resolveCanonicalProduction(wrongProject),/PRODUCTION_ALIAS_UNVERIFIED/);
});
test('CI must be exact-head success, not older success',()=>{
  const r={id:CI_RUN_ID,name:'CI',head_sha:INTEGRATION_SHA,
    head_branch:EXPECTED.integrationBranch,status:'completed',conclusion:'success'};
  assert.doesNotThrow(()=>verifyCi({workflow_runs:[r]}, INTEGRATION_SHA, EXPECTED.integrationBranch));
  for(const x of [{head_sha:'e'.repeat(40)},
    {conclusion:'failure'},{status:'in_progress'}]){
    assert.throws(()=>verifyCi({workflow_runs:[{...r,...x}]}, INTEGRATION_SHA, EXPECTED.integrationBranch),/EXACT_INTEGRATION_CI_REQUIRED/);
  }
});
test('receipt v3 returns PASS only when independent DB/Storage separation evidence is complete',()=>{
  const x=verifyRuntimeReceipt(receipt(),NONCE,proof());
  assert.deepEqual(x,{
    deploymentIdentity:'PASS',configuredDatabaseTarget:'MATCH',databaseReadOnlyCheck:'PASS',
    runtimePrincipal:'MATCH',runtimeClusterFingerprint:'MATCH',
    configuredStorageEndpoint:'MATCH',privateBucketMetadataGet:'PASS',
    database:'PASS',storage:'PASS',productionSeparation:'PASS'
  });
});
test('runtime principal and provider cluster binding are mandatory and fail closed',()=>{
  for (const mutation of [
    p => delete p.approvedRuntimePrincipal,
    p => p.approvedRuntimePrincipal = 'anon',
    p => delete p.approvedPreviewClusterFingerprintSha256,
    p => p.approvedPreviewClusterFingerprintSha256 = 'c'.repeat(64),
    p => p.approvedProductionClusterFingerprintSha256 = 'a'.repeat(64),
    p => p.approvedProductionClusterFingerprintSha256 = 'invalid'
  ]) {
    const p = proof();
    mutation(p);
    assert.throws(() => verifyRuntimeReceipt(receipt(), NONCE, p),
      /RUNTIME_PRINCIPAL_UNVERIFIED|DATABASE_PROVIDER_WITNESS_UNVERIFIED/);
  }
  for (const mutation of [
    x => delete x.database.runtimePrincipal,
    x => x.database.runtimeWitnessVerified = false,
    x => x.database.runtimeClusterFingerprintSha256 = 'not-a-hash'
  ]) {
    const x = receipt();
    mutation(x);
    assert.throws(() => verifyRuntimeReceipt(x, NONCE, proof()),
      /RUNTIME_DATABASE_TARGET_UNVERIFIED/);
  }
});

test('missing Production DB or Storage ref fails closed',()=>{
  for (const key of ['approvedProductionDatabaseRef','approvedProductionStorageRef']) {
    const p = proof();
    delete p[key];
    assert.throws(()=>verifyRuntimeReceipt(receipt(),NONCE,p),
      /PRODUCTION_SEPARATION_UNVERIFIED/);
  }
});
test('receipt v1, unknown fields and Preview-supplied Production IDs rejected',()=>{
  const old=receipt();old.contract='sms-v3-preview-isolation/v1';
  assert.throws(()=>verifyRuntimeReceipt(old,NONCE,proof()),/RUNTIME_PROBE_MISSING_OR_UNTRUSTED/);
  const add=receipt();add.productionDatabaseRef='x'.repeat(20);
  assert.throws(()=>verifyRuntimeReceipt(add,NONCE,proof()),/RUNTIME_PROBE_MISSING_OR_UNTRUSTED/);
  const ext=receipt();ext.storage.credentialProjectRef='x'.repeat(20);
  assert.throws(()=>verifyRuntimeReceipt(ext,NONCE,proof()),/RUNTIME_STORAGE_TARGET_UNVERIFIED/);
  const cred=receipt();cred.database.password='secret';
  assert.throws(()=>verifyRuntimeReceipt(cred,NONCE,proof()),/RUNTIME_DATABASE_TARGET_UNVERIFIED/);
});
test('deployment, SHA, repository ref, project and nonce all receipt-bound',()=>{
  for(const update of [
    x=>x.nonce='0'.repeat(32),
    x=>x.deploymentId='dpl_stale',
    x=>x.applicationSha='e'.repeat(40),
    x=>x.vercelProjectId='prj_wrong',
    x=>x.gitCommitRef='main'
  ]){
    const x=receipt();update(x);
    assert.throws(()=>verifyRuntimeReceipt(x,NONCE,proof()),/RUNTIME_PROBE_MISSING_OR_UNTRUSTED/);
  }
  assert.throws(()=>verifyRuntimeReceipt(receipt(),NONCE,{deploymentVerified:false}),
    /DEPLOYMENT_PROVENANCE_REQUIRED/);
});
test('DB read-only and configured target match are mandatory',()=>{
  for(const update of [
    x=>x.database.targetGuardMatched=false,
    x=>x.database.databaseReadOnlyQuerySucceeded=false,
    x=>x.database.configuredDirectProjectRef='other',
    x=>x.database.observedDatabaseName='other'
  ]){
    const x=receipt();update(x);
    assert.throws(()=>verifyRuntimeReceipt(x,NONCE,proof()),/RUNTIME_DATABASE_TARGET_UNVERIFIED/);
  }
});
test('signed challenge identity must be verified by runtime',()=>{
  const x=receipt();x.signedChallengeIdentity.signatureVerified=false;
  assert.throws(()=>verifyRuntimeReceipt(x,NONCE,proof()),
    /SIGNED_CHALLENGE_IDENTITY_UNVERIFIED/);
});
test('Storage metadata GET and private bucket flags must agree',()=>{
  for(const update of [
    x=>x.storage.bucketIsPrivate=false,
    x=>x.storage.privateBucketMetadataReadSucceeded=false,
    x=>x.storage.configuredEndpointProjectRef='other',
    x=>x.storage.bucket='wrong'
  ]){
    const x=receipt();update(x);
    assert.throws(()=>verifyRuntimeReceipt(x,NONCE,proof()),/RUNTIME_STORAGE_TARGET_UNVERIFIED/);
  }
});
test('independently approved Production ref collision or malformed ref rejected',()=>{
  for(const extra of [
    {approvedProductionDatabaseRef:EXPECTED.previewRef},
    {approvedProductionStorageRef:EXPECTED.previewRef},
    {approvedProductionStorageRef:'production-unknown'},
  ]) assert.throws(()=>verifyRuntimeReceipt(receipt(),NONCE,{...proof(),...extra}),
    /PRODUCTION_SEPARATION_UNVERIFIED/);
});
test('HMAC signature canonicalizes exact GET, path, host, deployment, SHA, nonce, issuedAt',()=>{
  const secret='test-only-not-real-hmac-secret-32-bytes';
  const fields={host:'Preview.EXAMPLE.com',deploymentId:DEPLOYMENT_ID,
    sha:INTEGRATION_SHA,nonce:NONCE,issuedAt:1791853000000};
  const canonical=['GET',EXPECTED.probePath,'preview.example.com',fields.deploymentId,
    fields.sha,fields.nonce,String(fields.issuedAt)].join('\n');
  const expected='v1='+crypto.createHmac('sha256',secret).update(canonical).digest('hex');
  assert.equal(signRuntimeChallenge(secret,fields),expected);
  assert.notEqual(signRuntimeChallenge(secret,{...fields,nonce:'0'.repeat(32)}),expected);
  assert.notEqual(signRuntimeChallenge(secret,{...fields,issuedAt:1791853000001}),expected);
  assert.notEqual(signRuntimeChallenge(secret,{...fields,deploymentId:'dpl_stale'}),expected);
});
test('v3 plan binds owner command, main SHA, CI and deployment',()=>{
  assert.doesNotThrow(()=>verifyPlan(plan(),event(),env()));
  for(const change of [
    {version:2},{mainSha:'b'.repeat(40)},{integrationSha:'e'.repeat(40)},
    {integrationBranch:'main'},{deploymentId:'dpl_stale'},{commentId:1000}
  ])assert.throws(()=>verifyPlan({...plan(),...change},event(),env()),/PLAN_TAMPERED/);
});
test('verifier fails before network if no HMAC secret or source review',async()=>{
  let called=0;
  const fetcher=async()=>{called++;throw Error('network not allowed')};
  const s={...env(),VERCEL_TOKEN:'fake',VERCEL_AUTOMATION_BYPASS_SECRET:'fake'};
  await assert.rejects(()=>verify(plan(),event(),s,fetcher),/PROBE_AUTH_NOT_CONFIGURED/);
  await assert.rejects(()=>verify(plan(),event(),
    {...s,RUNTIME_ISOLATION_PROBE_HMAC_SECRET:'not-long'},fetcher),
    /PROBE_AUTH_NOT_CONFIGURED/);
  await assert.rejects(()=>verify(plan(),event(),{
    ...s,RUNTIME_ISOLATION_PROBE_HMAC_SECRET:'some-test-only-secret-longer-than-32'
  },fetcher),/PROBE_SOURCE_REVIEW_REQUIRED/);
  assert.equal(called,0);
});
test('verifier rejects any injected DB or Storage service key before GET',async()=>{
  let called=0;
  await assert.rejects(()=>verify(plan(),event(),{
    ...env(),VERCEL_TOKEN:'fake',VERCEL_AUTOMATION_BYPASS_SECRET:'fake',
    RUNTIME_ISOLATION_PROBE_HMAC_SECRET:'some-test-only-secret-longer-than-32',
    SUPABASE_SERVICE_ROLE_KEY:'no-real-key'
  },async()=>{called++;}),/UNEXPECTED_DATA_CREDENTIAL/);
  assert.equal(called,0);
});
test('GET-only client rejects methods, credentials in URL and redirects',async()=>{
  assert.equal(safeUrl('https://preview.example.com','preview.example.com').hostname,
    'preview.example.com');
  assert.throws(()=>safeUrl('https://secret@preview.example.com','preview.example.com'),
    /UNSAFE_URL/);
  const api=client({},async()=>({status:302}));
  await assert.rejects(()=>api.request('https://preview.example.com',{},'POST'),/UNSAFE_METHOD/);
  await assert.rejects(()=>api.request('https://preview.example.com'),/REDIRECT_REJECTED/);
});

test('mocked exact-host signed GET is v3 and isolation becomes VERIFIED only with complete proof', async()=>{
  const secret='unit-test-only-matching-hmac-key-32bytes';
  const e={...env(), GH_TOKEN:'unit-gh',
    VERCEL_TOKEN:'unit-vercel',
    VERCEL_AUTOMATION_BYPASS_SECRET:'unit-bypass',
    RUNTIME_ISOLATION_PROBE_HMAC_SECRET:secret,
    RUNTIME_PROBE_SOURCE_REVIEW_APPROVED:INTEGRATION_SHA,
    APPROVED_PREVIEW_RUNTIME_PRINCIPAL:'postgres',
    APPROVED_PREVIEW_DB_CLUSTER_FINGERPRINT:'a'.repeat(64),
    APPROVED_PRODUCTION_DB_CLUSTER_FINGERPRINT:'b'.repeat(64),
    APPROVED_PRODUCTION_DB_REF:'x'.repeat(20),
    APPROVED_PRODUCTION_STORAGE_REF:'y'.repeat(20)
  };
  const host=deployment().url;
  let probes=0, calls=0;
  const mock=async(url,options)=>{
    calls++;
    const u=new URL(url);
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    let result;
    if (u.hostname==='api.github.com') {
      if(u.pathname.endsWith('/environments/Hosted%20UAT'))
        result=environment();
      else if(u.pathname.endsWith('/deployment-branch-policies'))
        result=policies();
      else if(u.pathname.endsWith('/branches/main'))
        result={protected:true,commit:{sha:MAIN_SHA}};
      else if(u.pathname.endsWith('/git/ref/heads/'+EXPECTED.integrationBranch))
        result={object:{sha:INTEGRATION_SHA}};
      else if(u.pathname.endsWith('/actions/runs'))
        result={workflow_runs:[{id:CI_RUN_ID,name:'CI',
          head_sha:INTEGRATION_SHA,head_branch:EXPECTED.integrationBranch,
          status:'completed',conclusion:'success'}]};
      else throw Error('unexpected github endpoint '+u.pathname);
    } else if(u.hostname==='api.vercel.com') {
      if(u.pathname.endsWith('/v13/deployments/'+DEPLOYMENT_ID)
        ||u.pathname.endsWith('/v13/deployments/'+host)) result=deployment();
      else if(u.pathname.endsWith('/v13/deployments/'+PRODUCTION_DEPLOYMENT_ID)) {
        result=productionDeployment();
      } else if(u.pathname.includes('/v4/aliases/')) {
        const aliasName=u.pathname.split('/').at(-1);
        assert.ok(EXPECTED.aliases.includes(aliasName));
        result=alias(aliasName);
      } else throw Error('unexpected vercel endpoint '+u.pathname);
    } else if(u.hostname===host) {
      assert.equal(options.headers['x-vercel-protection-bypass'],'unit-bypass');
      if(u.pathname==='/api/v1/ready')result={status:'ready',database:'ok'};
      else if(u.pathname===EXPECTED.probePath) {
        probes++;
        const nonce=u.searchParams.get('nonce'),issuedAt=u.searchParams.get('issuedAt');
        assert.match(nonce,/^[a-f0-9]{32}$/);
        assert.equal(u.searchParams.get('sha'),INTEGRATION_SHA);
        assert.equal(u.searchParams.get('deploymentId'),DEPLOYMENT_ID);
        assert.equal(Date.now()-Number(issuedAt)<120000,true);
        const signature=signRuntimeChallenge(secret,{host,nonce,issuedAt,
          sha:INTEGRATION_SHA,deploymentId:DEPLOYMENT_ID});
        assert.equal(options.headers['x-smsv3-probe-signature'],signature);
        assert.equal(u.searchParams.has('signature'),false);
        result={...receipt(),nonce,
          signedChallengeIdentity:{...receipt().signedChallengeIdentity,nonce}};
      } else throw Error('unexpected runtime endpoint '+u.pathname);
    } else throw Error('unexpected host '+u.hostname);
    return {status:200,ok:true,json:async()=>result};
  };
  const out=await verify(plan(),event(),e,mock);
  assert.equal(out.result,'VERIFIED');
  assert.equal(out.database,'PASS');
  assert.equal(out.storage,'PASS');
  assert.equal(out.productionSeparation,'PASS');
  assert.equal(out.productionDeploymentId,PRODUCTION_DEPLOYMENT_ID);
  assert.equal(out.productionApplicationSha,PRODUCTION_SHA);
  assert.equal(out.productionUnchanged,true);
  assert.equal(probes,1);
  assert.ok(calls>=14);
});
test('protected workflow cannot be dispatched by pull_request or push',()=>{
  const fs=require('node:fs');
  const yml=fs.readFileSync('.github/workflows/r6b-integration-exact-isolation-readonly.yml','utf8');
  assert.match(yml,/issue_comment:\s*\n\s+types: \[created\]/);
  assert.doesNotMatch(yml,/\n\s+pull_request:/);
  assert.doesNotMatch(yml,/\n\s+push:/);
  assert.match(yml,/environment:\s*\n\s+name: Hosted UAT/);
  assert.match(yml,/RUNTIME_ISOLATION_PROBE_HMAC_SECRET:/);
  assert.match(yml,/startsWith\(github\.event\.comment\.body/);
});
