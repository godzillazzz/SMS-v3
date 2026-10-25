'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { inventory, manifestDigest, verifyRelease, archiveCommit, COMPATIBILITY } = require('../scripts/self-hosted-release');

function fixture(trustedRepo = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-release-rehearsal-')); const repo = trustedRepo || path.join(root, 'trusted-repo');
  if (!trustedRepo) {
    fs.mkdirSync(repo); execFileSync('git', ['init', '-q'], { cwd: repo }); execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo }); execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo }); fs.writeFileSync(path.join(repo, 'provenance.txt'), 'trusted\n'); execFileSync('git', ['add', '.'], { cwd: repo }); execFileSync('git', ['commit', '-qm', 'trusted'], { cwd: repo });
  }
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); const treeSha = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
  const release = path.join(root, `sms-v3-${gitSha}`); fs.mkdirSync(path.join(release, 'backend'), { recursive: true }); fs.mkdirSync(path.join(release, 'frontend', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(release, 'backend', 'server.js'), "const app = require('./app'); app.listen(0);\n"); fs.writeFileSync(path.join(release, 'frontend', 'dist', 'index.html'), '<!doctype html><html><script src="app.js"></script></html>\n'); fs.writeFileSync(path.join(release, 'frontend', 'dist', 'app.js'), 'window.__RELEASE__ = "synthetic";\n');
  const backend = inventory(path.join(release, 'backend')); const frontend = inventory(path.join(release, 'frontend', 'dist')); const manifest = { schema_version: 1, release_id: path.basename(release), git_sha: gitSha, tree_sha: treeSha, build_identity: 'synthetic@test', toolchain: { node: process.version, npm: 'synthetic' }, backend_inventory_digest: backend.digest, frontend_inventory_digest: frontend.digest, storage_compatibility: { mode: COMPATIBILITY, database_authoritative: true, mixed_provider_reads: true, providers: ['supabase', 's3'] }, previous_rollback_release: null, asset_hashes: frontend.entries }; manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(path.join(release, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { root, repo, release, manifest };
}
const opts = f => ({ repo: f.repo, trustedManifestSha256: f.manifest.manifest_sha256 });
const rollbackOpts = (f, r) => ({ repo: f.repo, trustedManifestSha256: f.manifest.manifest_sha256, trustedRollbackManifestSha256: r.manifest.manifest_sha256 });
function cli(f, args) { return spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/self-hosted-release.js'), ...args], { encoding: 'utf8' }); }

test('verifies trusted paired release and rejects tampered static assets', () => { const f = fixture(); try { assert.equal(verifyRelease(f.release, null, opts(f)).manifest.git_sha, f.manifest.git_sha); fs.appendFileSync(path.join(f.release, 'frontend', 'dist', 'app.js'), 'tampered'); assert.throws(() => verifyRelease(f.release, null, opts(f)), /frontend inventory digest mismatch/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('fails closed without external digest or independent provenance', () => { const f = fixture(); try { assert.throws(() => verifyRelease(f.release), /trusted external manifest digest/); assert.throws(() => verifyRelease(f.release, null, { trustedManifestSha256: f.manifest.manifest_sha256 }), /trusted git repository/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('rejects forged manifest even when its self-derived digest is repaired', () => { const f = fixture(); try { const file = path.join(f.release, 'release-manifest.json'); const m = JSON.parse(fs.readFileSync(file)); m.git_sha = 'a'.repeat(40); m.manifest_sha256 = manifestDigest(m); fs.writeFileSync(file, JSON.stringify(m)); assert.throws(() => verifyRelease(f.release, null, { repo: f.repo, trustedManifestSha256: m.manifest_sha256 }), /git\/tree provenance/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('rejects symlink and traversal entries', () => { const f = fixture(); try { fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.release, 'backend', 'link')); assert.throws(() => verifyRelease(f.release, null, opts(f)), /symlink/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('cutover defaults to read-only and requires mandatory trust inputs', () => { const f = fixture(); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot'); try { const result = cli(f, ['cutover', '--release', f.release, '--app', app, '--webroot', web, '--repo', f.repo, '--trusted-manifest-sha256', f.manifest.manifest_sha256]); assert.equal(result.status, 0); assert.match(result.stdout, /CUTOVER=DRY_RUN/); assert.match(result.stdout, /MANDATORY_CHECKS=PASS/); assert.equal(fs.existsSync(app), false); assert.equal(fs.existsSync(web), false); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('rejects arbitrary health command rather than executing shell', () => { const f = fixture(); try { const result = cli(f, ['cutover', '--release', f.release, '--repo', f.repo, '--trusted-manifest-sha256', f.manifest.manifest_sha256, '--health-command', 'touch SHOULD_NOT_EXIST']); assert.equal(result.status, 0); assert.equal(fs.existsSync(path.join(process.cwd(), 'SHOULD_NOT_EXIST')), false); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('rejects split backend/frontend runtime even when shared pointer exists', () => { const f = fixture(); const pointer = path.join(f.root, 'current'); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot'); try { fs.symlinkSync(f.release, pointer, 'dir'); fs.mkdirSync(app); fs.symlinkSync(pointer, web, 'dir'); const result = cli(f, ['cutover', '--release', f.release, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', f.repo, '--trusted-manifest-sha256', f.manifest.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.notEqual(result.status, 0); assert.match(result.stderr, /backend runtime target must be a symlink/); assert.equal(fs.realpathSync(pointer), f.release); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });

test('rejects production layout with a real frontend webroot before changing runtime state', () => { const f = fixture(); const pointer = path.join(f.root, 'current'); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot'); const marker = path.join(web, 'keep.me'); try { fs.symlinkSync(f.release, pointer, 'dir'); fs.symlinkSync(pointer, app, 'dir'); fs.mkdirSync(web); fs.writeFileSync(marker, 'unchanged\\n'); const beforePointer = fs.readlinkSync(pointer); const beforeApp = fs.readlinkSync(app); const result = cli(f, ['cutover', '--release', f.release, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', f.repo, '--trusted-manifest-sha256', f.manifest.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.notEqual(result.status, 0); assert.match(result.stderr, /frontend runtime target must be a symlink/); assert.equal(fs.readlinkSync(pointer), beforePointer); assert.equal(fs.readlinkSync(app), beforeApp); assert.equal(fs.lstatSync(web).isDirectory(), true); assert.equal(fs.readFileSync(marker, 'utf8'), 'unchanged\\n'); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });

test('accepts shared-pointer runtime integration and atomically recovers on failed cutover', () => { const f = fixture(); const next = fixture(); const bad = path.join(f.root, 'bad'); const pointer = path.join(f.root, 'current'); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot'); try { fs.symlinkSync(f.release, pointer, 'dir'); fs.symlinkSync(pointer, app, 'dir'); fs.symlinkSync(pointer, web, 'dir'); const accepted = cli(f, ['cutover', '--release', next.release, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', next.repo, '--trusted-manifest-sha256', next.manifest.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.equal(accepted.status, 0, accepted.stderr); assert.equal(fs.realpathSync(pointer), next.release); fs.cpSync(next.release, bad, { recursive: true }); fs.writeFileSync(path.join(bad, 'backend', 'server.js'), 'not runnable'); const manifest = JSON.parse(fs.readFileSync(path.join(bad, 'release-manifest.json'))); manifest.backend_inventory_digest = inventory(path.join(bad, 'backend'), p => p === 'node_modules' || p.startsWith('node_modules/')).digest; manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(path.join(bad, 'release-manifest.json'), JSON.stringify(manifest)); const rejected = cli(f, ['cutover', '--release', bad, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', next.repo, '--trusted-manifest-sha256', manifest.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.notEqual(rejected.status, 0); assert.equal(fs.realpathSync(pointer), next.release); assert.equal(fs.realpathSync(app), next.release); assert.equal(fs.realpathSync(web), next.release); } finally { fs.rmSync(f.root, { recursive: true, force: true }); fs.rmSync(next.root, { recursive: true, force: true }); } });
test('rejects incompatible provider manifest', () => { const f = fixture(); try { const file = path.join(f.release, 'release-manifest.json'); const m = JSON.parse(fs.readFileSync(file)); m.storage_compatibility.providers = ['s3']; m.manifest_sha256 = manifestDigest(m); fs.writeFileSync(file, JSON.stringify(m)); assert.throws(() => verifyRelease(f.release, null, { repo: f.repo, trustedManifestSha256: m.manifest_sha256 }), /does not support both Supabase/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });


test('requires and independently verifies a distinct rollback trust anchor', () => { const f = fixture(); const r = fixture(f.repo); try { fs.appendFileSync(path.join(r.release, 'frontend', 'dist', 'app.js'), 'rollback'); r.manifest.frontend_inventory_digest = inventory(path.join(r.release, 'frontend', 'dist')).digest; r.manifest.asset_hashes = [{ path: 'app.js', sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(r.release, 'frontend', 'dist', 'app.js'))).digest('hex') }, { path: 'index.html', sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(r.release, 'frontend', 'dist', 'index.html'))).digest('hex') }]; r.manifest.manifest_sha256 = manifestDigest(r.manifest); fs.writeFileSync(path.join(r.release, 'release-manifest.json'), JSON.stringify(r.manifest)); assert.notEqual(f.manifest.manifest_sha256, r.manifest.manifest_sha256); assert.throws(() => verifyRelease(f.release, r.release, opts(f)), /trusted external manifest digest/); assert.equal(verifyRelease(f.release, r.release, rollbackOpts(f, r)).manifest.git_sha, f.manifest.git_sha); assert.throws(() => verifyRelease(f.release, r.release, { ...rollbackOpts(f, r), trustedRollbackManifestSha256: f.manifest.manifest_sha256 }), /trusted external manifest digest/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); fs.rmSync(r.root, { recursive: true, force: true }); } });

test('rejects a file entry swapped to an outside symlink during inventory reads', () => {
  const f = fixture(); const backend = path.join(f.release, 'backend'); const file = path.join(backend, 'server.js'); const secret = path.join(f.root, 'outside-secret');
  fs.writeFileSync(secret, 'must-not-be-read'); const originalReaddir = fs.readdirSync; let swapped = false;
  try {
    fs.readdirSync = function (...args) {
      const entries = originalReaddir.apply(this, args);
      if (!swapped) { swapped = true; fs.unlinkSync(file); fs.symlinkSync(secret, file); }
      return entries;
    };
    assert.throws(() => inventory(backend), /missing regular file|ELOOP|symlink/);
    assert.equal(swapped, true);
  } finally { fs.readdirSync = originalReaddir; fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('reads files from the enumerated directory FD after external regular-directory replacement', () => {
  const f = fixture(); const backend = path.join(f.release, 'backend'); const replacement = path.join(f.root, 'backend-replacement'); const displaced = path.join(f.root, 'backend-displaced');
  fs.cpSync(backend, replacement, { recursive: true }); fs.writeFileSync(path.join(replacement, 'server.js'), 'REPLACED\n');
  const expected = inventory(backend); const originalReaddir = fs.readdirSync; let swapped = false;
  try {
    fs.readdirSync = function (...args) {
      const entries = originalReaddir.apply(this, args);
      if (!swapped && String(args[0]).startsWith('/proc/self/fd/')) { swapped = true; fs.renameSync(backend, displaced); fs.renameSync(replacement, backend); }
      return entries;
    };
    assert.deepEqual(inventory(backend), expected);
    assert.equal(swapped, true);
  } finally {
    fs.readdirSync = originalReaddir;
    if (fs.existsSync(backend)) fs.rmSync(backend, { recursive: true, force: true });
    if (fs.existsSync(displaced)) fs.renameSync(displaced, backend);
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('inventory reads enumerated files from the anchored parent FD', () => { const f = fixture(); const backend = path.join(f.release, 'backend'); const replacement = path.join(f.root, 'backend-replacement'); const old = `${backend}.old`; fs.cpSync(backend, replacement, { recursive: true }); fs.writeFileSync(path.join(replacement, 'server.js'), 'REPLACED\n'); const expected = inventory(backend); const originalReaddir = fs.readdirSync; let swapped = false;
  try { fs.readdirSync = function patchedReaddir(directory, options) { const result = originalReaddir.call(this, directory, options); if (!swapped && typeof directory === 'string' && /\/proc\/self\/fd\//.test(directory)) { swapped = true; fs.renameSync(backend, old); fs.renameSync(replacement, backend); } return result; }; const actual = inventory(backend); assert.equal(swapped, true); assert.deepEqual(actual, expected); } finally { fs.readdirSync = originalReaddir; if (fs.existsSync(backend)) fs.rmSync(backend, { recursive: true, force: true }); if (fs.existsSync(old)) fs.renameSync(old, backend); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('resists concurrent replacement of a parent directory during inventory reads', () => {
  const f = fixture(); const backend = path.join(f.release, 'backend'); const replacement = path.join(f.root, 'backend-replacement');
  fs.cpSync(backend, replacement, { recursive: true }); fs.writeFileSync(path.join(f.root, 'outside-secret'), 'must-not-be-read');
  const expected = inventory(backend); const racer = require('node:child_process').spawn(process.execPath, ['-e', `const fs=require('node:fs'); const p=${JSON.stringify(backend)}; const r=${JSON.stringify(replacement)}; for(let i=0;i<500;i++){try{fs.renameSync(p,p+'.old');fs.symlinkSync(${JSON.stringify(path.join(f.root, 'outside-secret'))},p);fs.unlinkSync(p);fs.renameSync(p+'.old',p);}catch{} }`], { stdio: 'ignore' });
  try { for (let i = 0; i < 100; i++) { try { assert.deepEqual(inventory(backend), expected); } catch (error) { assert.match(error.message, /unsafe directory|symlink|missing|regular file/); } } } finally { racer.kill(); racer.on('close', () => {}); if (fs.existsSync(backend) && fs.lstatSync(backend).isSymbolicLink()) fs.unlinkSync(backend); if (!fs.existsSync(backend)) fs.renameSync(path.join(backend + '.old'), backend); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('restores an absent pointer after post-cutover mandatory-check failure', () => { const f = fixture(); const pointer = path.join(f.root, 'current'); const bad = path.join(f.root, 'bad'); fs.cpSync(f.release, bad, { recursive: true }); fs.writeFileSync(path.join(bad, 'backend', 'server.js'), 'not runnable'); const m = JSON.parse(fs.readFileSync(path.join(bad, 'release-manifest.json'))); m.backend_inventory_digest = inventory(path.join(bad, 'backend')).digest; m.manifest_sha256 = manifestDigest(m); fs.writeFileSync(path.join(bad, 'release-manifest.json'), JSON.stringify(m)); try { const result = cli(f, ['cutover', '--release', bad, '--pointer', pointer, '--repo', f.repo, '--trusted-manifest-sha256', m.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.notEqual(result.status, 0); assert.equal(fs.existsSync(pointer), false); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });

test('archives a commit without buffering git archive stdout', () => { const f = fixture(); const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-archive-stage-')); try { assert.doesNotThrow(() => archiveCommit(f.repo, f.manifest.git_sha, stage)); assert.equal(fs.readFileSync(path.join(stage, 'provenance.txt'), 'utf8'), 'trusted\n'); } finally { fs.rmSync(f.root, { recursive: true, force: true }); fs.rmSync(stage, { recursive: true, force: true }); } });
