'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCommand, verifyEvent, verifyManifest, hasExactSuccessfulCi,
  assertCi, inspectDispatchPage
} = require('../scripts/ci/owner-production-dispatch-bridge.cjs');

const CONTROL = 'a'.repeat(40);
const APP = 'b'.repeat(40);
const CMD = '/sms-v3-dispatch R5-B ' + CONTROL + ' ' + APP;
const valid = {batch:'R5-B',control:CONTROL,application:APP};
const event = () => ({
  action:'created',
  issue:{number:548,state:'open'},
  comment:{user:{login:'godzillazzz'},author_association:'OWNER',body:CMD},
  sender:{login:'godzillazzz'}
});
const manifest = () => ({
  release_batch_id:'R5-B',commit_sha:APP,tree_sha:'f'.repeat(40),
  current_production_source_sha:'c'.repeat(40),
  rollback_deployment_id:'dpl_Abc123',
  source_branch:'fix/serverless-database-reliability',
  target_project_id:'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s',
  target_environment:'production',manifest_state:'APPROVED_FOR_OWNER_PRODUCTION_DECISION',
  owner_action:'APPROVE_PRODUCTION_ONLY',run_migrations:false,
  db_schema_mutation:'NONE',database_change_policy:'NO_DATABASE_CHANGES',
  canonical_url:'https://sms-v3-staging-ten.vercel.app'
});
const ci = sha => ({workflow_runs:[{name:'CI',head_sha:sha,status:'completed',conclusion:'success'}]});
const page = (...runs) => ({total_count:runs.length,workflow_runs:runs});

test('parse exact R5-B command and two full 40-digit SHAs',()=>{
  assert.deepEqual(parseCommand(CMD),valid);
});
test('reject extra args, whitespace, uppercase SHA, and malformed batch names',()=>{
  for(const input of [CMD+' extra',' '+CMD,CMD+' ','/sms-v3-dispatch R5-A z y',
    '/sms-v3-dispatch r5-b '+CONTROL+' '+APP,
    '/sms-v3-dispatch R5-B '+CONTROL.toUpperCase()+' '+APP,
    '/sms-v3-dispatch R5-B '+CONTROL.slice(0,39)+' '+APP,
    '/sms-v3-dispatch R5-B '+CONTROL+' '+APP+'\nINJECT']) {
    assert.throws(()=>parseCommand(input));
  }
});
test('only dedicated issue 548, authenticated Owner and fresh created comment can dispatch',()=>{
  assert.deepEqual(verifyEvent(event()),valid);
});
test('fail closed for other issue, PR thread, closed issue or forged author/sender',()=>{
  const mutations=[
    e=>e.issue.number=545,e=>e.issue.pull_request={},e=>e.issue.state='closed',
    e=>e.comment.user.login='other',e=>e.sender.login='attacker',
    e=>e.comment.author_association='CONTRIBUTOR',e=>e.action='edited'
  ];
  for(const change of mutations){const e=event();change(e);assert.throws(()=>verifyEvent(e));}
});
test('fail closed on foreign repository or absent owner comment',()=>{
  assert.throws(()=>verifyEvent(event(),'someoneelse/SMS-v3'));
  const e=event();delete e.comment;assert.throws(()=>verifyEvent(e));
});
test('matching manifest and frozen branch passes',()=>{
  assert.deepEqual(verifyManifest(manifest(),valid,CONTROL),valid);
});
test('reject an Integration branch that moved after Owner command',()=>{
  assert.throws(()=>verifyManifest(manifest(),valid,'c'.repeat(40)),/moved/);
});
test('reject wrong release batch, app SHA, tree, or rollback',()=>{
  for(const [key,bad] of [['release_batch_id','R5-C'],['commit_sha',CONTROL],
    ['tree_sha','bad'],['rollback_deployment_id',''],['source_branch','main']]){
    const x=manifest();x[key]=bad;assert.throws(()=>verifyManifest(x,valid,CONTROL));
  }
});
test('reject changed environment, project, manifest state and owner action',()=>{
  for(const [key,bad] of [['target_project_id','wrong'],['target_environment','preview'],
    ['manifest_state','DRAFT'],['owner_action','DEPLOY_WITHOUT_REVIEW'],
    ['canonical_url','https://attacker.example']]){
    const x=manifest();x[key]=bad;assert.throws(()=>verifyManifest(x,valid,CONTROL));
  }
});
test('reject unexpected DB mutation, migration execution and unsupported policies',()=>{
  for(const [key,bad] of [['run_migrations',true],['db_schema_mutation','CHANGED'],
    ['database_change_policy','UNAPPROVED'],['current_production_source_sha','?']]){
    const x=manifest();x[key]=bad;assert.throws(()=>verifyManifest(x,valid,CONTROL));
  }
});
test('existing approved pre-applied migration still uses mandatory protected workflow',()=>{
  const x=manifest();x.database_change_policy='PRE_APPLIED_APPROVED_MIGRATION';x.db_schema_mutation='PRE_APPLIED';
  assert.deepEqual(verifyManifest(x,valid,CONTROL),valid);
});
test('require exact successful CI for both frozen Application and Control SHAs',()=>{
  assert.doesNotThrow(()=>assertCi(ci(APP),ci(CONTROL),valid));
  assert.equal(hasExactSuccessfulCi(ci(APP),APP),true);
});
test('reject failing or missing CI, including a successful run on another SHA',()=>{
  for(const bad of [{workflow_runs:[]},ci(CONTROL),
    {workflow_runs:[{name:'CI',head_sha:APP,status:'completed',conclusion:'failure'}]},
    {workflow_runs:[{name:'CI',head_sha:APP,status:'in_progress',conclusion:null}]}]){
      assert.throws(()=>assertCi(bad,ci(CONTROL),valid));
  }
  assert.throws(()=>assertCi(ci(APP),{workflow_runs:[]},valid));
});
test('reject duplicate exact Control SHA even if prior workflow failed',()=>{
  const bad={event:'workflow_dispatch',head_sha:CONTROL,status:'completed',conclusion:'failure'};
  assert.throws(()=>inspectDispatchPage(page(bad),CONTROL),/already exists/);
});
test('reject queued, waiting and in-progress Production releases on any SHA',()=>{
  for(const status of ['queued','waiting','in_progress','requested']){
    assert.throws(()=>inspectDispatchPage(page({event:'workflow_dispatch',head_sha:'c'.repeat(40),status}),CONTROL),/still active/);
  }
});
test('completed older releases at other SHAs are safe',()=>{
  assert.equal(inspectDispatchPage(page({event:'workflow_dispatch',head_sha:'c'.repeat(40),status:'completed',conclusion:'success'}),CONTROL),1);
});
test('fail closed on unparseable, incomplete or empty Production run evidence',()=>{
  for(const value of [null,{}, {workflow_runs:[]}, {total_count:-1,workflow_runs:[]}])assert.throws(()=>inspectDispatchPage(value,CONTROL));
});
