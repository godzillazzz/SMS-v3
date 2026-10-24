#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const SCHEMA_VERSION = 1;
const PROVIDERS = ['supabase', 's3'];
const COMPATIBILITY = 'postgres-authoritative-mixed-provider-read-v1';
const SHA = /^[0-9a-f]{40}$/;
const rel = p => p.split(path.sep).join('/');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function fail(message) { throw new Error(`self-hosted release: ${message}`); }
function run(command, args, cwd, options = {}) {
  const output = execFileSync(command, args, { cwd, stdio: options.stdio || 'inherit', encoding: options.encoding || 'utf8' });
  return typeof output === 'string' ? output.trim() : '';
}
function files(root, ignored = () => false) {
  const result = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name); const relative = rel(path.relative(root, full));
      if (ignored(relative, entry)) continue;
      if (entry.isDirectory()) walk(full); else result.push(relative);
    }
  }
  if (fs.existsSync(root)) walk(root);
  return result;
}
function inventory(root, ignored) {
  const entries = files(root, ignored).map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(root, file))) }));
  return { entries, digest: sha256(json(entries)) };
}
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) { out._.push(item); continue; }
    const [key, inline] = item.slice(2).split('=', 2);
    const booleanFlag = key === 'apply';
    out[key] = inline === undefined ? (booleanFlag ? true : argv[++i]) : inline;
  }
  return out;
}
function required(args, key) { if (!args[key]) fail(`--${key} is required`); return args[key]; }
function gitSha(repo, sha) {
  if (!SHA.test(sha)) fail('git SHA must be exactly 40 lowercase hexadecimal characters');
  const actual = run('git', ['rev-parse', `${sha}^{commit}`], repo, { stdio: 'pipe' });
  if (actual !== sha) fail(`requested SHA is not the exact commit object: ${actual}`);
  return { sha: actual, tree: run('git', ['rev-parse', `${sha}^{tree}`], repo, { stdio: 'pipe' }) };
}
function manifestDigest(manifest) { const copy = { ...manifest }; delete copy.manifest_sha256; return sha256(json(copy)); }
function readManifest(release) {
  const file = path.join(release, 'release-manifest.json');
  if (!fs.existsSync(file)) fail('release-manifest.json is missing');
  let manifest; try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('release manifest is not valid JSON'); }
  return { manifest, file };
}
function verifyRelease(release, rollbackTarget) {
  const root = path.resolve(release); const { manifest } = readManifest(root);
  if (manifest.schema_version !== SCHEMA_VERSION) fail('unsupported manifest schema');
  if (!SHA.test(manifest.git_sha) || !SHA.test(manifest.tree_sha)) fail('manifest git/tree SHA is invalid');
  if (!manifest.manifest_sha256 || manifest.manifest_sha256 !== manifestDigest(manifest)) fail('manifest digest mismatch');
  if (manifest.storage_compatibility?.mode !== COMPATIBILITY || manifest.storage_compatibility.database_authoritative !== true || manifest.storage_compatibility.mixed_provider_reads !== true) fail('release is incompatible with MinIO mixed-provider reads');
  if (!Array.isArray(manifest.storage_compatibility.providers) || PROVIDERS.some(p => !manifest.storage_compatibility.providers.includes(p))) fail('release does not support both Supabase and MinIO/S3 reads');
  const backend = path.join(root, 'backend'); const dist = path.join(root, 'frontend', 'dist');
  if (!fs.existsSync(backend)) fail('backend runtime is missing');
  if (!fs.existsSync(dist)) fail('frontend/dist is missing');
  const backendInventory = inventory(backend, (p) => p === 'node_modules' || p.startsWith('node_modules/'));
  const frontendInventory = inventory(dist);
  if (backendInventory.digest !== manifest.backend_inventory_digest) fail('backend inventory digest mismatch');
  if (frontendInventory.digest !== manifest.frontend_inventory_digest) fail('frontend inventory digest mismatch');
  for (const asset of manifest.asset_hashes || []) {
    const assetPath = path.join(dist, asset.path);
    if (!fs.existsSync(assetPath) || sha256(fs.readFileSync(assetPath)) !== asset.sha256) fail(`frontend asset hash mismatch: ${asset.path}`);
  }
  if (rollbackTarget) {
    const target = verifyRelease(rollbackTarget);
    if (target.manifest.storage_compatibility.mode !== COMPATIBILITY) fail('rollback target is incompatible with MinIO mixed-provider reads');
  }
  return { release: root, manifest, backend_inventory_digest: backendInventory.digest, frontend_inventory_digest: frontendInventory.digest };
}
function build(args) {
  const repo = path.resolve(args.repo || process.cwd()); const output = path.resolve(required(args, 'output')); const identity = args.identity || `${os.userInfo().username}@${os.hostname()}`;
  const git = gitSha(repo, required(args, 'sha')); const releaseName = `sms-v3-${git.sha}`; const release = path.join(output, releaseName);
  if (fs.existsSync(release)) fail(`release already exists: ${release}`);
  fs.mkdirSync(output, { recursive: true }); const stage = fs.mkdtempSync(path.join(output, `.sms-v3-release-stage-${process.pid}-`));
  try {
    fs.mkdirSync(release, { recursive: true });
    run('sh', ['-c', `git archive --format=tar ${git.sha} | tar -xf - -C ${JSON.stringify(stage)}`], repo);
    const backend = path.join(release, 'backend'); fs.cpSync(stage, backend, { recursive: true });
    run('npm', ['ci', '--omit=dev', '--ignore-scripts'], backend);
    run('npx', ['prisma', 'generate'], backend);
    const frontend = path.join(stage, 'frontend');
    run('npm', ['ci', '--ignore-scripts'], frontend); run('npm', ['run', 'build'], frontend);
    fs.mkdirSync(path.join(release, 'frontend'), { recursive: true }); fs.cpSync(path.join(frontend, 'dist'), path.join(release, 'frontend', 'dist'), { recursive: true });
    const backendInventory = inventory(backend, p => p === 'node_modules' || p.startsWith('node_modules/'));
    const frontendInventory = inventory(path.join(release, 'frontend', 'dist'));
    const assetHashes = frontendInventory.entries;
    const manifest = { schema_version: SCHEMA_VERSION, release_id: releaseName, git_sha: git.sha, tree_sha: git.tree, build_identity: identity, toolchain: { node: process.version, npm: run('npm', ['--version'], repo, { stdio: 'pipe' }) }, backend_inventory_digest: backendInventory.digest, frontend_inventory_digest: frontendInventory.digest, storage_compatibility: { mode: COMPATIBILITY, database_authoritative: true, mixed_provider_reads: true, providers: PROVIDERS, migrations: 'not-run-by-release-cutover' }, previous_rollback_release: args['previous-release'] || null, asset_hashes: assetHashes };
    manifest.manifest_sha256 = manifestDigest(manifest); fs.writeFileSync(path.join(release, 'release-manifest.json'), json(manifest), { mode: 0o644 });
    process.stdout.write(`RELEASE_BUILD=PASS\nRELEASE_DIR=${release}\nMANIFEST_SHA256=${manifest.manifest_sha256}\n`);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
function healthCheck(args, release) {
  if (!args['health-command']) return true;
  const result = spawnSync('sh', ['-c', args['health-command']], { cwd: release, stdio: 'inherit', env: { ...process.env, RELEASE_DIR: release } });
  return result.status === 0;
}
function cutover(args) {
  const release = path.resolve(required(args, 'release')); verifyRelease(release, args['rollback-target'] && path.resolve(args['rollback-target']));
  const app = path.resolve(args.app || '/opt/sms-v3/app'); const web = path.resolve(args.webroot || '/var/www/sms');
  if (!args.apply || args['operator-gate'] !== 'I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER') { process.stdout.write(`CUTOVER=DRY_RUN\nRELEASE_DIR=${release}\nAPP_POINTER=${app}\nWEBROOT_POINTER=${web}\nOPERATOR_GATE_REQUIRED=I_UNDERSTAND_ATOMIC_SELF_HOSTED_CUTOVER\n`); return; }
  if (fs.statSync(path.dirname(app)).dev !== fs.statSync(path.dirname(web)).dev) fail('app and webroot must be on the same filesystem for paired staging');
  const currentApp = fs.existsSync(app) ? fs.readlinkSync(app) : null; const currentWeb = fs.existsSync(web) ? fs.readlinkSync(web) : null;
  const stageApp = `${app}.next-${process.pid}`; const stageWeb = `${web}.next-${process.pid}`;
  fs.symlinkSync(path.join(release, 'backend'), stageApp, 'dir'); fs.symlinkSync(path.join(release, 'frontend', 'dist'), stageWeb, 'dir');
  const install = (staged, target) => { if (fs.existsSync(target)) fs.unlinkSync(target); fs.renameSync(staged, target); };
  const restore = (target, previous) => { if (fs.existsSync(target)) fs.unlinkSync(target); if (previous) fs.symlinkSync(previous, target, 'dir'); };
  try { install(stageApp, app); install(stageWeb, web); if (!healthCheck(args, release)) throw new Error('health/readiness check failed'); process.stdout.write('CUTOVER=PASS\n'); }
  catch (error) { if (fs.existsSync(stageApp)) fs.unlinkSync(stageApp); if (fs.existsSync(stageWeb)) fs.unlinkSync(stageWeb); restore(app, currentApp); restore(web, currentWeb); throw error; }
}
function main() { const args = parseArgs(process.argv.slice(2)); try { if (args._[0] === 'build') build(args); else if (args._[0] === 'verify') { const result = verifyRelease(required(args, 'release'), args['rollback-target'] && path.resolve(args['rollback-target'])); process.stdout.write(`RELEASE_VERIFY=PASS\nGIT_SHA=${result.manifest.git_sha}\nTREE_SHA=${result.manifest.tree_sha}\nMANIFEST_SHA256=${result.manifest.manifest_sha256}\n`); } else if (args._[0] === 'cutover') cutover(args); else fail('command must be build, verify, or cutover'); } catch (error) { process.stderr.write(`RELEASE_VERIFY=FAIL\n${error.message}\n`); process.exitCode = 1; } }
if (require.main === module) main();
module.exports = { COMPATIBILITY, inventory, manifestDigest, verifyRelease };
