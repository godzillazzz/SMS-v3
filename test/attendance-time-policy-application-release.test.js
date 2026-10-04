'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verify } = require('../scripts/ci/verify-preapplied-attendance-policy-readonly');
const { validateReleaseManifest } = require('../scripts/ci/verify-release-manifest');
test('application release pins merged #417, immediate rollback and successful protected 002 evidence',()=>{
  const manifest=JSON.parse(fs.readFileSync('.github/releases/approved-production.json'));
  const valid=validateReleaseManifest(manifest);
  assert.equal(valid.commitSha,'500aaa53d60d6835cccec16c79ca25de00ab06c6');
  assert.equal(valid.treeSha,'a2cdfc2f2eea4ad52eeca07b41183d74e5fcfa74');
  assert.equal(valid.rollbackDeploymentId,'dpl_G8AKkHcwD98NKPQSWpvP7XBBs67B');
  assert.equal(valid.preAppliedMigrationEvidenceRunId,37177481995);
  assert.equal(valid.runMigrations,false);
  assert.equal(manifest.application_exact_sha_ci_run_id,37174427286);
});
test('read-only release revalidation accepts only no-database-change plan',async()=>{
  const result=await verify({env:{},readFacts:async()=>({plan:'PLAN_NO_DATABASE_CHANGE'}),run:async(options)=>options.observe({}, {}, ()=>{})});
  assert.equal(result.plan,'PLAN_NO_DATABASE_CHANGE');
  for(const plan of ['PLAN_APPLY_001_THEN_002','PLAN_APPLY_002_ONLY','PLAN_FAIL_CLOSED','PLAN_HISTORY_RECOVERY_REQUIRED']) {
    await assert.rejects(verify({env:{},readFacts:async()=>({plan}),run:async(options)=>options.observe({}, {}, ()=>{})}),/PREAPPLIED_SCHEMA_NOT_VALID/);
  }
});
test('release wrapper has no migration fallback, even if runner tried invoking apply',async()=>{
  await assert.rejects(verify({env:{},run:async(options)=>options.apply()}),/APPLICATION_RELEASE_MIGRATION_FORBIDDEN/);
});
test('read-only verifier maps exact source and canonical checkpoint from release inputs',async()=>{
  await verify({env:{TARGET_SHA:'exact-sha',TARGET_TREE:'exact-tree',ROLLBACK_DEPLOYMENT_ID:'canonical',CURRENT_PRODUCTION_SOURCE_SHA:'old-sha'},run:async(options)=>{
    assert.equal(options.env.SOURCE_SHA,'exact-sha'); assert.equal(options.env.SOURCE_TREE,'exact-tree');
    assert.equal(options.env.CURRENT_PRODUCTION_ID,'canonical'); assert.equal(options.env.CURRENT_PRODUCTION_SHA,'old-sha');
    return {plan:'PLAN_NO_DATABASE_CHANGE'};
  }});
});
test('workflow pins independent history tools to migration evidence and preserves normal approval/candidate gates',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-approved-production-v2.yml','utf8');
  assert(workflow.includes('name: production-sms-v3-staging'));
  assert(workflow.includes('scripts/ci/reconcile-production-attendance-migrations.js scripts/ci/g06-production-migration-candidates.json'));
  assert(workflow.includes('node /tmp/verify-preapplied-attendance-policy-readonly.js'));
  assert(workflow.includes('candidate_canonical_alias_assigned'));
  assert(workflow.includes('Auto-rollback to manifest checkpoint'));
  assert(workflow.includes('ATTENDANCE_TIME_POLICY_ARTIFACT=PASS'));
  assert(workflow.includes('Critical UI sentinels: PASS (19/19) base contract'));
  assert(workflow.includes('Attendance Time Policy sentinels: PASS (3/3 additional)'));
  assert(workflow.includes("sentinels.push('นโยบายเวลาลงงาน','ผ่อนผันการมาสาย (นาที)','latestCheckInEnabled')"));
});
