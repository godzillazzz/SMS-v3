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
const rel = p => p.split(path.sep).join('/');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function fail(message) { throw new Error(`self-hosted release: ${message}`); }
function run(command, args, cwd, options = {}) { const output = execFileSync(command, args, { cwd, stdio: options.stdio || 'inherit', encoding: options.encoding || 'utf8' }); return typeof output === 'string' ? output.trim() : ''; }
function contained(root, candidate) { const r = path.resolve(root); const c = path.resolve(candidate); return c === r || c.startsWith(`${r}${path.sep}`); }
const procFd = fd => `/proc/self/fd/${fd}`;
const closeFd = fd => { try { fs.closeSync(fd); } catch (error) { if (error.code !== 'EBADF') throw error; } };
const noFollow = fs.constants.O_NOFOLLOW || 0;
const directoryFlags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0);
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
    return { fd: fs.openSync(path.join(procFd(directoryFd), parts.at(-1)), flags), parentFd: directoryFd, anchored: Boolean(anchoredRootFd) };
  } catch (error) { if (!anchoredRootFd || directoryFd !== anchoredRootFd) closeFd(directoryFd); throw error; }
}
function regularFile(file, root = path.dirname(file), anchoredRootFd = null) {
  let opened; try { opened = openRelative(root, path.relative(root, file), fs.constants.O_RDONLY, anchoredRootFd); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ELOOP' || error.code === 'ENOTDIR') return false; throw error; }
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
function safeRead(file, root, anchoredRootFd = null) {
  if (!contained(root, file)) fail(`path escapes release: ${file}`);
  const opened = regularFile(file, root, anchoredRootFd);
  if (!opened) fail(`missing regular file: ${file}`);
  try { return fs.readFileSync(opened.fd); } finally { closeFd(opened.fd); if (!opened.anchored || opened.parentFd !== anchoredRootFd) closeFd(opened.parentFd); }
}
function inventory(root, ignored) {
  const entries = files(root, ignored).map(file => ({ path: file, sha256: sha256(safeRead(path.join(root, file), root)) }));
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
  const server = safeRead(path.join(backend, 'server.js'), root).toString('utf8');
  if (!/require\(['"]\.\/app['"]\)/.test(server) || !/app\.listen\(/.test(server)) fail('backend server entrypoint is not a fixed runnable server');
  const index = safeRead(path.join(dist, 'index.html'), root).toString('utf8');
  if (!/<html(?:\s|>)/i.test(index) || !/<script\b/i.test(index)) fail('frontend index is not a fixed served document');
}
function verifyRelease(release, rollbackTarget, options = {}) {
  const root = path.resolve(release); const { manifest } = readManifest(root);
  if (manifest.schema_version !== SCHEMA_VERSION) fail('unsupported manifest schema');
  if (!SHA.test(manifest.git_sha) || !SHA.test(manifest.tree_sha)) fail('manifest git/tree SHA is invalid');
  if (!manifest.manifest_sha256 || manifest.manifest_sha256 !== manifestDigest(manifest)) fail('manifest digest mismatch');
  const trusted = options.trustedManifestSha256; if (!trusted || !DIGEST.test(trusted) || trusted !== manifest.manifest_sha256) fail('trusted external manifest digest is required and does not match');
  verifyProvenance(manifest, options.repo);
  if (manifest.storage_compatibility?.mode !== COMPATIBILITY || manifest.storage_compatibility.database_authoritative !== true || manifest.storage_compatibility.mixed_provider_reads !== true) fail('release is incompatible with MinIO mixed-provider reads');
  if (!Array.isArray(manifest.storage_compatibility.providers) || PROVIDERS.some(p => !manifest.storage_compatibility.providers.includes(p))) fail('release does not support both Supabase and MinIO/S3 reads');
  mandatoryChecks(root); const backendInventory = inventory(path.join(root, 'backend'), p => p === 'node_modules' || p.startsWith('node_modules/')); const frontendInventory = inventory(path.join(root, 'frontend', 'dist'));
  if (backendInventory.digest !== manifest.backend_inventory_digest) fail('backend inventory digest mismatch'); if (frontendInventory.digest !== manifest.frontend_inventory_digest) fail('frontend inventory digest mismatch');
  for (const asset of manifest.asset_hashes || []) { if (!asset || typeof asset.path !== 'string' || asset.path.includes('..') || path.isAbsolute(asset.path)) fail('manifest asset path traversal'); const assetPath = path.join(root, 'frontend', 'dist', asset.path); if (!contained(path.join(root, 'frontend', 'dist'), assetPath) || sha256(safeRead(assetPath, path.join(root, 'frontend', 'dist'))) !== asset.sha256) fail(`frontend asset hash mismatch: ${asset.path}`); }
  if (rollbackTarget) verifyRelease(rollbackTarget, null, { ...options, trustedManifestSha256: options.trustedRollbackManifestSha256 });
  return { release: root, manifest, backend_inventory_digest: backendInventory.digest, frontend_inventory_digest: frontendInventory.digest };
}
function build(args) { const repo = path.resolve(args.repo || process.cwd()); const output = path.resolve(required(args, 'output')); const identity = args.identity || `${os.userInfo().username}@${os.hostname()}`; const git = gitSha(repo, required(args, 'sha')); const releaseName = `sms-v3-${git.sha}`; const release = path.join(output, releaseName); if (fs.existsSync(release)) fail(`release already exists: ${release}`); fs.mkdirSync(output, { recursive: true }); const stage = fs.mkdtempSync(path.join(output, `.sms-v3-release-stage-${process.pid}-`)); try { fs.mkdirSync(release, { recursive: true }); const archive = execFileSync('git', ['archive', '--format=tar', git.sha], { cwd: repo }); execFileSync('tar', ['-xf', '-', '-C', stage], { input: archive }); const backend = path.join(release, 'backend'); fs.cpSync(stage, backend, { recursive: true }); run('npm', ['ci', '--omit=dev', '--ignore-scripts'], backend); run('npx', ['prisma', 'generate'], backend); const frontend = path.join(stage, 'frontend'); run('npm', ['ci', '--ignore-scripts'], frontend); run('npm', ['run', 'build'], frontend); fs.mkdirSync(path.join(release, 'frontend'), { recursive: true }); fs.cpSync(path.join(frontend, 'dist'), path.join(release, 'frontend', 'dist'), { recursive: true }); const bi = inventory(backend, p => p === 'node_modules' || p.startsWith('node_modules/')); const fi = inventory(path.join(release, 'frontend', 'dist')); const manifest = { schema_version: SCHEMA_VERSION, release_id: releaseName, git_sha: git.sha, tree_sha: git.tree, build_identity: identity, toolchain: { node: process.version, npm: run('npm', ['--version'], repo, { stdio: 'pipe' }) }, backend_inventory_digest: bi.digest, frontend_inventory_digest: fi.digest, storage_compatibility: { mode: COMPATIBILITY, database_authoritative: true, mixed_provider_reads: true, providers: PROVIDERS, migrations: 'not-run-by-release-cutover' }, previous_rollback_release: args['previous-release'] || null, asset_hashes: fi.entries }; manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(path.join(release, 'release-manifest.json'), json(manifest), { mode: 0o644 }); process.stdout.write(`RELEASE_BUILD=PASS\nRELEASE_DIR=${release}\nMANIFEST_SHA256=${manifest.manifest_sha256}\n`); } finally { fs.rmSync(stage, { recursive: true, force: true }); } }
function cutover(args) { const release = path.resolve(required(args, 'release')); const app = path.resolve(args.app || '/opt/sms-v3/app'); const web = path.resolve(args.webroot || '/var/www/sms'); const pointer = path.resolve(args.pointer || path.join(path.dirname(app), '.sms-v3-current')); verifyRelease(release, args['rollback-target'] && path.resolve(args['rollback-target']), { trustedManifestSha256: required(args, 'trusted-manifest-sha256'), trustedRollbackManifestSha256: args['rollback-target'] ? required(args, 'trusted-rollback-manifest-sha256') : undefined, repo: path.resolve(required(args, 'repo')) }); if (!args.apply || args['operator-gate'] !== 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER') { process.stdout.write(`CUTOVER=DRY_RUN\nRELEASE_DIR=${release}\nSHARED_POINTER=${pointer}\nAPP_POINTER=${app}\nWEBROOT_POINTER=${web}\nMANDATORY_CHECKS=PASS\nOPERATOR_GATE_REQUIRED=I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER\n`); return; } const parent = path.dirname(pointer); fs.mkdirSync(parent, { recursive: true }); const old = fs.existsSync(pointer) ? fs.readlinkSync(pointer) : null; const staged = `${pointer}.next-${process.pid}`; fs.symlinkSync(release, staged, 'dir'); try { fs.renameSync(staged, pointer); mandatoryChecks(release); if (path.resolve(fs.realpathSync(pointer)) !== release) fail('shared pointer check failed'); process.stdout.write('CUTOVER=PASS\nMANDATORY_CHECKS=PASS\n'); } catch (error) { if (fs.existsSync(staged)) fs.unlinkSync(staged); if (old) { const restore = `${pointer}.restore-${process.pid}`; fs.symlinkSync(old, restore, 'dir'); fs.renameSync(restore, pointer); } else if (fs.existsSync(pointer)) fs.unlinkSync(pointer); throw error; } }
function main() { const args = parseArgs(process.argv.slice(2)); try { if (args._[0] === 'build') build(args); else if (args._[0] === 'verify') { const result = verifyRelease(required(args, 'release'), args['rollback-target'] && path.resolve(args['rollback-target']), { trustedManifestSha256: required(args, 'trusted-manifest-sha256'), trustedRollbackManifestSha256: args['rollback-target'] ? required(args, 'trusted-rollback-manifest-sha256') : undefined, repo: path.resolve(required(args, 'repo')) }); process.stdout.write(`RELEASE_VERIFY=PASS\nGIT_SHA=${result.manifest.git_sha}\nTREE_SHA=${result.manifest.tree_sha}\nMANIFEST_SHA256=${result.manifest.manifest_sha256}\n`); } else if (args._[0] === 'cutover') cutover(args); else fail('command must be build, verify, or cutover'); } catch (error) { process.stderr.write(`RELEASE_VERIFY=FAIL\n${error.message}\n`); process.exitCode = 1; } }
if (require.main === module) main();
module.exports = { COMPATIBILITY, inventory, manifestDigest, verifyRelease, mandatoryChecks };
