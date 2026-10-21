'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MIGRATION_PATH,
  validateProductionBaseline,
  compareBaselineTransition,
} = require('../scripts/ci/verify-pre-applied-migration-production-baseline');
const collector = require('../scripts/ci/trusted-production-baseline-collector');

const root = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smsv3-baseline-'));
const fixtureManifest = path.join(fixtureRoot, MIGRATION_PATH);
fs.mkdirSync(path.dirname(fixtureManifest), { recursive: true });
fs.copyFileSync(path.join(root, MIGRATION_PATH), fixtureManifest);
const sha = 'a'.repeat(40);
const rollback = 'dpl_3a3nmJesfu4SrKKF1EbKsuzoy8Lf';
const recordRel = '.tmp-baseline-record.json';

function resetFixtureManifest() {
  fs.copyFileSync(path.join(root, MIGRATION_PATH), path.join(fixtureRoot, MIGRATION_PATH));
}

function writeRecord() {
  fs.writeFileSync(path.join(fixtureRoot, recordRel), JSON.stringify({
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
    vercel: { vercelCanonicalIdentity: 'DEFERRED_TO_PROTECTED_ENVIRONMENT' },
    runtime: { health: { status: 'ok' }, ready: { status: 'ready', database: 'ok' } },
  };
}
function rejects(mutator, pattern) { const input = valid(); mutator(input); assert.throws(() => validateProductionBaseline(input, { repositoryRoot: fixtureRoot }), pattern); }

test.afterEach(() => { try { fs.unlinkSync(path.join(fixtureRoot, recordRel)); } catch {} resetFixtureManifest(); });
test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('manifest malformed scalar and collection values fail closed', () => {
  for (const value of ['null', '', ' ', 1, false, [], {}]) {
    const manifest = JSON.parse(fs.readFileSync(fixtureManifest, 'utf8'));
    manifest.current_production_deployment_id = value;
    fs.writeFileSync(fixtureManifest, JSON.stringify(manifest));
    assert.throws(() => validateProductionBaseline(valid(), { repositoryRoot: fixtureRoot }), /deployment|malformed/);
  }
});

test('safe path rejects missing records and traversal variants', () => {
  const input = valid();
  for (const recordPath of ['missing.json', '../escape.json', '/etc/hosts', '']) {
    input.recordPath = recordPath;
    assert.throws(() => validateProductionBaseline(input, { repositoryRoot: fixtureRoot }), /missing|unsafe|escapes|ENOENT/);
  }
});

test('URL normalization rejects confusion and non-GET endpoint inputs', () => {
  for (const url of ['https://sms-v3-staging-ten.vercel.app.:443/', 'https://sms-v3-staging-ten.vercel.app:8443/', 'https://evil.com@api.vercel.com/', 'https://api.vercel.com/%2e%2e/secret']) {
    assert.throws(() => collector.normalizeCanonicalUrl(url), /canonical/);
  }
});

test('invariant drift is detected while request and timing metadata remains volatile', () => {
  const baseline = { immutable: { deployment: rollback }, request_id: 'one', duration_ms: 1, updated_at: 'a' };
  const changed = { immutable: { deployment: 'dpl_other' }, request_id: 'two', duration_ms: 2, updated_at: 'b' };
  assert.notEqual(collector.invariantFingerprint(baseline), collector.invariantFingerprint(changed));
  assert.equal(collector.invariantFingerprint(baseline), collector.invariantFingerprint({ ...baseline, request_id: 'three', duration_ms: 99 }));
});

test('sanitizer rejects secret-like log text and nested fields', () => {
  assert.throws(() => collector.sanitizeBaseline({ log: 'Authorization: Bearer hidden' }), /sensitive/);
  assert.throws(() => collector.sanitizeBaseline({ nested: { signed_url: 'hidden' } }), /sensitive/);
});

test('literal null baseline passes, while non-null exact match bypasses evidence and mismatch fails', () => {
  const input = valid();
  assert.equal(validateProductionBaseline(input, { repositoryRoot: fixtureRoot }).mode, 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE');
  const manifest = JSON.parse(fs.readFileSync(fixtureManifest, 'utf8'));
  const original = manifest.current_production_deployment_id;
  manifest.current_production_deployment_id = rollback;
  fs.writeFileSync(fixtureManifest, JSON.stringify(manifest));
  try { assert.equal(validateProductionBaseline(input, { repositoryRoot: fixtureRoot }).mode, 'NON_NULL_EXACT'); }
  finally { manifest.current_production_deployment_id = original; fs.writeFileSync(fixtureManifest, JSON.stringify(manifest, null, 2) + '\n'); }
});

test('bounded parser rejects duplicate, malformed, oversized and deeply nested JSON', () => {
  assert.throws(() => collector.parseBoundedJson('{"a":1,"a":2}'), /duplicate/);
  assert.throws(() => collector.parseBoundedJson('{'), /malformed|unterminated/);
  assert.throws(() => collector.parseBoundedJson(' '.repeat(collector.MAX_JSON_BYTES + 1)), /size/);
  assert.throws(() => collector.parseBoundedJson('['.repeat(collector.MAX_JSON_DEPTH + 1) + '0' + ']'.repeat(collector.MAX_JSON_DEPTH + 1)), /nesting/);
});

test('safe path verification rejects absolute traversal and symlink escape', () => {
  writeRecord();
  assert.throws(() => collector.verifySafeRecordPath(fixtureRoot, path.join(root, recordRel)), /unsafe|escapes/);
  assert.throws(() => collector.verifySafeRecordPath(fixtureRoot, '../escape.json'), /unsafe|escapes/);
  const link = path.join(fixtureRoot, '.tmp-baseline-link.json');
  fs.symlinkSync('/etc/hosts', link);
  try { assert.throws(() => collector.verifySafeRecordPath(fixtureRoot, '.tmp-baseline-link.json'), /symlink/); } finally { fs.unlinkSync(link); }
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
  assert.equal(validateProductionBaseline(input, { repositoryRoot: fixtureRoot }).mode, 'SELFIE_POLICY_EXPLICIT_NULL_EVIDENCE');
  assert.equal(fs.existsSync(marker), false);
});

test('GitHub/Vercel collectors enforce GET-only allowlists and double reads', async () => {
  const calls = []; let n = 0;
  const request = async (url, init) => { calls.push([url, init.method]); n += 1; return { status: 200, headers: new Map(), json: async () => url.includes('/deployments/') ? (url.includes('/statuses') ? [{ state: 'success', created_at: '2026-10-20T00:00:00Z' }] : { id: rollback, projectId: 'prj_x', ownerId: 'team_x', target: 'production', readyState: 'READY', meta: { githubCommitSha: sha } }) : url.includes('/aliases/') ? { deployment: { id: rollback } } : [{ id: 1, sha, environment: 'Production', created_at: '2026-10-20T00:00:00Z' }], text: async () => '' }; };
  await collector.collectGithub({ request, repository: 'o/r', expectedSha: sha, rollbackId: rollback });
  assert.ok(calls.every(([, method]) => method === 'GET'));
  assert.ok(n > 0);
});

test('pre-gate deferred collector makes zero Vercel requests and emits deterministic state', () => {
  let requests = 0;
  const deferred = collector.collectDeferredVercel({ request: () => { requests += 1; } });
  assert.deepEqual(deferred, { vercelCanonicalIdentity: 'DEFERRED_TO_PROTECTED_ENVIRONMENT' });
  assert.equal(requests, 0);
  assert.equal(collector.invariantFingerprint(deferred), collector.invariantFingerprint({ ...deferred }));
});

test('protected Vercel collector requires token and performs deployment plus alias double reads', async () => {
  const calls = [];
  const request = async (url, init) => {
    calls.push([url, init.method]);
    return { status: 200, headers: new Map(), json: async () => url.includes('/aliases/')
      ? { deployment: { id: rollback } }
      : { id: rollback, projectId: 'prj_x', ownerId: 'team_x', target: 'production', readyState: 'READY', meta: { githubCommitSha: sha } } };
  };
  await assert.rejects(() => collector.collectVercel({ request, token: '', teamId: 'team_x', projectId: 'prj_x', deploymentId: rollback, canonicalUrl: 'https://sms-v3-staging-ten.vercel.app' }), /token/);
  const verified = await collector.collectVercel({ request, token: 'fixture-token', teamId: 'team_x', projectId: 'prj_x', deploymentId: rollback, canonicalUrl: 'https://sms-v3-staging-ten.vercel.app' });
  assert.equal(verified.vercelCanonicalIdentity, 'VERIFIED_IN_PROTECTED_ENVIRONMENT');
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(([url]) => url.includes('/deployments/')).length, 2);
  assert.equal(calls.filter(([url]) => url.includes('/aliases/')).length, 2);
  assert.ok(calls.every(([, method]) => method === 'GET'));
});

test('protected Vercel collector requires exact ownerId and preserves every identity/state guard', async () => {
  const base = { id: rollback, projectId: 'prj_x', ownerId: 'team_x', target: 'production', readyState: 'READY', meta: { githubCommitSha: sha } };
  const collect = async (deployment) => collector.collectVercel({
    request: async (url) => ({ status: 200, headers: new Map(), json: async () => url.includes('/aliases/') ? { deployment: { id: rollback } } : deployment }),
    token: 'fixture-token', teamId: 'team_x', projectId: 'prj_x', deploymentId: rollback,
    canonicalUrl: 'https://sms-v3-staging-ten.vercel.app',
  });
  await collect(base);
  for (const [label, mutate] of [
    ['missing ownerId', d => { delete d.ownerId; }],
    ['wrong ownerId', d => { d.ownerId = 'team_other'; }],
    ['teamId fallback only', d => { delete d.ownerId; d.teamId = 'team_x'; }],
    ['wrong id', d => { d.id = 'dpl_other'; }],
    ['wrong project', d => { d.projectId = 'prj_other'; }],
    ['wrong target', d => { d.target = 'preview'; }],
    ['wrong ready state', d => { d.readyState = 'BUILDING'; }],
    ['malformed source SHA', d => { d.meta.githubCommitSha = 'not-a-sha'; }],
  ]) {
    const mutatedDeployment = JSON.parse(JSON.stringify(base));
    mutate(mutatedDeployment);
    await assert.rejects(() => collect(mutatedDeployment), /mismatch/, label);
  }
  await assert.rejects(() => collector.collectVercel({
    request: async () => ({ status: 200, headers: new Map(), json: async () => ({ deployment: { id: 'dpl_other' } }) }),
    token: 'fixture-token', teamId: 'team_x', projectId: 'prj_x', deploymentId: rollback,
    canonicalUrl: 'https://sms-v3-staging-ten.vercel.app',
  }), /canonical alias target mismatch/);
});

test('baseline comparator permits only deferred to verified transition and catches forged or shared drift', () => {
  const prior = valid();
  const priorResult = validateProductionBaseline(prior, { repositoryRoot: fixtureRoot });
  const current = JSON.parse(JSON.stringify(priorResult.baseline));
  current.vercel = { vercelCanonicalIdentity: 'VERIFIED_IN_PROTECTED_ENVIRONMENT', deploymentId: rollback, projectId: 'prj_x', teamId: 'team_x', target: 'production', readyState: 'READY', sourceSha: sha, canonicalAliasTarget: rollback };
  current.release = prior.release;
  assert.equal(compareBaselineTransition(priorResult.baseline, current), true);
  assert.throws(() => compareBaselineTransition({ ...priorResult.baseline, vercel: {} }, current), /deferred/);
  assert.throws(() => compareBaselineTransition({ ...priorResult.baseline, vercel: { vercelCanonicalIdentity: 'VERIFIED_IN_PROTECTED_ENVIRONMENT' } }, current), /deferred/);
  assert.throws(() => compareBaselineTransition(priorResult.baseline, { ...current, runtime: { health: { status: 'tampered' } } }), /drift/);
});

// Keep the existing release-workflow assertions in the dedicated workflow contract suite.
test('trusted modules are syntax-valid and export the immutable guard API', () => {
  assert.equal(typeof validateProductionBaseline, 'function');
  assert.equal(typeof collector.collectVercel, 'function');
  assert.equal(MIGRATION_PATH, collector.SELFIE_MANIFEST);
});
