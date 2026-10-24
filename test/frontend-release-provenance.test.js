'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  generateFrontendManifest,
  verifyFrontendRelease,
  rehearseAtomicRollback,
} = require('../scripts/ci/frontend-release-provenance');

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-front-'));
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return root;
}

const identity = {
  git_sha: 'a'.repeat(40), tree_sha: 'b'.repeat(40), build_id: 'build-42',
  build_timestamp: '2026-01-01T00:00:00.000Z', backend_git_sha: 'a'.repeat(40), backend_tree_sha: 'b'.repeat(40),
};

const storage = {
  schema_version: 'sms-v3-storage-target/v1', provider: 'postgres+minio',
  capabilities: { database: true, object_storage: true, shared_identity: true, transactional_restore: true },
};

test('generates deterministic asset inventory, hashes, bytes, and manifest digest', () => {
  const root = tree({ 'index.html': '<h1>x</h1>', 'assets/app.js': 'console.log(1);' });
  const manifest = generateFrontendManifest(root, identity);
  assert.deepEqual(manifest.assets.map((x) => x.path), ['assets/app.js', 'index.html']);
  assert.equal(manifest.assets[0].bytes, 15);
  assert.match(manifest.assets[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.manifest_digest, /^[0-9a-f]{64}$/);
  assert.equal(generateFrontendManifest(root, identity).manifest_digest, manifest.manifest_digest);
});

test('verifies served tree and exact backend/frontend SHA pairing', () => {
  const root = tree({ 'index.html': 'ok', 'assets/app.js': 'asset' });
  const manifest = generateFrontendManifest(root, identity);
  assert.equal(verifyFrontendRelease({ manifest, servedRoot: root, backendGitSha: identity.git_sha, backendTreeSha: identity.tree_sha }).git_sha, identity.git_sha);
  assert.throws(() => verifyFrontendRelease({ manifest, servedRoot: root, backendGitSha: 'c'.repeat(40) }), /pairing/);
  fs.writeFileSync(path.join(root, 'assets/app.js'), 'tampered');
  assert.throws(() => verifyFrontendRelease({ manifest, servedRoot: root, backendGitSha: identity.git_sha, backendTreeSha: identity.tree_sha }), /inventory/);
});

test('rejects symlinked assets and path traversal metadata', () => {
  const root = tree({ 'index.html': 'ok' });
  fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'link.js'));
  assert.throws(() => generateFrontendManifest(root, identity), /symlink/);
  const bad = { ...generateFrontendManifest(tree({ 'index.html': 'ok' }), identity), assets: [{ path: '../escape', bytes: 1, sha256: '0'.repeat(64) }] };
  assert.throws(() => verifyFrontendRelease({ manifest: bad, servedRoot: root, backendGitSha: identity.git_sha, backendTreeSha: identity.tree_sha }), /path/);
});

test('atomically switches and restores scratch full-stack release while preserving environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-'));
  const beforeEnv = { NODE_ENV: 'test', STORAGE_PROVIDER: 'minio' };
  fs.writeFileSync(path.join(root, 'environment.json'), `${JSON.stringify(beforeEnv)}\n`);
  fs.mkdirSync(path.join(root, 'releases', 'b'.repeat(40), 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'releases', 'b'.repeat(40), 'backend'), { recursive: true });
  fs.symlinkSync(path.join('releases', 'b'.repeat(40)), path.join(root, 'active'));
  const result = rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: 'b'.repeat(40), environment: beforeEnv, targetMetadata: storage, failAfterSwitch: true });
  assert.equal(result.restored, true);
  assert.equal(result.activeSha, 'b'.repeat(40));
  assert.deepEqual(result.environment, beforeEnv);
  assert.equal(fs.existsSync(path.join(root, 'releases', 'a'.repeat(40))), false);
  assert.equal(fs.existsSync(path.join(root, 'releases', 'b'.repeat(40))), true);
  assert.equal(fs.readlinkSync(path.join(root, 'active')), path.join('releases', 'b'.repeat(40)));
});

test('refuses rollback target marked incompatible with MinIO-only or mixed-provider reads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-'));
  assert.throws(() => rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: 'b'.repeat(40), environment: {}, targetMetadata: { schema_version: 'sms-v3-storage-target/v1', provider: 'minio', capabilities: {} } }), /storage compatibility/);
  assert.throws(() => rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: 'b'.repeat(40), environment: {}, targetMetadata: { schema_version: 'sms-v3-storage-target/v1', provider: 'postgres+minio', capabilities: { database: true } } }), /storage compatibility/);
});

