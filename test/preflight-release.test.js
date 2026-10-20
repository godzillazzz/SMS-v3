'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { parseDeploymentId, policyChecks, canRepointCheckpoint, selectCanonicalRecord, checkpointBinding, postReleaseRecords, BRANCH } = require('../scripts/ci/preflight-release');

const base = {
  commit_sha: 'a'.repeat(40),
  tree_sha: 'b'.repeat(40),
  run_migrations: false,
  source_branch: BRANCH,
  database_change_policy: 'NO_DATABASE_CHANGES',
  pre_applied_migration_manifest_path: null,
  pre_applied_migration_evidence_run_id: null
};

test('extracts the deployment id from a release summary block', () => {
  const log = '2026-10-18T23:30:00Z   echo "- Deployment ID: dpl_AjuwwRddeiq4WYZhB6S62GHYetea"';
  assert.equal(parseDeploymentId(log), 'dpl_AjuwwRddeiq4WYZhB6S62GHYetea');
  assert.equal(parseDeploymentId('no deployment here'), null);
  assert.equal(parseDeploymentId(undefined), null);
});

test('a no-database-change manifest must not reference migration evidence', () => {
  const checks = policyChecks(base);
  assert.ok(checks.every(([, ok]) => ok), 'expected every baseline check to pass');
  const stale = policyChecks({ ...base, pre_applied_migration_evidence_run_id: 123 })
    .find(([name]) => name.includes('no migration evidence is referenced'));
  assert.equal(stale[1], false, 'a stale evidence run id must fail the preflight');
});

test('a pre-applied manifest must reference its evidence', () => {
  const checks = policyChecks({
    ...base,
    database_change_policy: 'PRE_APPLIED_APPROVED_MIGRATION',
    pre_applied_migration_manifest_path: '.github/releases/approved-attendance-multilevel-production-migration.json',
    pre_applied_migration_evidence_run_id: 39138082308
  });
  assert.ok(checks.every(([, ok]) => ok));
});

test('an unknown policy fails closed', () => {
  const checks = policyChecks({ ...base, database_change_policy: 'WHATEVER' });
  assert.equal(checks.at(-1)[1], false);
});

test('run_migrations must always be false', () => {
  const checks = policyChecks({ ...base, run_migrations: true });
  assert.equal(checks.find(([name]) => name.includes('run_migrations'))[1], false);
});

test('never repoints the rollback checkpoint at the deployment this manifest produced', () => {
  const manifest = { release_id: 'rel-1', commit_sha: 'a'.repeat(40) };
  const record = {
    file: 'docs/releases/x.json',
    record: {
      record_type: 'POST_RELEASE_RECORD',
      approved_manifest: '.github/releases/approved-production.json',
      release_id: 'rel-1',
      deployed: { deployment_id: 'dpl_live', source_sha: 'a'.repeat(40) }
    }
  };
  const blocked = canRepointCheckpoint(manifest, { id: 'dpl_live' }, [record]);
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /already deployed/);
});

test('a record for a different release does not block the next release', () => {
  const manifest = { release_id: 'rel-2', commit_sha: 'c'.repeat(40) };
  const record = {
    file: 'docs/releases/x.json',
    record: {
      record_type: 'POST_RELEASE_RECORD',
      approved_manifest: '.github/releases/approved-production.json',
      release_id: 'rel-1',
      deployed: { deployment_id: 'dpl_old', source_sha: 'a'.repeat(40) }
    }
  };
  assert.equal(canRepointCheckpoint(manifest, { id: 'dpl_live' }, [record]).ok, true);
});

test('fails closed when two records bind to the same manifest', () => {
  const manifest = { release_id: 'rel-1', commit_sha: 'a'.repeat(40) };
  const make = (deploymentId) => ({
    file: `docs/releases/${deploymentId}.json`,
    record: {
      record_type: 'POST_RELEASE_RECORD',
      approved_manifest: '.github/releases/approved-production.json',
      release_id: 'rel-1',
      deployed: { deployment_id: deploymentId, source_sha: 'a'.repeat(40) }
    }
  });
  const result = canRepointCheckpoint(manifest, { id: 'dpl_live' }, [make('dpl_live'), make('dpl_other')]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /multiple/);
});

