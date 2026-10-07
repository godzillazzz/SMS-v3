'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verify } = require('../scripts/ci/verify-preapplied-attendance-policy-readonly');
const { validateReleaseManifest } = require('../scripts/ci/verify-release-manifest');
test('R1 release pins exact source, current Production checkpoint and no database changes',()=>{
  const manifest=JSON.parse(fs.readFileSync('.github/releases/approved-production.json'));
  const valid=validateReleaseManifest(manifest);
  assert.equal(valid.commitSha,'60f6109a09eb8e27c5d8b83820d7df8014667ae5');
  assert.equal(valid.treeSha,'b38d8b333629d752d7716b89b2295314e1a2e8f4');
  assert.equal(valid.currentProductionSourceSha,'f63c785e8af1d63f3d27754c66709e6a0d9b3443');
  assert.equal(valid.rollbackDeploymentId,'dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK');
  assert.equal(valid.preAppliedMigrationEvidenceRunId,'');
  assert.equal(valid.runMigrations,false);
  assert.equal(valid.databaseChangePolicy,'NO_DATABASE_CHANGES');
  assert.equal(valid.productionEnvironmentChangePolicy,'NO_ENVIRONMENT_CHANGES');
  assert.equal(manifest.application_pr_number,474);
  assert.equal(manifest.application_exact_sha_ci_run_id,37546753747);
  assert.equal(manifest.release_source_exact_sha_ci_run_id,37546753747);
  assert.equal(manifest.preview_technical_smoke_run_id,37552536761);
  assert.equal(manifest.preview_trusted_cors_status,'PASS');
  assert.equal(manifest.preview_untrusted_cors_status,'REJECTED_403');
  assert.equal(manifest.production_canonical_deployment_id_before_release,'dpl_F4E5kVXqpYuhQjcQSDP49ViJJvpK');
  assert.equal(manifest.production_canonical_source_sha_before_release,'f63c785e8af1d63f3d27754c66709e6a0d9b3443');
  assert.equal(manifest.g06_acceptance_status,'CLOSED');
  assert.equal(manifest.g06_acceptance_changed,'NO');
  assert.equal(manifest.schedule_large_batch_postgres_batch_size,120);
  assert.equal(manifest.schedule_large_batch_business_logic_change,'NO');
  assert.equal(manifest.schedule_large_batch_atomicity,'PRESERVED');
});
test('read-only release revalidation accepts only no-database-change plan',async()=>{
  const result=await verify({env:{},readFacts:async()=>({plan:'PLAN_NO_DATABASE_CHANGE'}),run:async(options)=>options.observe({}, {}, ()=>{})});
  assert.equal(result.plan,'PLAN_NO_DATABASE_CHANGE');
  for(const plan of ['PLAN_APPLY_001_THEN_002','PLAN_APPLY_002_ONLY','PLAN_FAIL_CLOSED','PLAN_HISTORY_RECOVERY_REQUIRED']) {
    await assert.rejects(verify({env:{},readFacts:async()=>({plan}),run:async(options)=>options.observe({}, {}, ()=>{})}),/PREAPPLIED_SCHEMA_NOT_VALID/);
  }
});
test('unchanged-schema release accepts historical G06 evidence only with exact ancestry and schema identity',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-approved-production-v2.yml','utf8');
  const block=workflow.split('      - name: Revalidate unchanged Attendance schema read-only')[1].split('      - name: Revalidate pre-applied Production database state')[0];
  assert(block.includes("needs.prepare.outputs.database_change_policy == 'NO_DATABASE_CHANGES'"));
  assert(block.includes('git diff --quiet "$CURRENT_PRODUCTION_SOURCE_SHA" "$TARGET_SHA" -- prisma/schema.prisma prisma/migrations'));
  assert(block.includes("['merge-base', '--is-ancestor', sha, currentProductionSha]"));
  assert(block.includes("['diff', '--quiet', sha, currentProductionSha, '--', 'prisma/schema.prisma', 'prisma/migrations']"));
  assert(block.includes('HISTORY_BASELINE_TREE_MISMATCH'));
  assert(block.includes('HISTORY_BASELINE_NOT_ANCESTOR'));
  assert(block.includes('HISTORY_BASELINE_SCHEMA_MISMATCH'));
  assert.doesNotMatch(block,/manifest\.application\.sha !== process\.env\.CURRENT_PRODUCTION_SOURCE_SHA/);
  assert(block.includes('PRODUCTION_CANDIDATE_MANIFEST=/tmp/unchanged-attendance-history.json node scripts/ci/verify-preapplied-attendance-policy-readonly.js'));
  assert.doesNotMatch(block,/migrate deploy|migrate resolve|db push/);
  assert(workflow.includes("process.env.DATABASE_CHANGE_POLICY === 'NO_DATABASE_CHANGES'"));
  assert(workflow.includes("test \"$DATABASE_CHANGE_POLICY\" = 'NO_DATABASE_CHANGES' ||"));
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