test('does not mutate a non-empty pre-existing release and verifies the active staged manifest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-'));
  const previous = 'b'.repeat(40); const release = 'a'.repeat(40);
  const existing = path.join(root, 'releases', release);
  fs.mkdirSync(path.join(existing, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(existing, 'frontend', 'index.html'), 'original', { mode: 0o640 });
  fs.writeFileSync(path.join(existing, 'keep.txt'), 'keep-me', { mode: 0o600 });
  const before = Object.fromEntries(['frontend/index.html', 'keep.txt'].map((name) => [name, { bytes: fs.readFileSync(path.join(existing, name)), mode: fs.statSync(path.join(existing, name)).mode & 0o777 }]));
  const previousDir = path.join(root, 'releases', previous); fs.mkdirSync(previousDir, { recursive: true });
  fs.symlinkSync(path.join('releases', previous), path.join(root, 'active'));
  const result = rehearseAtomicRollback({ root, releaseSha: release, previousSha: previous, environment: { NODE_ENV: 'candidate' }, targetMetadata: storage });
  assert.equal(result.restored, false);
  assert.equal(fs.realpathSync(path.join(root, 'active')), path.resolve(result.frontendPath, '..'));
  assert.match(fs.readFileSync(path.join(result.frontendPath, 'index.html'), 'utf8'), new RegExp(`^${release}$`));
  for (const [name, expected] of Object.entries(before)) {
    assert.deepEqual(fs.readFileSync(path.join(existing, name)), expected.bytes);
    assert.equal(fs.statSync(path.join(existing, name)).mode & 0o777, expected.mode);
  }
  assert.ok(fs.existsSync(path.join(result.frontendPath, '..', 'provenance-manifest.json')));
});

test('materializes exact candidate environment and restores original bytes and mode on verification failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-'));
  const previous = 'b'.repeat(40); const release = 'a'.repeat(40);
  const envFile = path.join(root, 'environment.json'); const original = Buffer.from('{"NODE_ENV":"original"}\n');
  fs.writeFileSync(envFile, original, { mode: 0o640 });
  fs.mkdirSync(path.join(root, 'releases', previous), { recursive: true }); fs.symlinkSync(path.join('releases', previous), path.join(root, 'active'));
  const candidate = { NODE_ENV: 'candidate', STORAGE_PROVIDER: 'minio' };
  const result = rehearseAtomicRollback({ root, releaseSha: release, previousSha: previous, environment: candidate, targetMetadata: storage, failureStage: 'verification' });
  assert.equal(result.restored, true);
  assert.deepEqual(fs.readFileSync(envFile), original);
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o640);
  assert.equal(fs.readlinkSync(path.join(root, 'active')), path.join('releases', previous));
});

test('rejects environment symlink and directory targets before any write', () => {
  for (const kind of ['symlink', 'directory']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-'));
    const previous = 'b'.repeat(40); fs.mkdirSync(path.join(root, 'releases', previous), { recursive: true });
    fs.symlinkSync(path.join('releases', previous), path.join(root, 'active'));
    const external = path.join(root, 'external.json'); const original = Buffer.from('{"PWNED":false}\n');
    fs.writeFileSync(external, original, { mode: 0o640 });
    const envFile = path.join(root, 'environment.json');
    if (kind === 'symlink') fs.symlinkSync(path.basename(external), envFile);
    else fs.mkdirSync(envFile);
    assert.throws(() => rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: previous, environment: { PWNED: true }, targetMetadata: storage }), /environment destination is unsafe/);
    if (kind === 'symlink') { assert.equal(fs.readlinkSync(envFile), path.basename(external)); assert.deepEqual(fs.readFileSync(external), original); }
    else assert.equal(fs.statSync(envFile).isDirectory(), true);
  }
});

test('materializes absent environment atomically and restores absence after verification failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-')); const previous = 'b'.repeat(40);
  fs.mkdirSync(path.join(root, 'releases', previous), { recursive: true }); fs.symlinkSync(path.join('releases', previous), path.join(root, 'active'));
  const envFile = path.join(root, 'environment.json');
  const result = rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: previous, environment: { NODE_ENV: 'candidate' }, targetMetadata: storage, failureStage: 'verification' });
  assert.equal(result.restored, true); assert.equal(fs.existsSync(envFile), false);
});

test('reports explicit rollback-recovery failure when restoration is injected to fail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-'));
  const previous = 'b'.repeat(40); fs.mkdirSync(path.join(root, 'releases', previous), { recursive: true });
  fs.symlinkSync(path.join('releases', previous), path.join(root, 'active'));
  assert.throws(() => rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: previous, environment: {}, targetMetadata: storage, failureStage: 'restore' }), /rollback recovery failed/);
});
