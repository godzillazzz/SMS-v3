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
  build_timestamp: '2026-01-01T00:00:00.000Z', backend_git_sha: 'a'.repeat(40),
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
  assert.equal(verifyFrontendRelease({ manifest, servedRoot: root, backendGitSha: identity.git_sha }).git_sha, identity.git_sha);
  assert.throws(() => verifyFrontendRelease({ manifest, servedRoot: root, backendGitSha: 'c'.repeat(40) }), /pairing/);
  fs.writeFileSync(path.join(root, 'assets/app.js'), 'tampered');
  assert.throws(() => verifyFrontendRelease({ manifest, servedRoot: root, backendGitSha: identity.git_sha }), /inventory/);
});

test('rejects symlinked assets and path traversal metadata', () => {
  const root = tree({ 'index.html': 'ok' });
  fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'link.js'));
  assert.throws(() => generateFrontendManifest(root, identity), /symlink/);
  const bad = { ...generateFrontendManifest(tree({ 'index.html': 'ok' }), identity), assets: [{ path: '../escape', bytes: 1, sha256: '0'.repeat(64) }] };
  assert.throws(() => verifyFrontendRelease({ manifest: bad, servedRoot: root, backendGitSha: identity.git_sha }), /path/);
});

test('atomically switches and restores scratch full-stack release while preserving environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-'));
  const beforeEnv = { NODE_ENV: 'test', STORAGE_PROVIDER: 'minio' };
  const result = rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: 'b'.repeat(40), environment: beforeEnv, failAfterSwitch: true });
  assert.equal(result.restored, true);
  assert.equal(result.activeSha, 'b'.repeat(40));
  assert.deepEqual(result.environment, beforeEnv);
  assert.equal(fs.existsSync(path.join(root, 'releases', 'a'.repeat(40))), true);
  assert.equal(fs.existsSync(path.join(root, 'releases', 'b'.repeat(40))), true);
});

test('refuses rollback target marked incompatible with MinIO-only or mixed-provider reads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-rehearsal-'));
  assert.throws(() => rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: 'b'.repeat(40), environment: {}, rollbackTargetStorage: 'MIXED_PROVIDER_READS' }), /storage compatibility/);
  assert.throws(() => rehearseAtomicRollback({ root, releaseSha: 'a'.repeat(40), previousSha: 'b'.repeat(40), environment: {}, rollbackTargetStorage: 'MINIO_ONLY_READS' }), /storage compatibility/);
});
