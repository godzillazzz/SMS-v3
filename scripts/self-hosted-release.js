#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const SCHEMA_VERSION = 1;
const PROVIDERS = ['supabase', 's3'];
const COMPATIBILITY = 'postgres-authoritative-mixed-provider-read-v1';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PERMISSION_CONTRACT = Object.freeze({
  neutralDirectoryMode: 0o755,
  frontendDirectoryMode: 0o755,
  frontendFileMode: 0o644,
  backendDirectoryMode: 0o750,
  backendFileMode: 0o640,
  owner: 'root',
  backendGroup: 'smsv3',
  frontendGroup: 'www-data',
  writableByGroupOrOther: false
});
const rel = p => p.split(path.sep).join('/');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function fail(message) { throw new Error(`self-hosted release: ${message}`); }
function run(command, args, cwd, options = {}) { const output = execFileSync(command, args, { cwd, stdio: options.stdio || 'inherit', encoding: options.encoding || 'utf8' }); return typeof output === 'string' ? output.trim() : ''; }
function contained(root, candidate) { const r = path.resolve(root); const c = path.resolve(candidate); return c === r || c.startsWith(`${r}${path.sep}`); }
function permissionFailure(file, message) { fail(`unsafe filesystem permissions at ${file}: ${message}`); }
function groupId(name) {
  try {
    const entry = run('getent', ['group', name], undefined, { stdio: 'pipe' });
    const gid = Number(entry.split(':')[2]);
    if (!Number.isInteger(gid)) throw new Error('invalid gid');
    return gid;
  } catch { fail(`required runtime group is unavailable: ${name}`); }
}
function validateRoleOwnership(root) {
  const base = path.resolve(root);
  const groups = { backend: groupId(PERMISSION_CONTRACT.backendGroup), frontend: groupId(PERMISSION_CONTRACT.frontendGroup) };
  function visit(file, expectedGid, label) {
    let stat; try { stat = fs.lstatSync(file); } catch { permissionFailure(file, 'missing path'); }
    if (stat.isSymbolicLink()) permissionFailure(file, 'symlinks are not allowed inside a release');
    if (stat.uid !== 0 || stat.gid !== expectedGid) permissionFailure(file, `${label} ownership must be root:${expectedGid} (got ${stat.uid}:${stat.gid})`);
    if (stat.isDirectory()) for (const entry of fs.readdirSync(file)) visit(path.join(file, entry), expectedGid, label);
  }
  const rootStat = fs.lstatSync(base);
  if (rootStat.uid !== 0 || rootStat.gid !== 0) permissionFailure(base, `release root ownership must be root:root (got ${rootStat.uid}:${rootStat.gid})`);
  visit(path.join(base, 'backend'), groups.backend, 'backend');
  visit(path.join(base, 'frontend'), groups.frontend, 'frontend');
  visit(path.join(base, 'release-manifest.json'), 0, 'release manifest');
  return true;
}
function validateRuntimePermissions(root) {
  const base = path.resolve(root);
  function visit(file) {
    let stat; try { stat = fs.lstatSync(file); } catch { permissionFailure(file, 'missing path'); }
    if (stat.isSymbolicLink()) permissionFailure(file, 'symlinks are not allowed inside a release');
    const mode = stat.mode & 0o7777;
    const relative = path.relative(base, file).split(path.sep).join('/');
    const backend = relative === 'backend' || relative.startsWith('backend/');
    const expectedDirectory = backend ? PERMISSION_CONTRACT.backendDirectoryMode : PERMISSION_CONTRACT.frontendDirectoryMode;
    const expectedFile = backend ? PERMISSION_CONTRACT.backendFileMode : PERMISSION_CONTRACT.frontendFileMode;
    if (stat.isDirectory()) {
      if (mode !== expectedDirectory) permissionFailure(file, `directory mode must be ${expectedDirectory.toString(8)} (got ${mode.toString(8).padStart(4, '0')})`);
      for (const entry of fs.readdirSync(file)) visit(path.join(file, entry));
    } else if (stat.isFile()) {
      if (mode !== expectedFile) permissionFailure(file, `file mode must be ${expectedFile.toString(8)} (got ${mode.toString(8).padStart(4, '0')})`);
    } else permissionFailure(file, 'only regular files and directories are allowed');
  }
  visit(base); return true;
}
function validateParentTraversal(file, boundary = '/') {
  let current = path.resolve(file); const stop = path.resolve(boundary);
  if (!contained(stop, current)) permissionFailure(stop, 'configured boundary is not an ancestor of the target');
  while (true) {
    let stat; try { stat = fs.lstatSync(current); } catch { permissionFailure(current, 'missing parent'); }
    if (!stat.isDirectory()) permissionFailure(current, 'parent is not a directory');
    const mode = stat.mode & 0o7777;
    if (mode !== PERMISSION_CONTRACT.neutralDirectoryMode) permissionFailure(current, 'runtime readers need exact 0755 non-writable read/execute traversal');
    const parent = path.dirname(current); if (current === stop || parent === current) break; current = parent;
  }
  return true;
}
const procFd = fd => `/proc/self/fd/${fd}`;
const closeFd = fd => { try { fs.closeSync(fd); } catch (error) { if (error.code !== 'EBADF') throw error; } };
const noFollow = fs.constants.O_NOFOLLOW || 0;
const directoryFlags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | noFollow;
const regularFileFlags = fs.constants.O_RDONLY | noFollow;
function openDirectory(directory) {
  try { return fs.openSync(directory, directoryFlags); } catch { fail(`missing or unsafe directory: ${directory}`); }
}
function openChildDirectory(parentFd, name) {
  try { return fs.openSync(path.join(procFd(parentFd), name), directoryFlags); } catch { fail(`missing or unsafe directory: ${name}`); }
}
function openRelative(root, relative, flags = fs.constants.O_RDONLY, anchoredRootFd = null) {
  const parts = rel(path.relative(path.resolve(root), path.resolve(root, relative))).split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..')) fail(`path escapes release: ${relative}`);
  let directoryFd = anchoredRootFd || openDirectory(root);
  try {
    for (const part of parts.slice(0, -1)) {
      const next = openChildDirectory(directoryFd, part); if (!anchoredRootFd || directoryFd !== anchoredRootFd) closeFd(directoryFd); directoryFd = next;
    }
    return { fd: fs.openSync(path.join(procFd(directoryFd), parts.at(-1)), flags | noFollow), parentFd: directoryFd, anchored: Boolean(anchoredRootFd) };
  } catch (error) { if (!anchoredRootFd || directoryFd !== anchoredRootFd) closeFd(directoryFd); throw error; }
}
function regularFile(file, root = path.dirname(file), anchoredRootFd = null) {
  let opened; try { opened = openRelative(root, path.relative(root, file), regularFileFlags, anchoredRootFd); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ELOOP' || error.code === 'ENOTDIR') return false; throw error; }
  try {
    const stable = fs.fstatSync(opened.fd);
    if (!stable.isFile()) fail(`non-regular file or symlink is not allowed: ${file}`);
    return { fd: opened.fd, parentFd: opened.parentFd, stat: stable };
  } catch (error) { closeFd(opened.fd); closeFd(opened.parentFd); throw error; }
}
function files(root, ignored = () => false) {
  const result = []; const base = path.resolve(root);
  function walk(directoryFd, prefix) {
    for (const entry of fs.readdirSync(procFd(directoryFd), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (ignored(relative, entry)) continue;
      if (entry.isSymbolicLink()) fail(`symlink is not allowed: ${relative}`);
      if (entry.isDirectory()) { const childFd = openChildDirectory(directoryFd, entry.name); try { walk(childFd, relative); } finally { fs.closeSync(childFd); } }
      else if (entry.isFile()) result.push(relative); else fail(`non-regular entry is not allowed: ${relative}`);
    }
  }
  const rootFd = openDirectory(base); try { walk(rootFd, ''); } finally { closeFd(rootFd); } return result;
}
function readInventoryFile(directoryFd, name, relative) {
  let fd;
  try { fd = fs.openSync(path.join(procFd(directoryFd), name), regularFileFlags); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ELOOP' || error.code === 'ENOTDIR') fail(`missing regular file: ${relative}`);
    throw error;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) fail(`non-regular file or symlink is not allowed: ${relative}`);
    return fs.readFileSync(fd);
  } finally { closeFd(fd); }
}
function safeRead(file, root, anchoredRootFd = null) {
  if (!contained(root, file)) fail(`path escapes release: ${file}`);
  const opened = regularFile(file, root, anchoredRootFd);
  if (!opened) fail(`missing regular file: ${file}`);
  try { return fs.readFileSync(opened.fd); } finally { closeFd(opened.fd); if (!opened.anchored || opened.parentFd !== anchoredRootFd) closeFd(opened.parentFd); }
}
function inventory(root, ignored) {
  const entries = []; const base = path.resolve(root);
  function walk(directoryFd, prefix) {
    for (const entry of fs.readdirSync(procFd(directoryFd), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (ignored?.(relative, entry)) continue;
      if (entry.isSymbolicLink()) fail(`symlink is not allowed: ${relative}`);
      if (entry.isDirectory()) { const childFd = openChildDirectory(directoryFd, entry.name); try { walk(childFd, relative); } finally { closeFd(childFd); } }
      else if (entry.isFile()) entries.push({ path: relative, sha256: sha256(readInventoryFile(directoryFd, entry.name, relative)) });
      else fail(`non-regular entry is not allowed: ${relative}`);
    }
  }
  const rootFd = openDirectory(base); try { walk(rootFd, ''); } finally { closeFd(rootFd); }
  return { entries, digest: sha256(json(entries)) };
}
function parseArgs(argv) { const out = { _: [] }; for (let i = 0; i < argv.length; i++) { const item = argv[i]; if (!item.startsWith('--')) { out._.push(item); continue; } const [key, inline] = item.slice(2).split('=', 2); out[key] = inline === undefined ? (key === 'apply' ? true : argv[++i]) : inline; } return out; }
function required(args, key) { if (!args[key]) fail(`--${key} is required`); return args[key]; }
function gitSha(repo, sha) { if (!SHA.test(sha)) fail('git SHA must be exactly 40 lowercase hexadecimal characters'); const actual = run('git', ['rev-parse', `${sha}^{commit}`], repo, { stdio: 'pipe' }); if (actual !== sha) fail(`requested SHA is not the exact commit object: ${actual}`); return { sha: actual, tree: run('git', ['rev-parse', `${sha}^{tree}`], repo, { stdio: 'pipe' }) }; }
function manifestDigest(manifest) { const copy = { ...manifest }; delete copy.manifest_sha256; return sha256(json(copy)); }
function readManifest(release) { const file = path.join(release, 'release-manifest.json'); if (!contained(release, file) || !fs.existsSync(file)) fail('release-manifest.json is missing'); let manifest; try { manifest = JSON.parse(safeRead(file, release)); } catch { fail('release manifest is not valid JSON'); } return { manifest, file }; }
function verifyProvenance(manifest, repo) { if (!repo) fail('trusted git repository is required for independent tree provenance'); let commit; let tree; try { commit = run('git', ['rev-parse', `${manifest.git_sha}^{commit}`], repo, { stdio: 'pipe' }); tree = run('git', ['rev-parse', `${manifest.git_sha}^{tree}`], repo, { stdio: 'pipe' }); } catch { fail('manifest git/tree provenance does not match trusted repository'); } if (commit !== manifest.git_sha || tree !== manifest.tree_sha) fail('manifest git/tree provenance does not match trusted repository'); }
function mandatoryChecks(root) {
  const backend = path.join(root, 'backend'); const dist = path.join(root, 'frontend', 'dist');
  if (!fs.lstatSync(backend).isDirectory() || fs.lstatSync(backend).isSymbolicLink()) fail('backend runtime is not a real directory');
  if (!fs.lstatSync(dist).isDirectory() || fs.lstatSync(dist).isSymbolicLink()) fail('frontend/dist is not a real directory');
  const server = safeRead(path.join(backend, 'src', 'server.js'), root).toString('utf8');
  if (!/require\(['"]\.\/app['"]\)/.test(server) || !/app\.listen\(/.test(server)) fail('backend server entrypoint is not a fixed runnable server');
  const index = safeRead(path.join(dist, 'index.html'), root).toString('utf8');
  if (!/<html(?:\s|>)/i.test(index) || !/<script\b/i.test(index)) fail('frontend index is not a fixed served document');
}
function verifyRelease(release, rollbackTarget, options = {}) {
  const rollbackRoot = rollbackTarget ? path.resolve(rollbackTarget) : null;
  const root = path.resolve(release); if (options.parentBoundary) validateParentTraversal(root, options.parentBoundary);
  const rootStat = fs.lstatSync(root); if (!rootStat.isDirectory()) fail('release root must be a directory'); const { manifest } = readManifest(root);
  if (manifest.schema_version !== SCHEMA_VERSION) fail('unsupported manifest schema');
  if (!SHA.test(manifest.git_sha) || !SHA.test(manifest.tree_sha)) fail('manifest git/tree SHA is invalid');
  if (!manifest.manifest_sha256 || manifest.manifest_sha256 !== manifestDigest(manifest)) fail('manifest digest mismatch');
  const trusted = options.trustedManifestSha256; if (!trusted || !DIGEST.test(trusted) || trusted !== manifest.manifest_sha256) fail('trusted external manifest digest is required and does not match');
  verifyProvenance(manifest, options.repo);
  if (manifest.storage_compatibility?.mode !== COMPATIBILITY || manifest.storage_compatibility.database_authoritative !== true || manifest.storage_compatibility.mixed_provider_reads !== true) fail('release is incompatible with MinIO mixed-provider reads');
  if (!Array.isArray(manifest.storage_compatibility.providers) || PROVIDERS.some(p => !manifest.storage_compatibility.providers.includes(p))) fail('release does not support both Supabase and MinIO/S3 reads');
  validateParentTraversal(root, options.parentBoundary || '/'); validateRoleOwnership(root); validateRuntimePermissions(root); mandatoryChecks(root); const backendInventory = inventory(path.join(root, 'backend'), p => p === 'node_modules' || p.startsWith('node_modules/')); const frontendInventory = inventory(path.join(root, 'frontend', 'dist'));
  if (backendInventory.digest !== manifest.backend_inventory_digest) fail('backend inventory digest mismatch'); if (frontendInventory.digest !== manifest.frontend_inventory_digest) fail('frontend inventory digest mismatch');
  for (const asset of manifest.asset_hashes || []) { if (!asset || typeof asset.path !== 'string' || asset.path.includes('..') || path.isAbsolute(asset.path)) fail('manifest asset path traversal'); const assetPath = path.join(root, 'frontend', 'dist', asset.path); if (!contained(path.join(root, 'frontend', 'dist'), assetPath) || sha256(safeRead(assetPath, path.join(root, 'frontend', 'dist'))) !== asset.sha256) fail(`frontend asset hash mismatch: ${asset.path}`); }
  if (rollbackTarget) verifyRelease(rollbackTarget, null, { ...options, parentBoundary: options.rollbackParentBoundary || (options.parentBoundary && contained(options.parentBoundary, rollbackTarget) ? options.parentBoundary : rollbackTarget), trustedManifestSha256: options.trustedRollbackManifestSha256 });
  return { release: root, manifest, backend_inventory_digest: backendInventory.digest, frontend_inventory_digest: frontendInventory.digest };
}

function archiveCommit(repo, sha, destination) {
  const archivePath = path.join(destination, '.release.tar');
  const fd = fs.openSync(archivePath, 'w', 0o600);
  try {
    const result = require('node:child_process').spawnSync('git', ['archive', '--format=tar', sha], { cwd: repo, stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', maxBuffer: 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) fail(`git archive failed (${result.status}): ${(result.stderr || '').trim()}`);
    execFileSync('tar', ['-xf', archivePath, '-C', destination]);
  } finally { fs.closeSync(fd); fs.rmSync(archivePath, { force: true }); }
}
function canonicalizeTree(root, role = 'frontend') {
  if (role !== 'backend' && role !== 'frontend') fail(`unsupported canonicalization role: ${role}`);
  const base = path.resolve(root);
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const item = path.join(current, entry.name); const stat = fs.lstatSync(item);
      if (stat.isSymbolicLink()) { const target = fs.realpathSync(item); if (!contained(base, target)) fail(`symlink target escapes release: ${path.relative(base, item)}`); const targetStat = fs.statSync(target); fs.rmSync(item, { recursive: true, force: true }); if (targetStat.isDirectory()) fs.cpSync(target, item, { recursive: true, dereference: true }); else if (targetStat.isFile()) fs.copyFileSync(target, item); else fail(`unsupported symlink target: ${path.relative(base, item)}`); }
      const now = fs.lstatSync(item); if (now.isDirectory()) walk(item); else if (!now.isFile()) fail(`unsupported release entry: ${path.relative(base, item)}`);
    }
  }
  walk(base);
  function modes(current) {
    const stat = fs.lstatSync(current); const backend = role === 'backend';
    if (stat.isDirectory()) { fs.chmodSync(current, backend ? PERMISSION_CONTRACT.backendDirectoryMode : PERMISSION_CONTRACT.frontendDirectoryMode); for (const e of fs.readdirSync(current)) modes(path.join(current, e)); }
    else if (stat.isFile()) fs.chmodSync(current, backend ? PERMISSION_CONTRACT.backendFileMode : PERMISSION_CONTRACT.frontendFileMode);
  }
  modes(base);
}
function applyRoleOwnership(release) {
  if (process.getuid?.() !== 0) fail('release build must run as root to establish immutable role ownership');
  for (const [target, owner] of [[release, 'root:root'], [path.join(release, 'backend'), `root:${PERMISSION_CONTRACT.backendGroup}`], [path.join(release, 'frontend'), `root:${PERMISSION_CONTRACT.frontendGroup}`]]) {
    try { run('chown', ['-R', owner, target]); } catch {
      fail(`required runtime group is unavailable: ${owner.split(':')[1]}`);
    }
  }
  try {
    run('chown', ['root:root', path.join(release, 'release-manifest.json')]);
  } catch {
    fail('release manifest ownership could not be established');
  }
}
function build(args) { const repo = path.resolve(args.repo || process.cwd()); const output = path.resolve(required(args, 'output')); const identity = args.identity || `${os.userInfo().username}@${os.hostname()}`; const git = gitSha(repo, required(args, 'sha')); const releaseName = `sms-v3-${git.sha}`; const release = path.join(output, releaseName); if (fs.existsSync(release)) fail(`release already exists: ${release}`); fs.mkdirSync(output, { recursive: true }); const stage = fs.mkdtempSync(path.join(output, `.sms-v3-release-stage-${process.pid}-`)); try { fs.mkdirSync(release, { recursive: true }); archiveCommit(repo, git.sha, stage); const backend = path.join(release, 'backend'); fs.cpSync(stage, backend, { recursive: true }); run('npm', ['ci', '--omit=dev', '--ignore-scripts'], backend); run('npx', ['prisma', 'generate'], backend); const frontend = path.join(stage, 'frontend'); run('npm', ['ci', '--ignore-scripts'], frontend); run('npm', ['run', 'build'], frontend); fs.mkdirSync(path.join(release, 'frontend'), { recursive: true }); fs.cpSync(path.join(frontend, 'dist'), path.join(release, 'frontend', 'dist'), { recursive: true }); canonicalizeTree(backend, 'backend'); canonicalizeTree(path.join(release, 'frontend', 'dist'), 'frontend'); const bi = inventory(backend, p => p === 'node_modules' || p.startsWith('node_modules/')); const fi = inventory(path.join(release, 'frontend', 'dist')); const manifest = { schema_version: SCHEMA_VERSION, release_id: releaseName, git_sha: git.sha, tree_sha: git.tree, build_identity: identity, toolchain: { node: process.version, npm: run('npm', ['--version'], repo, { stdio: 'pipe' }) }, backend_inventory_digest: bi.digest, frontend_inventory_digest: fi.digest, storage_compatibility: { mode: COMPATIBILITY, database_authoritative: true, mixed_provider_reads: true, providers: PROVIDERS, migrations: 'not-run-by-release-cutover' }, previous_rollback_release: args['previous-release'] || null, asset_hashes: fi.entries }; manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(path.join(release, 'release-manifest.json'), json(manifest), { mode: 0o644 }); applyRoleOwnership(release); process.stdout.write(`RELEASE_BUILD=PASS\nRELEASE_DIR=${release}\nMANIFEST_SHA256=${manifest.manifest_sha256}\n`); } finally { fs.rmSync(stage, { recursive: true, force: true }); } }

function runtimeIntegration(app, web, pointer) {
  for (const [name, target] of [['backend', app], ['frontend', web]]) {
    let stat; try { stat = fs.lstatSync(target); } catch { fail(`${name} runtime target is missing`); }
    if (!stat.isSymbolicLink()) fail(`${name} runtime target must be a symlink to the shared pointer`);
    const link = path.resolve(path.dirname(target), fs.readlinkSync(target));
    if (link !== pointer || path.resolve(fs.realpathSync(target)) !== path.resolve(fs.realpathSync(pointer))) fail(`${name} runtime target must point to shared pointer`);
  }
  if (!fs.existsSync(pointer) || !fs.lstatSync(pointer).isSymbolicLink()) fail(`shared pointer is missing or is not a symlink: ${pointer}`);
}
function restartService() { run('systemctl', ['restart', 'sms-v3']); }
function runtimeChecks(manifest, timeoutMs = 30000, port = 8080) {
  const http = require('node:http'); const asset = (manifest.asset_hashes || []).find(item => item.path !== 'index.html');
  const endpoints = ['/api/v1/health', '/api/v1/ready', '/', asset ? `/${asset.path}` : '/']; const deadline = Date.now() + timeoutMs;
  const check = endpoint => new Promise((resolve, reject) => { const req = http.get({ hostname: '127.0.0.1', port, path: endpoint, timeout: 5000 }, res => { res.resume(); res.on('end', () => res.statusCode >= 200 && res.statusCode < 400 ? resolve() : reject(new Error(`${endpoint} HTTP ${res.statusCode}`))); }); req.on('timeout', () => req.destroy(new Error(`${endpoint} timeout`))); req.on('error', reject); });
  return (async () => { let last; while (Date.now() <= deadline) { try { for (const endpoint of endpoints) await check(endpoint); return; } catch (e) { last = e; await new Promise(r => setTimeout(r, 250)); } } throw new Error(`runtime checks timed out: ${last?.message || 'unknown failure'}`); })();
}
function runtimePort(args) { const value = Number(args['runtime-port'] || 8080); if (!Number.isInteger(value) || value < 1 || value > 65535) fail('--runtime-port must be an integer between 1 and 65535'); return value; }
function atomicPointer(pointer, target, suffix) { const staged = `${pointer}.${suffix}-${process.pid}`; fs.symlinkSync(target, staged, 'dir'); fs.renameSync(staged, pointer); }
async function cutover(args) {
  const release = path.resolve(required(args, 'release')); const app = path.resolve(args.app || '/opt/sms-v3/app'); const web = path.resolve(args.webroot || '/var/www/sms'); const pointer = path.resolve(args.pointer || '/srv/sms-v3/.current'); const rollback = args['rollback-target'] && path.resolve(args['rollback-target']);
  const options = { trustedManifestSha256: required(args, 'trusted-manifest-sha256'), trustedRollbackManifestSha256: rollback ? required(args, 'trusted-rollback-manifest-sha256') : undefined, parentBoundary: args['parent-boundary'] && path.resolve(args['parent-boundary']), rollbackParentBoundary: args['rollback-parent-boundary'] && path.resolve(args['rollback-parent-boundary']), repo: path.resolve(required(args, 'repo')) };
  const verified = verifyRelease(release, rollback, options);
  if (!args.apply || args['operator-gate'] !== 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER') { process.stdout.write(`CUTOVER=DRY_RUN
RELEASE_DIR=${release}
SHARED_POINTER=${pointer}
APP_POINTER=${app}
WEBROOT_POINTER=${web}
MANDATORY_CHECKS=PASS
OPERATOR_GATE_REQUIRED=I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER
`); return; }
  runtimeIntegration(app, web, pointer); const old = fs.readlinkSync(pointer); const oldAbsolute = path.resolve(path.dirname(pointer), old);
  if (!rollback || oldAbsolute !== rollback || !fs.existsSync(rollback) || !fs.lstatSync(rollback).isDirectory() || fs.realpathSync(rollback) !== rollback) fail('rollback target must be current absolute immutable release directory');
  const oldVerified = verifyRelease(rollback, null, options);
  const port = runtimePort(args); const timeout = Number(args['timeout-ms'] || 30000);
  try { atomicPointer(pointer, release, 'next'); restartService(); await runtimeChecks(verified.manifest, timeout, port); process.stdout.write('CUTOVER=PASS\nMANDATORY_CHECKS=PASS\n'); }
  catch (error) { try { atomicPointer(pointer, oldAbsolute, 'restore'); restartService(); await runtimeChecks(oldVerified.manifest, timeout, port); process.stderr.write(`FAIL_ROLLED_BACK\n${error.message}\n`); process.exitCode = 1; } catch (e) { process.stderr.write(`FAIL_ROLLBACK_UNHEALTHY\n${error.message}\n${e.message}\n`); process.exitCode = 1; } }
}
async function main() { const args = parseArgs(process.argv.slice(2)); try { if (args._[0] === 'build') build(args); else if (args._[0] === 'verify') { const result = verifyRelease(required(args, 'release'), args['rollback-target'] && path.resolve(args['rollback-target']), { trustedManifestSha256: required(args, 'trusted-manifest-sha256'), trustedRollbackManifestSha256: args['rollback-target'] ? required(args, 'trusted-rollback-manifest-sha256') : undefined, parentBoundary: args['parent-boundary'] && path.resolve(args['parent-boundary']), rollbackParentBoundary: args['rollback-parent-boundary'] && path.resolve(args['rollback-parent-boundary']), repo: path.resolve(required(args, 'repo')) }); process.stdout.write(`RELEASE_VERIFY=PASS\nGIT_SHA=${result.manifest.git_sha}\nTREE_SHA=${result.manifest.tree_sha}\nMANIFEST_SHA256=${result.manifest.manifest_sha256}\n`); } else if (args._[0] === 'cutover') await cutover(args); else fail('command must be build, verify, or cutover'); } catch (error) { process.stderr.write(`RELEASE_VERIFY=FAIL\n${error.message}\n`); process.exitCode = 1; } }
if (require.main === module) main();
module.exports = { COMPATIBILITY, PERMISSION_CONTRACT, inventory, manifestDigest, validateParentTraversal, validateRoleOwnership, validateRuntimePermissions, verifyRelease, mandatoryChecks, canonicalizeTree };
