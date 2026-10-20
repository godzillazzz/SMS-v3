'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  MIGRATION_PATH,
  validateProductionBaseline,
} = require('../scripts/ci/verify-pre-applied-migration-production-baseline');

const sha = 'a'.repeat(40);
const rollback = 'dpl_3a3nmJesfu4SrKKF1EbKsuzoy8Lf';

function valid() {
  return {
    release: { currentProductionSourceSha: sha, rollbackDeploymentId: rollback },
    migration: {
      migrationId: 'SELFIE-POLICY', manifestPath: MIGRATION_PATH,
      verifierPassed: true, fieldPresent: true, currentProductionDeploymentId: null,
      currentProductionApplicationSha: sha,
    },
    recordPath: 'docs/releases/post-release.json', recordPathExists: true,
    recordPathSymlinkEscape: false, postReleaseRecordVerifierPassed: true,
    postReleaseRecord: { deployed: { deployment_id: rollback, source_sha: sha }, evidence: { github_deployment_id: 123, github_source_sha: sha } },
    github: {
      paginationComplete: true, evidenceDeploymentId: 123, latestDeploymentId: 123,
      deployments: [{ id: 123, sha, environment: 'Production', status: 'success', created_at: '2026-10-20T00:00:00Z' }],
    },
    vercel: { canonical: { id: rollback, target: 'production', state: 'READY', provenanceSha: sha, canonical: true } },
    runtime: { health: { httpStatus: 200, status: 'ok' }, ready: { httpStatus: 200, status: 'ready', database: 'ok' } },
  };
}

function rejects(mutator, pattern) {
  const input = valid(); mutator(input);
  assert.throws(() => validateProductionBaseline(input), pattern);
}

test('non-null exact pass and mismatch does not fall back to null evidence', () => {
  const input = valid(); input.migration.currentProductionDeploymentId = rollback;
  assert.equal(validateProductionBaseline(input).mode, 'NON_NULL_EXACT');
  rejects((x) => { x.migration.currentProductionDeploymentId = 'dpl_other'; }, /does not equal rollback/);
});

test('SELFIE-POLICY explicit null passes only with complete cross-source evidence', () => {
  assert.equal(validateProductionBaseline(valid()).mode, 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE');
});

test('missing, empty, string-null, wrong profile, path and verifier fail closed', () => {
  for (const value of [undefined, '', ' ', 'null', 'NULL']) rejects((x) => { delete x.migration.currentProductionDeploymentId; x.migration.fieldPresent = false; }, /field is missing/);
  rejects((x) => { x.migration.currentProductionDeploymentId = ''; }, /malformed/);
  rejects((x) => { x.migration.currentProductionDeploymentId = 'null'; }, /malformed/);
  rejects((x) => { x.migration.migrationId = 'DEVICE2-SELFIE'; }, /SELFIE-POLICY/);
  rejects((x) => { x.migration.manifestPath = '.github/releases/other.json'; }, /manifest path/);
  rejects((x) => { x.migration.verifierPassed = false; }, /verifier/);
});

test('record path rejects missing, absolute, traversal and symlink escape', () => {
  rejects((x) => { x.recordPath = undefined; x.recordPathExists = false; }, /record path/);
  rejects((x) => { x.recordPath = path.resolve('record.json'); }, /relative/);
  rejects((x) => { x.recordPath = '../record.json'; }, /traversal/);
  rejects((x) => { x.recordPathSymlinkEscape = true; }, /symlink/);
});

test('record verifier, record equality and migration application SHA are mandatory', () => {
  rejects((x) => { x.postReleaseRecordVerifierPassed = false; }, /record verifier/);
  rejects((x) => { x.postReleaseRecord.deployed.deployment_id = 'dpl_wrong'; }, /record deployed deployment/);
  rejects((x) => { x.postReleaseRecord.deployed.source_sha = 'b'.repeat(40); }, /record deployed source/);
  rejects((x) => { x.migration.currentProductionApplicationSha = 'b'.repeat(40); }, /migration current Production application/);
});

test('GitHub ID/SHA/latest/status/pagination and malformed snapshots fail closed', () => {
  rejects((x) => { x.postReleaseRecord.evidence.github_deployment_id = 0; }, /record GitHub deployment ID/);
  rejects((x) => { x.postReleaseRecord.evidence.github_source_sha = 'b'.repeat(40); }, /record GitHub source/);
  rejects((x) => { x.github.paginationComplete = false; }, /pagination/);
  rejects((x) => { x.github.deployments[0].id = '123'; }, /GitHub deployment ID/);
  rejects((x) => { x.github.deployments[0].sha = 'bad'; }, /source SHA/);
  rejects((x) => { x.github.latestDeploymentId = 999; }, /latest GitHub/);
  rejects((x) => { x.github.deployments[0].status = 'failure'; }, /status/);
});

test('Vercel ID/target/state/provenance and health/readiness fail closed', () => {
  rejects((x) => { x.vercel.canonical.id = 'dpl_other'; }, /canonical Vercel deployment ID/);
  rejects((x) => { x.vercel.canonical.target = 'preview'; }, /READY Production/);
  rejects((x) => { x.vercel.canonical.state = 'ERROR'; }, /READY Production/);
  rejects((x) => { x.vercel.canonical.provenanceSha = 'b'.repeat(40); }, /provenance SHA/);
  rejects((x) => { x.runtime.health.httpStatus = 500; }, /health/);
  rejects((x) => { x.runtime.ready.database = 'error'; }, /ready/);
});

test('workflow invokes the guard before and after approval and loads post tools from dispatched SHA', () => {
  const fs = require('node:fs');
  const workflow = fs.readFileSync('.github/workflows/deploy-approved-production-v2.yml', 'utf8');
  const prepare = workflow.indexOf('jobs:\n  prepare:');
  const production = workflow.indexOf('  production:', prepare);
  const gate = workflow.indexOf('environment:\n      name: production-sms-v3-staging', production);
  const preGuard = workflow.indexOf('verify-pre-applied-migration-production-baseline.js', prepare);
  const postGuard = workflow.indexOf('verify-pre-applied-migration-production-baseline.js', production);
  assert.ok(preGuard > prepare && preGuard < production);
  assert.ok(postGuard > gate);
  assert.ok(workflow.indexOf('git show "$GITHUB_SHA:scripts/ci/$tool"') > production);
  assert.ok(workflow.indexOf('verify-pre-applied-migration-production-baseline.js; do') > production);
  assert.ok(workflow.indexOf('npm ci') > postGuard);
  assert.ok(workflow.indexOf('Create Git-sourced immutable Production candidate') > postGuard);
  assert.ok(workflow.includes("currentProductionDeploymentId: null"));
  assert.ok(workflow.includes('ROLLBACK_CHECKPOINT_CURRENT=PASS'));
});
