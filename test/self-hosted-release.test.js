'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inventory, manifestDigest, verifyRelease, COMPATIBILITY } = require('../scripts/self-hosted-release');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-release-rehearsal-'));
  const release = path.join(root, `sms-v3-${'a'.repeat(40)}`);
  fs.mkdirSync(path.join(release, 'backend'), { recursive: true }); fs.mkdirSync(path.join(release, 'frontend', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(release, 'backend', 'server.js'), 'console.log("synthetic backend");\n');
  fs.writeFileSync(path.join(release, 'frontend', 'dist', 'index.html'), '<!doctype html><script src="app.js"></script>\n');
  fs.writeFileSync(path.join(release, 'frontend', 'dist', 'app.js'), 'window.__RELEASE__ = "synthetic";\n');
  const backend = inventory(path.join(release, 'backend')); const frontend = inventory(path.join(release, 'frontend', 'dist'));
  const manifest = { schema_version: 1, release_id: path.basename(release), git_sha: 'a'.repeat(40), tree_sha: 'b'.repeat(40), build_identity: 'synthetic@test', toolchain: { node: process.version, npm: 'synthetic' }, backend_inventory_digest: backend.digest, frontend_inventory_digest: frontend.digest, storage_compatibility: { mode: COMPATIBILITY, database_authoritative: true, mixed_provider_reads: true, providers: ['supabase', 's3'] }, previous_rollback_release: null, asset_hashes: frontend.entries };
  manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(path.join(release, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { root, release };
}

test('verifies a paired release and rejects tampered static assets', () => {
  const { root, release } = fixture();
  try { assert.equal(verifyRelease(release).manifest.git_sha, 'a'.repeat(40)); fs.appendFileSync(path.join(release, 'frontend', 'dist', 'app.js'), 'tampered'); assert.throws(() => verifyRelease(release), /frontend inventory digest mismatch/); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cutover defaults to read-only and does not touch production paths', () => {
  const { root, release } = fixture(); const app = path.join(root, 'app'); const web = path.join(root, 'webroot');
  try { const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/self-hosted-release.js'), 'cutover', '--release', release, '--app', app, '--webroot', web], { encoding: 'utf8' }); assert.equal(result.status, 0); assert.match(result.stdout, /CUTOVER=DRY_RUN/); assert.equal(fs.existsSync(app), false); assert.equal(fs.existsSync(web), false); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('failed gated cutover restores both prior pointers and leaves env untouched', () => {
  const { root, release } = fixture(); const previous = path.join(root, 'previous'); const app = path.join(root, 'app'); const web = path.join(root, 'webroot'); const env = path.join(root, 'app.env');
  fs.mkdirSync(path.join(previous, 'frontend', 'dist'), { recursive: true }); fs.mkdirSync(path.join(previous, 'backend')); fs.writeFileSync(path.join(previous, 'frontend', 'dist', 'index.html'), 'previous'); fs.writeFileSync(path.join(previous, 'backend', 'server.js'), 'previous'); fs.writeFileSync(env, 'SYNTHETIC_ENV=preserved\n');
  fs.symlinkSync(path.join(previous, 'backend'), app, 'dir'); fs.symlinkSync(path.join(previous, 'frontend', 'dist'), web, 'dir');
  try { const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/self-hosted-release.js'), 'cutover', '--release', release, '--app', app, '--webroot', web, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER', '--health-command', 'exit 1'], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.equal(fs.realpathSync(app), path.join(previous, 'backend')); assert.equal(fs.realpathSync(web), path.join(previous, 'frontend', 'dist')); assert.equal(fs.readFileSync(env, 'utf8'), 'SYNTHETIC_ENV=preserved\n'); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects a release without mixed-provider compatibility', () => {
  const { root, release } = fixture();
  try { const file = path.join(release, 'release-manifest.json'); const manifest = JSON.parse(fs.readFileSync(file)); manifest.storage_compatibility.providers = ['s3']; delete manifest.manifest_sha256; manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(file, JSON.stringify(manifest)); assert.throws(() => verifyRelease(release), /does not support both Supabase and MinIO\/S3 reads/); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
