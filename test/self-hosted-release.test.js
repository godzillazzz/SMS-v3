'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { canonicalizeTree, finalizeReleaseModes, inventory, manifestDigest, validateParentTraversal, validateRoleOwnership, validateRuntimePermissions, verifyRelease, COMPATIBILITY } = require('../scripts/self-hosted-release');

const temporaryGroups = [];
for (const group of ['smsv3']) {
  try { execFileSync('getent', ['group', group], { stdio: 'ignore' }); }
  catch { execFileSync('groupadd', ['--system', group]); temporaryGroups.push(group); }
}
test.after(() => { for (const group of temporaryGroups) { try { execFileSync('groupdel', [group]); } catch {} } });

function chmodTree(root, releaseRoot = root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    const backend = file.includes(`${path.sep}backend${path.sep}`) || file.endsWith(`${path.sep}backend`);
    if (entry.isDirectory()) { fs.chmodSync(file, backend ? 0o750 : 0o755); chmodTree(file, releaseRoot); }
    else fs.chmodSync(file, backend ? 0o640 : 0o644);
  }
  if (root === releaseRoot) fs.chmodSync(root, 0o755);
}

function chownTree(root, uid, gid) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name); fs.chownSync(file, uid, gid); if (entry.isDirectory()) chownTree(file, uid, gid);
  }
  fs.chownSync(root, uid, gid);
}
function gid(name) { return Number(execFileSync('getent', ['group', name], { encoding: 'utf8' }).split(':')[2]); }

function establishFixtureOwnership(release) {
  chownTree(path.join(release, 'backend'), 0, gid('smsv3'));
  chownTree(path.join(release, 'frontend'), 0, gid('www-data'));
  fs.chownSync(release, 0, 0);
  fs.chownSync(path.join(release, 'release-manifest.json'), 0, 0);
}

function runAs(uid, gid, command, args) {
  return spawnSync('setpriv', ['--reuid', String(uid), '--regid', String(gid), '--clear-groups', command, ...args], { encoding: 'utf8' });
}

function fixture(trustedRepo = null) {
  const root = fs.mkdtempSync(path.join('/tmp', 'sms-v3-release-rehearsal-')); const repo = trustedRepo || path.join(root, 'trusted-repo');
  if (!trustedRepo) {
    fs.mkdirSync(repo); execFileSync('git', ['init', '-q'], { cwd: repo }); execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo }); execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo }); fs.writeFileSync(path.join(repo, 'provenance.txt'), 'trusted\n'); execFileSync('git', ['add', '.'], { cwd: repo }); execFileSync('git', ['commit', '-qm', 'trusted'], { cwd: repo });
  }
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); const treeSha = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim();
  const release = path.join(root, `sms-v3-${gitSha}`); fs.mkdirSync(path.join(release, 'backend', 'src'), { recursive: true }); fs.mkdirSync(path.join(release, 'frontend', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(release, 'backend', 'src', 'server.js'), "const app = require('./app'); app.listen(0);\n"); fs.writeFileSync(path.join(release, 'frontend', 'dist', 'index.html'), '<!doctype html><html><script src="app.js"></script></html>\n'); fs.writeFileSync(path.join(release, 'frontend', 'dist', 'app.js'), 'window.__RELEASE__ = "synthetic";\n');
  const backend = inventory(path.join(release, 'backend')); const frontend = inventory(path.join(release, 'frontend', 'dist')); const manifest = { schema_version: 1, release_id: path.basename(release), git_sha: gitSha, tree_sha: treeSha, build_identity: 'synthetic@test', toolchain: { node: process.version, npm: 'synthetic' }, backend_inventory_digest: backend.digest, frontend_inventory_digest: frontend.digest, storage_compatibility: { mode: COMPATIBILITY, database_authoritative: true, mixed_provider_reads: true, providers: ['supabase', 's3'] }, previous_rollback_release: null, asset_hashes: frontend.entries }; manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(path.join(release, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.chmodSync(root, 0o755);
  chmodTree(release);
  fs.chmodSync(release, 0o755);
  establishFixtureOwnership(release);
  return { root, repo, release, manifest };
}
const opts = f => ({ repo: f.repo, trustedManifestSha256: f.manifest.manifest_sha256, parentBoundary: f.root });
const rollbackOpts = (f, r) => ({ repo: f.repo, trustedManifestSha256: f.manifest.manifest_sha256, trustedRollbackManifestSha256: r.manifest.manifest_sha256, parentBoundary: f.root, rollbackParentBoundary: r.root });
function cli(f, args) { const release = args[args.indexOf('--release') + 1]; const rollback = args.indexOf('--rollback-target'); const extra = rollback >= 0 ? ['--rollback-parent-boundary', path.dirname(args[rollback + 1])] : []; const bin = path.join(f.root, 'fake-bin'); fs.mkdirSync(bin, { recursive: true }); fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\nnode -e "require(\\\"http\\\").createServer((q,r)=>r.end(\\\"ok\\\")).listen(18080)" >/dev/null 2>&1 &\nexit 0\n', { mode: 0o755 }); return spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/self-hosted-release.js'), ...args, '--parent-boundary', path.dirname(release), ...extra], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }); }

