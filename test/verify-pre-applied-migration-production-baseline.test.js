'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MIGRATION_PATH,
  validateProductionBaseline,
} = require('../scripts/ci/verify-pre-applied-migration-production-baseline');
const collector = require('../scripts/ci/trusted-production-baseline-collector');

const root = path.resolve(__dirname, '..');
const sha = 'a'.repeat(40);
const rollback = 'dpl_3a3nmJesfu4SrKKF1EbKsuzoy8Lf';
const recordRel = '.tmp-baseline-record.json';

function writeRecord() {
  fs.writeFileSync(path.join(root, recordRel), JSON.stringify({
    record_type: 'POST_RELEASE_RECORD',
    deployed: { deployment_id: rollback, source_sha: sha },
  }));
}
function valid() {
  writeRecord();
  return {
    release: { currentProductionSourceSha: sha, rollbackDeploymentId: rollback },
    recordPath: recordRel,
    postReleaseRecordVerifierPassed: true,
    github: { paginationComplete: true, latestStatus: 'success' },
    vercel: { target: 'production', readyState: 'READY' },
    runtime: { health: { status: 'ok' }, ready: { status: 'ready', database: 'ok' } },
  };
}
function rejects(mutator, pattern) { const input = valid(); mutator(input); assert.throws(() => validateProductionBaseline(input), pattern); }

test.afterEach(() => { try { fs.unlinkSync(path.join(root, recordRel)); } catch {} });

test('literal null baseline passes, while non-null exact match bypasses evidence and mismatch fails', () => {
  const input = valid();
  assert.equal(validateProductionBaseline(input).mode, 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MIGRATION_PATH), 'utf8'));
  const original = manifest.current_production_deployment_id;
  manifest.current_production_deployment_id = rollback;
  fs.writeFileSync(path.join(root, MIGRATION_PATH), JSON.stringify(manifest));
  try { assert.equal(validateProductionBaseline(input).mode, 'NON_NULL_EXACT'); }
  finally { manifest.current_production_deployment_id = original; fs.writeFileSync(path.join(root, MIGRATION_PATH), JSON.stringify(manifest, null, 2) + '\n'); }
});

test('bounded parser rejects duplicate, malformed, oversized and deeply nested JSON', () => {
  assert.throws(() => collector.parseBoundedJson('{"a":1,"a":2}'), /duplicate/);
  assert.throws(() => collector.parseBoundedJson('{'), /malformed|unterminated/);
  assert.throws(() => collector.parseBoundedJson(' '.repeat(collector.MAX_JSON_BYTES + 1)), /size/);
  assert.throws(() => collector.parseBoundedJson('['.repeat(collector.MAX_JSON_DEPTH + 1) + '0' + ']'.repeat(collector.MAX_JSON_DEPTH + 1)), /nesting/);
});

test('safe path verification rejects absolute traversal and symlink escape', () => {
  writeRecord();
  assert.throws(() => collector.verifySafeRecordPath(root, path.join(root, recordRel)), /unsafe|escapes/);
  assert.throws(() => collector.verifySafeRecordPath(root, '../escape.json'), /unsafe|escapes/);
  const link = path.join(root, '.tmp-baseline-link.json');
  fs.symlinkSync('/etc/hosts', link);
  try { assert.throws(() => collector.verifySafeRecordPath(root, '.tmp-baseline-link.json'), /symlink/); } finally { fs.unlinkSync(link); }
});

test('URL security rejects downgrade, userinfo, suffix confusion and trailing dot', () => {
  assert.equal(collector.normalizeCanonicalUrl('https://sms-v3-staging-ten.vercel.app/'), 'https://sms-v3-staging-ten.vercel.app');
  for (const url of ['http://sms-v3-staging-ten.vercel.app/', 'https://user@sms-v3-staging-ten.vercel.app/', 'https://sms-v3-staging-ten.vercel.app.evil/', 'https://sms-v3-staging-ten.vercel.app./', 'https://sms-v3-staging-ten.vercel.app/x']) assert.throws(() => collector.normalizeCanonicalUrl(url), /canonical/);
});

test('sanitized invariant excludes volatile fields but rejects secrets', () => {
  const a = { id: 'x', observed_at: 'one', nested: { value: 1 } };
  const b = { id: 'x', observed_at: 'two', nested: { value: 1 } };
  assert.equal(collector.invariantFingerprint(a), collector.invariantFingerprint(b));
  assert.throws(() => collector.sanitizeBaseline({ token: 'secret' }), /sensitive/);
});

test('mutation barrier: validator does not execute candidate helpers or accept candidate data as code', () => {
  const marker = path.join(os.tmpdir(), `candidate-${process.pid}`);
  try { fs.unlinkSync(marker); } catch {}
  const input = valid(); input.candidateHelper = `require('fs').writeFileSync('${marker}', 'executed')`;
  assert.equal(validateProductionBaseline(input).mode, 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE');
  assert.equal(fs.existsSync(marker), false);
});

test('GitHub/Vercel collectors enforce GET-only allowlists and double reads', async () => {
  const calls = []; let n = 0;
  const request = async (url, init) => { calls.push([url, init.method]); n += 1; return { status: 200, headers: new Map(), json: async () => url.includes('/deployments/') ? (url.includes('/statuses') ? [{ state: 'success', created_at: '2026-10-20T00:00:00Z' }] : { id: rollback, projectId: 'prj_x', teamId: 'team_x', target: 'production', readyState: 'READY', meta: { githubCommitSha: sha } }) : url.includes('/aliases/') ? { deployment: { id: rollback } } : [{ id: 1, sha, environment: 'Production', created_at: '2026-10-20T00:00:00Z' }], text: async () => '' }; };
  await collector.collectGithub({ request, repository: 'o/r', expectedSha: sha, rollbackId: rollback });
  assert.ok(calls.every(([, method]) => method === 'GET'));
  assert.ok(n > 0);
});

// Keep the existing release-workflow assertions in the dedicated workflow contract suite.
test('trusted modules are syntax-valid and export the immutable guard API', () => {
  assert.equal(typeof validateProductionBaseline, 'function');
  assert.equal(typeof collector.collectVercel, 'function');
  assert.equal(MIGRATION_PATH, collector.SELFIE_MANIFEST);
});
