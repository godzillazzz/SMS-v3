'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const trustedFiles = [
  'trusted-production-baseline-collector.js',
  'verify-pre-applied-migration-production-baseline.js',
];
const sha = 'a'.repeat(40);
const rollback = 'dpl_3a3nmJesfu4SrKKF1EbKsuzoy8Lf';

function extractTrustedModules(destination) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  for (const file of trustedFiles) {
    const source = execFileSync('git', ['show', `${commit}:scripts/ci/${file}`], { cwd: root });
    fs.writeFileSync(path.join(destination, file), source);
  }
  return commit;
}

function writeFixture(rootDir) {
  const manifest = path.join(rootDir, '.github/releases/approved-attendance-selfie-policy-migration.json');
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.copyFileSync(path.join(root, '.github/releases/approved-attendance-selfie-policy-migration.json'), manifest);
  fs.writeFileSync(path.join(rootDir, '.tmp-baseline-record.json'), JSON.stringify({
    record_type: 'POST_RELEASE_RECORD',
    deployed: { deployment_id: rollback, source_sha: sha },
  }));
}

function deferredInput(recordPath) {
  return {
    release: { currentProductionSourceSha: sha, rollbackDeploymentId: rollback },
    recordPath,
    postReleaseRecordVerifierPassed: true,
    github: { paginationComplete: true, latestStatus: 'success' },
    vercel: { vercelCanonicalIdentity: 'DEFERRED_TO_PROTECTED_ENVIRONMENT' },
    runtime: { health: { status: 'ok' }, ready: { status: 'ready', database: 'ok' } },
  };
}

test('workflow-style extraction preserves split-trust deferred and verified behavior', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-trusted-extraction-'));
  const trusted = path.join(fixture, 'trusted');
  fs.mkdirSync(trusted);
  try {
    const extractedCommit = extractTrustedModules(trusted);
    writeFixture(fixture);
    const verifier = require(path.join(trusted, trustedFiles[1]));
    const collector = require(path.join(trusted, trustedFiles[0]));
    assert.match(extractedCommit, /^[0-9a-f]{40}$/);

    let vercelRequests = 0;
    const deferred = collector.collectDeferredVercel({ request: () => { vercelRequests += 1; } });
    assert.deepEqual(deferred, { vercelCanonicalIdentity: 'DEFERRED_TO_PROTECTED_ENVIRONMENT' });
    assert.equal(vercelRequests, 0);

    const prior = verifier.validateProductionBaseline(deferredInput('.tmp-baseline-record.json'), { repositoryRoot: fixture });
    assert.equal(prior.mode, 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE');
    assert.equal(typeof verifier.compareBaselineTransition, 'function');

    const verified = {
      ...prior.baseline,
      vercel: {
        vercelCanonicalIdentity: 'VERIFIED_IN_PROTECTED_ENVIRONMENT',
        deploymentId: rollback,
        projectId: 'prj_fixture',
        teamId: 'team_fixture',
        target: 'production',
        readyState: 'READY',
        sourceSha: sha,
        canonicalAliasTarget: rollback,
      },
      release: { currentProductionSourceSha: sha, rollbackDeploymentId: rollback },
    };
    assert.equal(verifier.compareBaselineTransition(prior.baseline, verified), true);
    assert.throws(() => verifier.compareBaselineTransition({ ...prior.baseline, vercel: {} }, verified), /deferred/);
    assert.throws(() => verifier.compareBaselineTransition(prior.baseline, {
      ...verified,
      vercel: { ...verified.vercel, sourceSha: 'b'.repeat(40) },
    }), /provenance|drift/);
    assert.throws(() => verifier.compareBaselineTransition(prior.baseline, {
      ...verified,
      runtime: { health: { status: 'tampered' } },
    }), /drift/);

    const candidate = path.join(fixture, 'candidate-helper.js');
    fs.writeFileSync(candidate, "throw new Error('candidate helper executed');\n");
    const input = deferredInput('.tmp-baseline-record.json');
    input.candidateHelper = candidate;
    assert.equal(verifier.validateProductionBaseline(input, { repositoryRoot: fixture }).mode, 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
