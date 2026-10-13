'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  EXPECTED, projectIsExpected, assertOwnerEvent, verifyEnvironment,
  verifyDeployment, verifyProduction, verifyCi, verifyRuntimeReceipt,
  signRuntimeChallenge, safeUrl, verifyPlan, verify, client
} = require('../scripts/ci/r6b-exact-deployment-isolation.cjs');

const MAIN_SHA = 'a'.repeat(40);
const NONCE = 'f'.repeat(32);
const command = EXPECTED.command + ' sha=' + EXPECTED.integrationSha
  + ' deployment=' + EXPECTED.deploymentId;
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
    id: EXPECTED.deploymentId, name: 'sms-v3-staging',
    project: { id: EXPECTED.projectId }, target: null, readyState: 'READY',
    url: 'sms-v3-staging-a0nfl2zk7-godzillazz.vercel.app',
    meta: {
      githubCommitSha: EXPECTED.integrationSha,
      githubCommitRef: EXPECTED.integrationBranch,
      githubOrg: 'godzillazzz', githubRepo: 'SMS-v3'
    }
  };
}
function receipt() {
  return {
    contract: 'sms-v3-preview-isolation/v2', nonce: NONCE,
    deploymentId: EXPECTED.deploymentId,
    applicationSha: EXPECTED.integrationSha,
    vercelProjectId: EXPECTED.projectId,
    gitCommitRef: EXPECTED.integrationBranch,
    database: {
      configuredDatabaseProjectRef: EXPECTED.previewRef,
      configuredDirectProjectRef: EXPECTED.previewRef,
      configuredDatabaseName: 'postgres',
      observedDatabaseName: 'postgres',
      targetGuardMatched: true,
      databaseReadOnlyQuerySucceeded: true
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
  approvedProductionDatabaseRef: 'x'.repeat(20),
  approvedProductionStorageRef: 'y'.repeat(20)
});
const plan = () => ({
  version: 2, commentId: 123, mainSha: MAIN_SHA,
  integrationSha: EXPECTED.integrationSha, deploymentId: EXPECTED.deploymentId
});

test('owner-only exact command pins new SHA and deployment ID', () => {
  assert.equal(EXPECTED.integrationSha, 'e80a1883d1598c035741ca55d9a1fc09061718f9');
  assert.equal(EXPECTED.ciRunId, 38324590377);
  assert.equal(EXPECTED.deploymentId, 'dpl_9FeFnk1yQx8LUsENMA7TR3R8fpwk');
  assert.equal(assertOwnerEvent(event(), env()), 123);
});
test('wrong issue, PR comment, or forged owner are rejected', () => {
  const a=event();a.issue.number=615;
  assert.throws(() => assertOwnerEvent(a,env()),/EXACT_OWNER_ISSUE_COMMAND_REQUIRED/);
  const b=event();b.issue.pull_request={};
  assert.throws(() => assertOwnerEvent(b,env()),/EXACT_OWNER_ISSUE_COMMAND_REQUIRED/);
  const c=event();c.sender.id=2;
  assert.throws(() => assertOwnerEvent(c,env()),/OWNER_IDENTITY_REQUIRED/);
});
test('old command, missing fields, wrong SHA/deployment, extra tokens rejected', () => {
  for(const value of [
    EXPECTED.command,
    EXPECTED.command+' sha='+EXPECTED.integrationSha,
    command.replace(EXPECTED.integrationSha,'e'.repeat(40)),
    command.replace(EXPECTED.deploymentId,'dpl_stale'),
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
  assert.equal(projectIsExpected({project:{id:EXPECTED.projectId}}),true);
  assert.equal(projectIsExpected({projectId:EXPECTED.projectId,project:{id:'wrong'}}),false);
  assert.equal(projectIsExpected({}),false);
});
test('Preview pinned deployment requires READY, preview, host, ref and project',()=>{
  const d=deployment();
  assert.doesNotThrow(()=>verifyDeployment(d,d.url));
  for(const mutation of [
    x=>x.meta.githubCommitSha='e'.repeat(40),
    x=>x.target='production',
    x=>x.project.id='other',
    x=>x.readyState='ERROR',
    x=>x.url='evil.vercel.app',
    x=>x.meta.githubCommitRef='main'
  ]){
    const x=copy(d);mutation(x);
    assert.throws(()=>verifyDeployment(x,d.url),/EXACT_PREVIEW_DEPLOYMENT_REQUIRED/);
  }
});
test('frozen Production deployment rejects target or SHA changes',()=>{
  const d=deployment();d.id=EXPECTED.productionDeploymentId;d.target='production';
  d.meta.githubCommitSha=EXPECTED.productionSha;
  assert.doesNotThrow(()=>verifyProduction(d));
  d.target='preview';
  assert.throws(()=>verifyProduction(d),/FROZEN_PRODUCTION_CHANGED/);
  d.target='production';d.meta.githubCommitSha=EXPECTED.integrationSha;
  assert.throws(()=>verifyProduction(d),/FROZEN_PRODUCTION_CHANGED/);
});
test('CI must be exact-head success, not older success',()=>{
  const r={id:EXPECTED.ciRunId,name:'CI',head_sha:EXPECTED.integrationSha,
    head_branch:EXPECTED.integrationBranch,status:'completed',conclusion:'success'};
  assert.doesNotThrow(()=>verifyCi({workflow_runs:[r]}));
  for(const x of [{id:38190536543},{head_sha:'e'.repeat(40)},
    {conclusion:'failure'},{status:'in_progress'}]){
    assert.throws(()=>verifyCi({workflow_runs:[{...r,...x}]}),/EXACT_INTEGRATION_CI_REQUIRED/);
  }
});
test('receipt v2 accepts valid configured-check evidence but never labels isolation PASS',()=>{
  const x=verifyRuntimeReceipt(receipt(),NONCE,proof());
  assert.deepEqual(x,{
    deploymentIdentity:'PASS',configuredDatabaseTarget:'MATCH',databaseReadOnlyCheck:'PASS',
    configuredStorageEndpoint:'MATCH',privateBucketMetadataGet:'PASS',
    database:'UNVERIFIED',storage:'UNVERIFIED',productionSeparation:'UNVERIFIED'
  });
});
test('no Production refs also stays UNVERIFIED',()=>{
  const x=verifyRuntimeReceipt(receipt(),NONCE,{deploymentVerified:true});
  assert.equal(x.productionSeparation,'UNVERIFIED');
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
  const fields={host:'Preview.EXAMPLE.com',deploymentId:EXPECTED.deploymentId,
    sha:EXPECTED.integrationSha,nonce:NONCE,issuedAt:1791853000000};
  const canonical=['GET',EXPECTED.probePath,'preview.example.com',fields.deploymentId,
    fields.sha,fields.nonce,String(fields.issuedAt)].join('\n');
  const expected='v1='+crypto.createHmac('sha256',secret).update(canonical).digest('hex');
  assert.equal(signRuntimeChallenge(secret,fields),expected);
  assert.notEqual(signRuntimeChallenge(secret,{...fields,nonce:'0'.repeat(32)}),expected);
  assert.notEqual(signRuntimeChallenge(secret,{...fields,issuedAt:1791853000001}),expected);
  assert.notEqual(signRuntimeChallenge(secret,{...fields,deploymentId:'dpl_stale'}),expected);
});
test('v2 plan requires exact owner ID, main SHA and deployment',()=>{
  assert.doesNotThrow(()=>verifyPlan(plan(),event(),env()));
  for(const change of [
    {version:1},{mainSha:'b'.repeat(40)},{integrationSha:'e'.repeat(40)},
    {deploymentId:'dpl_stale'},{commentId:1000}
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

test('mocked exact-host signed GET is v2 and isolation remains UNVERIFIED', async()=>{
  const secret='unit-test-only-matching-hmac-key-32bytes';
  const e={...env(), GH_TOKEN:'unit-gh',
    VERCEL_TOKEN:'unit-vercel',
    VERCEL_AUTOMATION_BYPASS_SECRET:'unit-bypass',
    RUNTIME_ISOLATION_PROBE_HMAC_SECRET:secret,
    RUNTIME_PROBE_SOURCE_REVIEW_APPROVED:EXPECTED.integrationSha
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
        result={object:{sha:EXPECTED.integrationSha}};
      else if(u.pathname.endsWith('/actions/runs'))
        result={workflow_runs:[{id:EXPECTED.ciRunId,name:'CI',
          head_sha:EXPECTED.integrationSha,head_branch:EXPECTED.integrationBranch,
          status:'completed',conclusion:'success'}]};
      else throw Error('unexpected github endpoint '+u.pathname);
    } else if(u.hostname==='api.vercel.com') {
      if(u.pathname.endsWith('/v13/deployments/'+EXPECTED.deploymentId)
        ||u.pathname.endsWith('/v13/deployments/'+host)) result=deployment();
      else if(u.pathname.endsWith('/v13/deployments/'+EXPECTED.productionDeploymentId)) {
        const p=deployment();p.id=EXPECTED.productionDeploymentId;p.target='production';
        p.meta.githubCommitSha=EXPECTED.productionSha;result=p;
      } else if(u.pathname.includes('/v4/aliases/')) {
        const alias=u.pathname.split('/').at(-1);
        assert.ok(EXPECTED.aliases.includes(alias));
        result={alias,deploymentId:EXPECTED.productionDeploymentId};
      } else throw Error('unexpected vercel endpoint '+u.pathname);
    } else if(u.hostname===host) {
      assert.equal(options.headers['x-vercel-protection-bypass'],'unit-bypass');
      if(u.pathname==='/api/v1/ready')result={status:'ready',database:'ok'};
      else if(u.pathname===EXPECTED.probePath) {
        probes++;
        const nonce=u.searchParams.get('nonce'),issuedAt=u.searchParams.get('issuedAt');
        assert.match(nonce,/^[a-f0-9]{32}$/);
        assert.equal(u.searchParams.get('sha'),EXPECTED.integrationSha);
        assert.equal(u.searchParams.get('deploymentId'),EXPECTED.deploymentId);
        assert.equal(Date.now()-Number(issuedAt)<120000,true);
        const signature=signRuntimeChallenge(secret,{host,nonce,issuedAt,
          sha:EXPECTED.integrationSha,deploymentId:EXPECTED.deploymentId});
        assert.equal(options.headers['x-smsv3-probe-signature'],signature);
        assert.equal(u.searchParams.has('signature'),false);
        result={...receipt(),nonce};
      } else throw Error('unexpected runtime endpoint '+u.pathname);
    } else throw Error('unexpected host '+u.hostname);
    return {status:200,ok:true,json:async()=>result};
  };
  const out=await verify(plan(),event(),e,mock);
  assert.equal(out.result,'UNVERIFIED');
  assert.equal(out.database,'UNVERIFIED');
  assert.equal(out.storage,'UNVERIFIED');
  assert.equal(out.productionSeparation,'UNVERIFIED');
  assert.equal(out.productionUnchanged,true);
  assert.equal(probes,1);
  assert.ok(calls>=10);
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