test('fails closed when the bound record points at a deployment that is not live', () => {
  const manifest = { release_id: 'rel-1', commit_sha: 'a'.repeat(40) };
  const record = {
    file: 'docs/releases/x.json',
    record: {
      record_type: 'POST_RELEASE_RECORD',
      approved_manifest: '.github/releases/approved-production.json',
      release_id: 'rel-1',
      deployed: { deployment_id: 'dpl_stale', source_sha: 'a'.repeat(40) }
    }
  };
  const result = canRepointCheckpoint(manifest, { id: 'dpl_live' }, [record]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /not the live deployment/);
});

// --- F2: canonical post-release resolution ------------------------------------------------
const R8_SOURCE = 'f539ad8a27df3a524ed3268d85a6ee122746b89a';
const R81_SOURCE = '82d692fa58eaa78a6abbc675f1972e1a16a5276b';
const NEXT_SOURCE = 'ba27962a05dae70168497ca02a0f267de9d54762';
const R8_DEPLOYMENT = 'dpl_AjuwwRddeiq4WYZhB6S62GHYetea';
const R81_DEPLOYMENT = 'dpl_BCX2U3CRidPSsMAsTk4XTKqqVF3U';
const R82_SOURCE = 'd76d3ff7b70fe9ad1348cec26b0df200cc937147';
const R82_DEPLOYMENT = 'dpl_4VTx24FVRtDqJjftZ7JB5s2R293k';
const R83_SOURCE = 'b83bac98a07d543820d2982967553bdd52307dc6';
const R83_DEPLOYMENT = 'dpl_EyqC3HkLTgRVp5XUDiL8GTWQFDZT';
const R84_SOURCE = '83fa98c9e9cd19fc09e27b5ad106d3eee9551442';
const R84_DEPLOYMENT = 'dpl_3a3nmJesfu4SrKKF1EbKsuzoy8Lf';
const PRE_R8_DEPLOYMENT = 'dpl_7djFpJVzU4r1FjtKJy9i1w18RYzW';

function makeRecord({ file, releaseId, deploymentId, sourceSha, runId, verifiedAt, previous }) {
  return {
    file,
    record: {
      record_type: 'POST_RELEASE_RECORD',
      approved_manifest: '.github/releases/approved-production.json',
      release_id: releaseId,
      release_head_sha: 'd'.repeat(40),
      deployed: {
        deployment_id: deploymentId,
        source_sha: sourceSha,
        deploy_run_id: runId,
        conclusion: 'SUCCESS',
        verified_at: verifiedAt
      },
      previous_known_good: previous
    }
  };
}

const r8 = makeRecord({
  file: 'docs/releases/R8-post-release-20261018.json',
  releaseId: 'sms-v3-prod-f539ad8-20261018',
  deploymentId: R8_DEPLOYMENT,
  sourceSha: R8_SOURCE,
  runId: 39144111178,
  verifiedAt: '2026-10-18T23:35:00Z',
  previous: { deployment_id: PRE_R8_DEPLOYMENT, source_sha: '9abe378dbc2eb9f181dcffd64bfcb1fd0aae6eb2' }
});

const r81 = makeRecord({
  file: 'docs/releases/R8.1-post-release-20261019.json',
  releaseId: 'sms-v3-prod-82d692f-20261019',
  deploymentId: R81_DEPLOYMENT,
  sourceSha: R81_SOURCE,
  runId: 39208696955,
  verifiedAt: '2026-10-19T06:29:26Z',
  previous: { deployment_id: R8_DEPLOYMENT, source_sha: R8_SOURCE }
});

const r82Manifest = {
  release_id: 'sms-v3-prod-ba27962-20261019',
  commit_sha: NEXT_SOURCE,
  current_production_source_sha: R81_SOURCE,
  rollback_deployment_id: R81_DEPLOYMENT,
  production_canonical_deployment_id_before_release: R81_DEPLOYMENT,
  production_canonical_source_sha_before_release: R81_SOURCE
};

test('canonical post-release resolution selects R8.1 over R8 regardless of filename order', () => {
  for (const entries of [[r8, r81], [r81, r8]]) {
    const selection = selectCanonicalRecord(entries);
    assert.equal(selection.ok, true);
    assert.equal(selection.canonical.deploymentId, R81_DEPLOYMENT);
    assert.equal(selection.canonical.sourceSha, R81_SOURCE);
  }
  // A reverse-lexicographic file name for R8.1 (which sorts before R8-*) must not win.
  const misleading = [
    { ...r8, file: 'docs/releases/AAA-r8.json' },
    { ...r81, file: 'docs/releases/ZZZ-r81.json' }
  ];
  assert.equal(selectCanonicalRecord(misleading).canonical.deploymentId, R81_DEPLOYMENT);
});