test('routes the build command into the restored build implementation', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts/self-hosted-release.js'), 'build', '--sha', 'not-a-valid-sha'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--output is required/);
  assert.doesNotMatch(result.stderr, /build is not defined/);
});

test('canonicalizes backend root to 0750 and verify accepts the build permission contract', () => {
  const root = fs.mkdtempSync(path.join('/tmp', 'sms-v3-canonicalize-')); const backend = path.join(root, 'backend');
  try {
    fs.mkdirSync(path.join(backend, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'frontend', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'frontend', 'dist', 'index.html'), '<html></html>');
    fs.chmodSync(path.join(root, 'frontend'), 0o755); fs.chmodSync(path.join(root, 'frontend', 'dist'), 0o755); fs.chmodSync(path.join(root, 'frontend', 'dist', 'index.html'), 0o644);
    fs.chmodSync(root, 0o755);
    fs.writeFileSync(path.join(backend, 'src', 'server.js'), 'backend');
    fs.chmodSync(backend, 0o755); fs.chmodSync(path.join(backend, 'src'), 0o755); fs.chmodSync(path.join(backend, 'src', 'server.js'), 0o644);
    canonicalizeTree(backend, 'backend');
    assert.equal(fs.statSync(backend).mode & 0o777, 0o750);
    assert.equal(fs.statSync(path.join(backend, 'src')).mode & 0o777, 0o750);
    assert.equal(fs.statSync(path.join(backend, 'src', 'server.js')).mode & 0o777, 0o640);
    assert.equal(validateRuntimePermissions(root), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('enforces readable release permissions and rejects unsafe modes', () => {
  const f = fixture();
  try {
    chmodTree(f.release);
    assert.equal(validateRuntimePermissions(f.release), true);
    fs.chmodSync(path.join(f.release, 'backend', 'src', 'server.js'), 0o644);
    assert.throws(() => validateRuntimePermissions(f.release), /file mode must be 640/);
    fs.chmodSync(path.join(f.release, 'backend', 'src', 'server.js'), 0o640);
    fs.chmodSync(path.join(f.release, 'frontend'), 0o755);
    fs.chmodSync(path.join(f.release, 'frontend', 'dist'), 0o755);
    fs.chmodSync(path.join(f.release, 'frontend', 'dist', 'index.html'), 0o644);
    fs.chmodSync(f.release, 0o775);
    assert.throws(() => verifyRelease(f.release, null, opts(f)), /exact 0755/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('role-specific permissions isolate backend from www-data while serving frontend', () => {
  const f = fixture(); const backendFile = path.join(f.release, 'backend', 'src', 'server.js'); const frontendFile = path.join(f.release, 'frontend', 'dist', 'index.html');
  const smsv3Uid = 2001; const smsv3Gid = 2001; const wwwDataUid = 33; const wwwDataGid = 33;
  try {
    chmodTree(f.release);
    chownTree(path.join(f.release, 'backend'), 0, smsv3Gid);
    chownTree(path.join(f.release, 'frontend'), 0, wwwDataGid);
    fs.chownSync(f.release, 0, 0);
    fs.chownSync(path.join(f.release, 'release-manifest.json'), 0, 0);
    const wwwFrontend = runAs(wwwDataUid, wwwDataGid, 'cat', [frontendFile]);
    const wwwBackend = runAs(wwwDataUid, wwwDataGid, 'cat', [backendFile]);
    const smsv3Backend = runAs(smsv3Uid, smsv3Gid, 'cat', [backendFile]);
    assert.equal(wwwFrontend.status, 0, wwwFrontend.stderr);
    assert.equal(wwwBackend.status, 1);
    assert.equal(smsv3Backend.status, 0, smsv3Backend.stderr);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('fails closed on role ownership mismatches and accepts the valid root-owned hierarchy', () => {
  const f = fixture();
  try {
    assert.equal(validateRoleOwnership(f.release), true);
    fs.chownSync(path.join(f.release, 'backend'), 0, gid('www-data'));
    assert.throws(() => validateRoleOwnership(f.release), /backend ownership/);
    establishFixtureOwnership(f.release);
    fs.chownSync(path.join(f.release, 'frontend'), 0, gid('smsv3'));
    assert.throws(() => validateRoleOwnership(f.release), /frontend ownership/);
    establishFixtureOwnership(f.release);
    fs.chownSync(f.release, 33, 0);
    assert.throws(() => validateRoleOwnership(f.release), /release root ownership/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('enforces exact permission contract for files and directories', () => {
  const f = fixture(); const file = path.join(f.release, 'frontend', 'dist', 'app.js'); const directory = path.join(f.release, 'frontend');
  try {
    for (const mode of [0o745, 0o604, 0o755]) {
      fs.chmodSync(file, mode);
      assert.throws(() => validateRuntimePermissions(f.release), /file mode must be 644/);
    }
    fs.chmodSync(file, 0o644);
    fs.chmodSync(directory, 0o755);
    assert.equal(validateRuntimePermissions(f.release), true);
    fs.chmodSync(directory, 0o745);
    assert.throws(() => validateRuntimePermissions(f.release), /directory mode must be 755/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('validates every ancestor through the configured boundary and rejects sticky writable parents', () => {
  const f = fixture(); const ancestor = path.join(path.dirname(f.root), 'permission-contract-ancestor');
  fs.mkdirSync(ancestor, { mode: 0o755 }); const nested = path.join(ancestor, 'nested'); fs.mkdirSync(nested, { mode: 0o755 });
  try {
    fs.chmodSync(ancestor, 0o777);
    assert.throws(() => validateParentTraversal(nested, path.dirname(f.root)), /exact 0755/);
    fs.chmodSync(ancestor, 0o755);
    fs.chmodSync(nested, 0o2755);
    assert.throws(() => validateParentTraversal(nested, path.dirname(f.root)), /exact 0755/);
    assert.throws(() => validateParentTraversal(nested, path.join(nested, 'not-an-ancestor')), /boundary is not an ancestor/);
  } finally { fs.rmSync(ancestor, { recursive: true, force: true }); fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('verifies trusted paired release and rejects tampered static assets', () => { const f = fixture(); try { assert.equal(verifyRelease(f.release, null, opts(f)).manifest.git_sha, f.manifest.git_sha); fs.appendFileSync(path.join(f.release, 'frontend', 'dist', 'app.js'), 'tampered'); assert.throws(() => verifyRelease(f.release, null, opts(f)), /frontend inventory digest mismatch/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('fails closed without external digest or independent provenance', () => { const f = fixture(); try { assert.throws(() => verifyRelease(f.release), /trusted external manifest digest/); assert.throws(() => verifyRelease(f.release, null, { trustedManifestSha256: f.manifest.manifest_sha256 }), /trusted git repository/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('rejects forged manifest even when its self-derived digest is repaired', () => { const f = fixture(); try { const file = path.join(f.release, 'release-manifest.json'); const m = JSON.parse(fs.readFileSync(file)); m.git_sha = 'a'.repeat(40); m.manifest_sha256 = manifestDigest(m); fs.writeFileSync(file, JSON.stringify(m)); assert.throws(() => verifyRelease(f.release, null, { repo: f.repo, trustedManifestSha256: m.manifest_sha256 }), /git\/tree provenance/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('rejects symlink and traversal entries', () => { const f = fixture(); try { fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.release, 'backend', 'link')); assert.throws(() => verifyRelease(f.release, null, opts(f)), /symlink/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('cutover defaults to read-only and requires mandatory trust inputs', () => { const f = fixture(); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot'); try { const result = cli(f, ['cutover', '--release', f.release, '--app', app, '--webroot', web, '--repo', f.repo, '--trusted-manifest-sha256', f.manifest.manifest_sha256]); assert.equal(result.status, 0); assert.match(result.stdout, /CUTOVER=DRY_RUN/); assert.match(result.stdout, /MANDATORY_CHECKS=PASS/); assert.equal(fs.existsSync(app), false); assert.equal(fs.existsSync(web), false); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('rejects arbitrary health command rather than executing shell', () => { const f = fixture(); try { const result = cli(f, ['cutover', '--release', f.release, '--repo', f.repo, '--trusted-manifest-sha256', f.manifest.manifest_sha256, '--health-command', 'touch SHOULD_NOT_EXIST']); assert.equal(result.status, 0); assert.equal(fs.existsSync(path.join(process.cwd(), 'SHOULD_NOT_EXIST')), false); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });
test('rejects split backend/frontend runtime even when shared pointer exists', () => { const f = fixture(); const pointer = path.join(f.root, 'current'); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot'); try { fs.symlinkSync(f.release, pointer, 'dir'); fs.mkdirSync(app); fs.symlinkSync(pointer, web, 'dir'); const result = cli(f, ['cutover', '--release', f.release, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', f.repo, '--trusted-manifest-sha256', f.manifest.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.notEqual(result.status, 0); assert.match(result.stderr, /backend runtime target must be a symlink/); assert.equal(fs.realpathSync(pointer), f.release); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });

test('rejects production layout with a real frontend webroot before changing runtime state', () => { const f = fixture(); const pointer = path.join(f.root, 'current'); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot'); const marker = path.join(web, 'keep.me'); try { fs.symlinkSync(f.release, pointer, 'dir'); fs.symlinkSync(pointer, app, 'dir'); fs.mkdirSync(web); fs.writeFileSync(marker, 'unchanged\\n'); const beforePointer = fs.readlinkSync(pointer); const beforeApp = fs.readlinkSync(app); const result = cli(f, ['cutover', '--release', f.release, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', f.repo, '--trusted-manifest-sha256', f.manifest.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.notEqual(result.status, 0); assert.match(result.stderr, /frontend runtime target must be a symlink/); assert.equal(fs.readlinkSync(pointer), beforePointer); assert.equal(fs.readlinkSync(app), beforeApp); assert.equal(fs.lstatSync(web).isDirectory(), true); assert.equal(fs.readFileSync(marker, 'utf8'), 'unchanged\\n'); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });

test('accepts shared-pointer runtime integration and atomically recovers on failed cutover', () => { const f = fixture(); const next = fixture(f.repo); const movedNext = path.join(f.root, 'next-release'); fs.cpSync(next.release, movedNext, { recursive: true }); chmodTree(movedNext); establishFixtureOwnership(movedNext); next.release = movedNext; const bad = path.join(f.root, 'bad'); const pointer = path.join(f.root, 'current'); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot'); try { fs.symlinkSync(f.release, pointer, 'dir'); fs.symlinkSync(pointer, app, 'dir'); fs.symlinkSync(pointer, web, 'dir'); const accepted = cli(f, ['cutover', '--release', next.release, '--rollback-target', f.release, '--trusted-rollback-manifest-sha256', f.manifest.manifest_sha256, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', next.repo, '--trusted-manifest-sha256', next.manifest.manifest_sha256, '--runtime-port', '18080', '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.equal(accepted.status, 0, accepted.stderr); assert.equal(fs.realpathSync(pointer), next.release); fs.cpSync(next.release, bad, { recursive: true }); fs.writeFileSync(path.join(bad, 'backend', 'src', 'server.js'), 'not runnable'); const manifest = JSON.parse(fs.readFileSync(path.join(bad, 'release-manifest.json'))); manifest.backend_inventory_digest = inventory(path.join(bad, 'backend'), p => p === 'node_modules' || p.startsWith('node_modules/')).digest; manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(path.join(bad, 'release-manifest.json'), JSON.stringify(manifest)); const rejected = cli(f, ['cutover', '--release', bad, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', next.repo, '--trusted-manifest-sha256', manifest.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.notEqual(rejected.status, 0); assert.equal(fs.realpathSync(pointer), next.release); assert.equal(fs.realpathSync(app), next.release); assert.equal(fs.realpathSync(web), next.release); } finally { fs.rmSync(f.root, { recursive: true, force: true }); fs.rmSync(next.root, { recursive: true, force: true }); } });
test('rejects incompatible provider manifest', () => { const f = fixture(); try { const file = path.join(f.release, 'release-manifest.json'); const m = JSON.parse(fs.readFileSync(file)); m.storage_compatibility.providers = ['s3']; m.manifest_sha256 = manifestDigest(m); fs.writeFileSync(file, JSON.stringify(m)); assert.throws(() => verifyRelease(f.release, null, { repo: f.repo, trustedManifestSha256: m.manifest_sha256 }), /does not support both Supabase/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });


test('requires and independently verifies a distinct rollback trust anchor', () => { const f = fixture(); const r = fixture(f.repo); try { fs.appendFileSync(path.join(r.release, 'frontend', 'dist', 'app.js'), 'rollback'); r.manifest.frontend_inventory_digest = inventory(path.join(r.release, 'frontend', 'dist')).digest; r.manifest.asset_hashes = [{ path: 'app.js', sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(r.release, 'frontend', 'dist', 'app.js'))).digest('hex') }, { path: 'index.html', sha256: require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(r.release, 'frontend', 'dist', 'index.html'))).digest('hex') }]; r.manifest.manifest_sha256 = manifestDigest(r.manifest); fs.writeFileSync(path.join(r.release, 'release-manifest.json'), JSON.stringify(r.manifest)); assert.notEqual(f.manifest.manifest_sha256, r.manifest.manifest_sha256); assert.throws(() => verifyRelease(f.release, r.release, opts(f)), /trusted external manifest digest/); assert.equal(verifyRelease(f.release, r.release, rollbackOpts(f, r)).manifest.git_sha, f.manifest.git_sha); assert.throws(() => verifyRelease(f.release, r.release, { ...rollbackOpts(f, r), trustedRollbackManifestSha256: f.manifest.manifest_sha256 }), /trusted external manifest digest/); } finally { fs.rmSync(f.root, { recursive: true, force: true }); fs.rmSync(r.root, { recursive: true, force: true }); } });

test('rejects a file entry swapped to an outside symlink during inventory reads', () => {
  const f = fixture(); const backend = path.join(f.release, 'backend'); const file = path.join(backend, 'src', 'server.js'); const secret = path.join(f.root, 'outside-secret');
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

test('restores an absent pointer after post-cutover mandatory-check failure', () => { const f = fixture(); const pointer = path.join(f.root, 'current'); const bad = path.join(f.root, 'bad'); fs.cpSync(f.release, bad, { recursive: true }); fs.writeFileSync(path.join(bad, 'backend', 'src', 'server.js'), 'not runnable'); const m = JSON.parse(fs.readFileSync(path.join(bad, 'release-manifest.json'))); m.backend_inventory_digest = inventory(path.join(bad, 'backend')).digest; m.manifest_sha256 = manifestDigest(m); fs.writeFileSync(path.join(bad, 'release-manifest.json'), JSON.stringify(m)); try { const result = cli(f, ['cutover', '--release', bad, '--pointer', pointer, '--repo', f.repo, '--trusted-manifest-sha256', m.manifest_sha256, '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']); assert.notEqual(result.status, 0); assert.equal(fs.existsSync(pointer), false); } finally { fs.rmSync(f.root, { recursive: true, force: true }); } });

function distinctRelease(f, label) {
  const r = fixture(f.repo); const moved = path.join(f.root, `release-${label}`); fs.cpSync(r.release, moved, { recursive: true }); fs.rmSync(r.root, { recursive: true, force: true });
  const app = path.join(moved, 'frontend', 'dist', 'app.js'); fs.chmodSync(app, 0o644); fs.writeFileSync(app, `window.__RELEASE__ = ${JSON.stringify(label)};\n`);
  const file = path.join(moved, 'release-manifest.json'); const m = JSON.parse(fs.readFileSync(file)); const fi = inventory(path.join(moved, 'frontend', 'dist')); m.frontend_inventory_digest = fi.digest; m.asset_hashes = fi.entries; m.manifest_sha256 = manifestDigest(m); fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  chmodTree(moved); establishFixtureOwnership(moved); return { release: moved, manifest: m };
}

test('apply cutover verifies the rollback release with its own trust anchor when releases differ', () => {
  const f = fixture(); const next = distinctRelease(f, 'next'); const pointer = path.join(f.root, 'current'); const app = path.join(f.root, 'app'); const web = path.join(f.root, 'webroot');
  try {
    assert.notEqual(f.manifest.manifest_sha256, next.manifest.manifest_sha256);
    fs.symlinkSync(f.release, pointer, 'dir'); fs.symlinkSync(pointer, app, 'dir'); fs.symlinkSync(pointer, web, 'dir');
    const result = cli(f, ['cutover', '--release', next.release, '--rollback-target', f.release, '--trusted-rollback-manifest-sha256', f.manifest.manifest_sha256, '--pointer', pointer, '--app', app, '--webroot', web, '--repo', f.repo, '--trusted-manifest-sha256', next.manifest.manifest_sha256, '--runtime-port', '18080', '--apply', '--operator-gate', 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER']);
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /CUTOVER=PASS/); assert.equal(fs.realpathSync(pointer), next.release);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('build finalizes release root, frontend and manifest modes independent of the host umask', () => {
  const previous = process.umask(0o077); const root = fs.mkdtempSync(path.join('/tmp', 'sms-v3-umask-'));
  try {
    const release = path.join(root, 'release'); fs.mkdirSync(path.join(release, 'frontend', 'dist'), { recursive: true }); fs.writeFileSync(path.join(release, 'release-manifest.json'), '{}', { mode: 0o644 });
    assert.equal(fs.statSync(release).mode & 0o777, 0o700);
    finalizeReleaseModes(release);
    assert.equal(fs.statSync(release).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(release, 'frontend')).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(release, 'release-manifest.json')).mode & 0o777, 0o644);
  } finally { process.umask(previous); fs.rmSync(root, { recursive: true, force: true }); }
});
