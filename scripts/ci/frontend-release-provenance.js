'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const SCHEMA = 'sms-v3-frontend-provenance/v1';
const STORAGE_SCHEMA = 'sms-v3-storage-target/v1';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(`frontend release provenance: ${message}`); };

function realDir(root) {
  let stat;
  try { stat = fs.lstatSync(root); } catch { fail(`root is missing: ${root}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`root must be a real directory: ${root}`);
  return path.resolve(root);
}

// Read each file through an O_NOFOLLOW descriptor and verify its identity before use.
function inventory(root) {
  const base = realDir(root); const files = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const absolute = path.join(dir, name); const stat = fs.lstatSync(absolute);
      const relative = path.relative(base, absolute).split(path.sep).join('/');
      if (stat.isSymbolicLink()) fail(`symlink is not allowed: ${relative}`);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) {
        let fd;
        try {
          fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          const opened = fs.fstatSync(fd);
          if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail(`file changed during inventory: ${relative}`);
          const data = fs.readFileSync(fd);
          const after = fs.fstatSync(fd);
          if (after.size !== opened.size || after.mtimeNs !== opened.mtimeNs) fail(`file changed during inventory: ${relative}`);
          files.push({ path: relative, bytes: data.length, sha256: sha256(data) });
        } finally { if (fd !== undefined) fs.closeSync(fd); }
      } else fail(`unsupported file type: ${relative}`);
    }
  };
  visit(base);
  if (!files.length) fail('frontend root is empty');
  return files;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function manifestPayload(manifest) {
  const { manifest_digest: ignored, ...payload } = manifest;
  return canonical(payload);
}

function validateAssets(assets) {
  if (!Array.isArray(assets) || !assets.length) fail('manifest inventory is required');
  const seen = new Set(); let last = '';
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object' || typeof asset.path !== 'string' || asset.path !== path.posix.normalize(asset.path) || asset.path.startsWith('../') || asset.path.includes('/../') || path.posix.isAbsolute(asset.path) || seen.has(asset.path) || asset.path <= last || !HASH.test(asset.sha256 || '') || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) fail(`invalid, duplicate, or unsorted asset path: ${asset.path}`);
    seen.add(asset.path); last = asset.path;
  }
}

function generateFrontendManifest(root, identity) {
  if (!identity || !SHA.test(identity.git_sha || '') || !SHA.test(identity.tree_sha || '') || !SHA.test(identity.backend_git_sha || identity.git_sha)) fail('invalid Git identity');
  if (identity.backend_git_sha !== identity.git_sha) fail('backend/frontend SHA pairing mismatch');
  if (!identity.backend_tree_sha || identity.backend_tree_sha !== identity.tree_sha) fail('backend/frontend tree pairing mismatch');
  if (!identity.build_id || typeof identity.build_id !== 'string' || !identity.build_timestamp) fail('build identity and timestamp are required');
  const assets = inventory(root);
  const manifest = { schema_version: SCHEMA, git_sha: identity.git_sha, tree_sha: identity.tree_sha, backend_git_sha: identity.backend_git_sha, backend_tree_sha: identity.backend_tree_sha, build_id: identity.build_id, build_timestamp: identity.build_timestamp, assets };
  validateAssets(manifest.assets);
  return Object.freeze({ ...manifest, manifest_digest: sha256(manifestPayload(manifest)) });
}

function verifyFrontendRelease({ manifest, servedRoot, backendGitSha, backendTreeSha, backendIdentity }) {
  if (!manifest || manifest.schema_version !== SCHEMA) fail('unsupported manifest schema');
  if (!SHA.test(manifest.git_sha || '') || !SHA.test(manifest.tree_sha || '') || manifest.backend_git_sha !== manifest.git_sha || manifest.backend_tree_sha !== manifest.tree_sha) fail('incomplete backend/frontend identity pairing');
  const expectedBackend = backendIdentity || { git_sha: backendGitSha, tree_sha: backendTreeSha };
  if (!SHA.test(expectedBackend.git_sha || '') || !SHA.test(expectedBackend.tree_sha || '') || manifest.git_sha !== expectedBackend.git_sha || manifest.tree_sha !== expectedBackend.tree_sha) fail('backend/frontend identity pairing mismatch');
  validateAssets(manifest.assets);
  if (manifest.manifest_digest !== sha256(manifestPayload(manifest))) fail('manifest digest mismatch');
  const actual = inventory(servedRoot);
  if (canonical(actual) !== canonical(manifest.assets)) fail('served-tree inventory mismatch');
  return { git_sha: manifest.git_sha, tree_sha: manifest.tree_sha, manifest_digest: manifest.manifest_digest, asset_count: actual.length };
}

function atomicWrite(file, value) {
  const parent = path.dirname(file); fs.mkdirSync(parent, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(parent, '.provenance-tmp-'));
  const temp = path.join(tempDir, path.basename(file));
  try {
    const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

function storageCompatible(target) {
  if (!target || target.schema_version !== STORAGE_SCHEMA || target.provider !== 'postgres+minio' || !target.capabilities || target.capabilities.database !== true || target.capabilities.object_storage !== true || target.capabilities.shared_identity !== true || target.capabilities.transactional_restore !== true) fail('storage compatibility guard refused unknown or incomplete target');
  return true;
}

function snapshot(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) return { exists: true, directory: true, mode: stat.mode };
    return { exists: true, symlink: stat.isSymbolicLink(), mode: stat.mode, bytes: stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file) };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
}
function restore(file, saved) {
  if (saved.exists && saved.directory && fs.existsSync(file) && fs.lstatSync(file).isDirectory()) return;
  fs.rmSync(file, { force: true, recursive: true });
  if (!saved.exists) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (saved.directory) fs.mkdirSync(file, { mode: saved.mode & 0o777 });
  else if (saved.symlink) fs.symlinkSync(saved.bytes, file);
  else fs.writeFileSync(file, saved.bytes, { mode: saved.mode & 0o777 });
}
function injected(stage, requested) {
  return requested === stage || (requested && requested[stage] === true);
}

function rehearseAtomicRollback({ root, releaseSha, previousSha, environment, failAfterSwitch = false, failureStage, rollbackTargetStorage, targetMetadata }) {
  if (!SHA.test(releaseSha || '') || !SHA.test(previousSha || '') || releaseSha === previousSha) fail('invalid release SHA');
  const target = targetMetadata || rollbackTargetStorage;
  if (!target || typeof target !== 'object') fail('storage compatibility guard refused unknown target');
  storageCompatible(target);
  const base = path.resolve(root); fs.mkdirSync(base, { recursive: true });
  const releases = path.join(base, 'releases'); const active = path.join(base, 'active'); const envFile = path.join(base, 'environment.json');
  const saved = { active: snapshot(active), env: snapshot(envFile), releases: {} };
  for (const sha of [previousSha, releaseSha]) {
    const dir = path.join(releases, sha); saved.releases[sha] = snapshot(dir);
  }
  const requestedFailure = failureStage || (failAfterSwitch ? 'switch' : undefined);
  let switched = false; let created = [];
  try {
    fs.mkdirSync(releases, { recursive: true });
    for (const sha of [previousSha, releaseSha]) {
      if (injected('creation', requestedFailure)) fail('injected creation failure');
      const dir = path.join(releases, sha); fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true }); fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
      const frontend = path.join(dir, 'frontend', 'index.html'); const backend = path.join(dir, 'backend', 'release.json');
      if (!fs.existsSync(frontend)) { fs.writeFileSync(frontend, sha); created.push(frontend); }
      if (!fs.existsSync(backend)) { fs.writeFileSync(backend, JSON.stringify({ git_sha: sha, tree_sha: sha })); created.push(backend); }
    }
    fs.rmSync(active, { force: true, recursive: true }); fs.symlinkSync(path.join('releases', previousSha), active);
    if (injected('switch', requestedFailure)) fail('injected switch failure');
    fs.rmSync(active, { force: true, recursive: true }); fs.symlinkSync(path.join('releases', releaseSha), active); switched = true;
    if (injected('verification', requestedFailure)) fail('injected verification failure');
    const activeTarget = fs.realpathSync(active); if (activeTarget !== path.join(releases, releaseSha)) fail('active pointer verification failed');
    return { restored: false, activeSha: releaseSha, activePath: active, backendPath: path.join(activeTarget, 'backend'), frontendPath: path.join(activeTarget, 'frontend'), environment: environment || {} };
  } catch (error) {
    try {
      if (injected('restore', requestedFailure)) throw new Error('injected restore failure');
      restore(active, saved.active); restore(envFile, saved.env);
      for (const sha of [previousSha, releaseSha]) if (!saved.releases[sha].exists) fs.rmSync(path.join(releases, sha), { recursive: true, force: true });
      if (saved.env.exists === false && environment !== undefined && !switched) restore(envFile, saved.env);
    } catch (recoveryError) { fail(`rollback recovery failed: ${recoveryError.message}`); }
    if (failureStage || failAfterSwitch) return { restored: true, activeSha: saved.active.exists && saved.active.symlink ? path.basename(saved.active.bytes) : previousSha, environment: saved.env.exists && !saved.env.symlink ? JSON.parse(saved.env.bytes) : undefined, error: error.message };
    throw error;
  }
}

module.exports = { generateFrontendManifest, inventory, rehearseAtomicRollback, verifyFrontendRelease, canonical, atomicWrite, storageCompatible };
