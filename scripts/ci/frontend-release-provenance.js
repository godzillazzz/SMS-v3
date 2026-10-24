'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(`frontend release provenance: ${message}`); };

function realDir(root) {
  let stat;
  try { stat = fs.lstatSync(root); } catch { fail(`root is missing: ${root}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`root must be a real directory: ${root}`);
  return path.resolve(root);
}

function inventory(root) {
  const base = realDir(root); const files = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const absolute = path.join(dir, name); const stat = fs.lstatSync(absolute);
      const relative = path.relative(base, absolute).split(path.sep).join('/');
      if (stat.isSymbolicLink()) fail(`symlink is not allowed: ${relative}`);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) { const data = fs.readFileSync(absolute); files.push({ path: relative, bytes: data.length, sha256: sha256(data) }); }
      else fail(`unsupported file type: ${relative}`);
    }
  };
  visit(base);
  if (!files.length) fail('frontend root is empty');
  return files;
}

function manifestPayload(manifest) {
  const { manifest_digest: ignored, ...payload } = manifest;
  return JSON.stringify(payload);
}

function generateFrontendManifest(root, identity) {
  if (!identity || !SHA.test(identity.git_sha || '') || !SHA.test(identity.tree_sha || '')) fail('invalid Git identity');
  if (!identity.build_id || !identity.build_timestamp) fail('build identity and timestamp are required');
  const assets = inventory(root);
  const manifest = { schema_version: 'sms-v3-frontend-provenance/v1', git_sha: identity.git_sha, tree_sha: identity.tree_sha, build_id: identity.build_id, build_timestamp: identity.build_timestamp, assets };
  return Object.freeze({ ...manifest, manifest_digest: sha256(manifestPayload(manifest)) });
}

function verifyFrontendRelease({ manifest, servedRoot, backendGitSha }) {
  if (!manifest || manifest.schema_version !== 'sms-v3-frontend-provenance/v1') fail('unsupported manifest schema');
  if (!SHA.test(manifest.git_sha || '') || manifest.git_sha !== backendGitSha) fail('backend/frontend SHA pairing mismatch');
  if (!Array.isArray(manifest.assets)) fail('manifest inventory is required');
  for (const asset of manifest.assets) {
    if (!asset.path || path.posix.normalize(asset.path) !== asset.path || asset.path.startsWith('../') || asset.path.includes('/../') || path.posix.isAbsolute(asset.path) || !HASH.test(asset.sha256 || '') || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) fail(`invalid or traversing asset path: ${asset.path}`);
  }
  if (manifest.manifest_digest !== sha256(manifestPayload(manifest))) fail('manifest digest mismatch');
  const actual = inventory(servedRoot);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.assets)) fail('served-tree inventory mismatch');
  return { git_sha: manifest.git_sha, manifest_digest: manifest.manifest_digest, asset_count: actual.length };
}

function atomicWrite(file, value) {
  const temp = `${file}.next`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, file);
}

function rehearseAtomicRollback({ root, releaseSha, previousSha, environment, failAfterSwitch = false, rollbackTargetStorage = 'MINIO_AND_DATABASE_COMPATIBLE' }) {
  if (!SHA.test(releaseSha || '') || !SHA.test(previousSha || '') || releaseSha === previousSha) fail('invalid release SHA');
  if (rollbackTargetStorage === 'MINIO_ONLY_READS' || rollbackTargetStorage === 'MIXED_PROVIDER_READS') fail('storage compatibility guard refused rollback target');
  const base = path.resolve(root); const releases = path.join(base, 'releases'); fs.mkdirSync(releases, { recursive: true });
  for (const sha of [previousSha, releaseSha]) { const dir = path.join(releases, sha); fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true }); fs.mkdirSync(path.join(dir, 'backend'), { recursive: true }); fs.writeFileSync(path.join(dir, 'frontend', 'index.html'), sha); fs.writeFileSync(path.join(dir, 'backend', 'release.json'), JSON.stringify({ git_sha: sha })); }
  const active = path.join(base, 'active.json'); const envFile = path.join(base, 'environment.json');
  atomicWrite(active, { backend_sha: previousSha, frontend_sha: previousSha }); atomicWrite(envFile, environment || {});
  atomicWrite(active, { backend_sha: releaseSha, frontend_sha: releaseSha });
  let restored = false;
  try { if (failAfterSwitch) throw new Error('injected cutover failure'); }
  catch (error) { atomicWrite(active, { backend_sha: previousSha, frontend_sha: previousSha }); restored = true; }
  return { restored, activeSha: JSON.parse(fs.readFileSync(active, 'utf8')).frontend_sha, environment: JSON.parse(fs.readFileSync(envFile, 'utf8')) };
}

module.exports = { generateFrontendManifest, inventory, rehearseAtomicRollback, verifyFrontendRelease };
