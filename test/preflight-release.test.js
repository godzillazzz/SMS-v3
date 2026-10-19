'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDeploymentId, policyChecks, canRepointCheckpoint, BRANCH } = require('../scripts/ci/preflight-release');

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
