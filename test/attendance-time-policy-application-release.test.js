'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { verify } = require('../scripts/ci/verify-preapplied-attendance-policy-readonly');
const { validateReleaseManifest } = require('../scripts/ci/verify-release-manifest');
test('archived R5-A readiness pins historical source, checkpoint and no database changes',()=>{
  const manifest=JSON.parse(fs.readFileSync('.github/releases/r5-a-production-manifest-archive-20261009.json'));
  const valid=validateReleaseManifest(manifest);
  assert.equal(valid.commitSha,'51c5c828689ce543067c687e204eba7918577bb9');
  assert.equal(valid.treeSha,'f82ae344666a7774d7c5ec78dc113cc2c2ed9e63');
  assert.equal(valid.currentProductionSourceSha,'59fb7f9ea4de1ab3403d16f1a750aec01c66de91');
  assert.equal(valid.rollbackDeploymentId,'dpl_J8ss5NqiDZu33QpAc8Bfrt9DvX1x');
  assert.equal(valid.preAppliedMigrationEvidenceRunId,'');
  assert.equal(valid.runMigrations,false);
  assert.equal(valid.databaseChangePolicy,'NO_DATABASE_CHANGES');
  assert.equal(valid.productionEnvironmentChangePolicy,'NO_ENVIRONMENT_CHANGES');
  assert.deepEqual(manifest.application_pr_numbers,[541,543]);
  assert.deepEqual(manifest.excluded_open_pr_numbers,[530]);
  assert.equal(manifest.application_exact_sha_ci_run_id,37757672375);
  assert.equal(manifest.release_source_exact_sha_ci_run_id,37757672375);
  assert.equal(manifest.preview_technical_smoke_run_id,37757879448);
  assert.equal(manifest.preview_technical_smoke_passed,11);
  assert.equal(manifest.preview_technical_smoke_failed,0);
  assert.equal(manifest.preview_technical_smoke_skipped,23);
  assert.equal(manifest.preview_trusted_cors_status,'PASS');
  assert.equal(manifest.preview_untrusted_cors_status,'REJECTED_403');
  assert.equal(manifest.production_canonical_deployment_id_before_release,'dpl_J8ss5NqiDZu33QpAc8Bfrt9DvX1x');
  assert.equal(manifest.production_canonical_source_sha_before_release,'59fb7f9ea4de1ab3403d16f1a750aec01c66de91');
  assert.equal(manifest.project_auto_assign_custom_domains,'VERIFY_FALSE_IN_PROTECTED_WORKFLOW_BEFORE_CANDIDATE');
  assert.equal(manifest.g06_acceptance_status,'CLOSED');
  assert.equal(manifest.g06_acceptance_changed,'NO');
  assert.equal(manifest.schedule_large_batch_postgres_batch_size,500);
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
  assert(workflow.includes('Critical UI sentinels: PASS (20/20) base contract'));
  assert(workflow.includes('ตารางผู้มีอำนาจอนุมัติและกรอบเวลา'));
  assert(workflow.includes('เกณฑ์ SLA'));
  assert(!workflow.includes('Approval Authority Matrix / SLA'));
  assert(workflow.includes('Attendance Time Policy sentinels: PASS (3/3 additional)'));
  assert(workflow.includes("sentinels.push('นโยบายเวลาลงงาน','ผ่อนผันการมาสาย (นาที)','latestCheckInEnabled')"));
});
test('archived R5-A readiness retains historical Owner approval and immutable policy boundaries', () => {
  const manifest = JSON.parse(fs.readFileSync('.github/releases/r5-a-production-manifest-archive-20261009.json', 'utf8'));
  assert.equal(manifest.release_batch_id, 'R5-A');
  assert.equal(manifest.owner_batch_frozen_sha_approval, 'PENDING_NOT_AUTHORIZED');
  assert.equal(manifest.production_dispatch_authorized, false);
  assert.equal(manifest.preview_runtime_sentinels_status, 'PASS');
  assert.equal(manifest.preview_runtime_sentinels_count, 23);
  assert.equal(manifest.license_reconciliation_policy, 'BANGKOK_TODAY_FUTURE_BLOCK_RESTORE_PAST_IMMUTABLE_APPROVAL_UNCHANGED');
  assert.equal(manifest.deployment_time_data_mutation, 'NONE');
  assert.equal(manifest.css_bundle_budget_bytes, 700000);
  assert.ok(manifest.css_bundle_bytes < manifest.css_bundle_budget_bytes);
  assert.deepEqual(manifest.excluded_uncommitted_tasks, ['T08']);
});