test('canonical post-release resolution fails closed on duplicate deployment records', () => {
  const duplicate = makeRecord({
    file: 'docs/releases/R8.1-post-release-copy.json',
    releaseId: 'sms-v3-prod-82d692f-20261019',
    deploymentId: R81_DEPLOYMENT,
    sourceSha: R81_SOURCE,
    runId: 39208696956,
    verifiedAt: '2026-10-19T06:30:00Z',
    previous: { deployment_id: R8_DEPLOYMENT, source_sha: R8_SOURCE }
  });
  const selection = selectCanonicalRecord([r8, r81, duplicate]);
  assert.equal(selection.ok, false);
  assert.match(selection.reason, /duplicate/);
});

test('canonical post-release resolution fails closed on ambiguous ordering', () => {
  const rival = makeRecord({
    file: 'docs/releases/rival.json',
    releaseId: 'sms-v3-prod-rival-20261019',
    deploymentId: 'dpl_Rival000000000000000000000000',
    sourceSha: 'ce721ee780e105b64e2d9c9fd59beaf31dba4eec',
    runId: 39208696955,
    verifiedAt: '2026-10-19T06:29:26Z',
    previous: { deployment_id: R81_DEPLOYMENT, source_sha: R81_SOURCE }
  });
  const selection = selectCanonicalRecord([r8, r81, rival]);
  assert.equal(selection.ok, false);
  assert.match(selection.reason, /ambiguous/);
});

test('canonical post-release resolution fails closed on a conflicting history chain', () => {
  const rewritten = {
    ...r81,
    record: {
      ...r81.record,
      previous_known_good: { deployment_id: PRE_R8_DEPLOYMENT, source_sha: '9abe378dbc2eb9f181dcffd64bfcb1fd0aae6eb2' }
    }
  };
  const selection = selectCanonicalRecord([r8, rewritten]);
  assert.equal(selection.ok, false);
  assert.match(selection.reason, /conflicting post-release history/);
});

test('the canonical record binds the manifest checkpoint and current production source', () => {
  const selection = selectCanonicalRecord([r8, r81]);
  assert.equal(checkpointBinding(r82Manifest, selection.canonical).ok, true);

  const stale = { ...r82Manifest, rollback_deployment_id: R8_DEPLOYMENT, production_canonical_deployment_id_before_release: R8_DEPLOYMENT, current_production_source_sha: R8_SOURCE, production_canonical_source_sha_before_release: R8_SOURCE };
  const binding = checkpointBinding(stale, selection.canonical);
  assert.equal(binding.ok, false);
  assert.match(binding.reason, /canonical deployment/);
  assert.match(binding.reason, /current_production_source_sha/);
});

test('prepare-next-release may repoint forward but never back to an older verified record', () => {
  const records = [r8, r81];
  assert.equal(canRepointCheckpoint(r82Manifest, { id: R81_DEPLOYMENT }, records).ok, true);
  const backwards = canRepointCheckpoint(r82Manifest, { id: R8_DEPLOYMENT }, records);
  assert.equal(backwards.ok, false);
  assert.match(backwards.reason, /backwards/);
  const unknown = canRepointCheckpoint(r82Manifest, { id: 'dpl_Unknown000000000000000000000000' }, records);
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason, /not a verified post-release record/);
});

test('the committed R8 history and current manifest resolve to the newest verified canonical deployment', () => {
  const selection = selectCanonicalRecord(postReleaseRecords());
  assert.equal(selection.ok, true, selection.reason);
  assert.equal(selection.canonical.deploymentId, R84_DEPLOYMENT);
  assert.equal(selection.canonical.sourceSha, R84_SOURCE);
  assert.equal(selection.ordered.length, 6);
  const manifest = JSON.parse(fs.readFileSync('.github/releases/approved-production.json', 'utf8'));
  const binding = checkpointBinding(manifest, selection.canonical);
  assert.equal(binding.ok, true, binding.reason);
  assert.equal(manifest.database_change_policy, 'PRE_APPLIED_APPROVED_MIGRATION');
});
