'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROVENANCE_SCHEMA_VERSION = 'sms-v3-release-provenance/v1';
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

function assert(condition, message) {
  if (!condition) throw new Error(`release provenance guard: ${message}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertRealDirectory(root, label) {
  assert(typeof root === 'string' && root.length > 0, `${label} root is required`);
  let stat;
  try { stat = fs.lstatSync(root); } catch {
    throw new Error(`release provenance guard: ${label} root is missing: ${root}`);
  }
  assert(stat.isDirectory(), `${label} root must be a real directory: ${root}`);
  return path.resolve(root);
}

function assertDistinctRoots(backendRoot, frontendRoot) {
  assert(backendRoot !== frontendRoot, 'backend_root and frontend_root must be distinct');
  const isNested = (relative) => relative && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  assert(!isNested(path.relative(backendRoot, frontendRoot))
    && !isNested(path.relative(frontendRoot, backendRoot)),
  'backend_root and frontend_root must not be nested');
}

function collectInventory(root) {
  const canonicalRoot = assertRealDirectory(root, 'artifact');
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
      const absolute = path.join(directory, entry);
      const stat = fs.lstatSync(absolute);
      assert(!stat.isSymbolicLink(), `symlink is not allowed in artifact root: ${path.relative(canonicalRoot, absolute)}`);
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) {
        const relative = path.relative(canonicalRoot, absolute).split(path.sep).join('/');
        const content = fs.readFileSync(absolute);
        files.push({ path: relative, bytes: content.length, sha256: sha256(content) });
      } else assert(false, `unsupported file type in artifact root: ${path.relative(canonicalRoot, absolute)}`);
    }
  }
  visit(canonicalRoot);
  assert(files.length > 0, `artifact root is empty: ${root}`);
  return files;
}

function inventoryDigest(root) {
  const inventory = collectInventory(root);
  return { inventory, digest: sha256(JSON.stringify(inventory)) };
}

function validateReleaseProvenance(manifest) {
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'manifest must be a JSON object');
  assert(manifest.schema_version === PROVENANCE_SCHEMA_VERSION, 'unsupported schema_version');
  assert(manifest.git_sha && GIT_SHA.test(manifest.git_sha), 'invalid git_sha');
  assert(manifest.tree_sha && GIT_SHA.test(manifest.tree_sha), 'invalid tree_sha');
  assert(typeof manifest.build_id === 'string' && manifest.build_id.trim(), 'invalid build_id');
  assert(typeof manifest.build_timestamp === 'string' && manifest.build_timestamp.endsWith('Z')
    && !Number.isNaN(Date.parse(manifest.build_timestamp))
    && new Date(manifest.build_timestamp).toISOString() === manifest.build_timestamp, 'invalid build_timestamp');
  assert(typeof manifest.source_branch === 'string' && manifest.source_branch.trim(), 'invalid source_branch');
  assert(Number.isSafeInteger(manifest.ci_run_id) && manifest.ci_run_id > 0, 'invalid ci_run_id');
  assert(manifest.artifacts && typeof manifest.artifacts === 'object' && !Array.isArray(manifest.artifacts), 'artifacts object is required');
  assert(SHA256.test(manifest.artifacts.backend_digest || ''), 'invalid artifacts.backend_digest');
  assert(SHA256.test(manifest.artifacts.frontend_inventory_digest || ''), 'invalid artifacts.frontend_inventory_digest');
  assert(manifest.tooling && typeof manifest.tooling === 'object' && !Array.isArray(manifest.tooling), 'tooling object is required');
  assert(typeof manifest.tooling.node === 'string' && manifest.tooling.node.trim(), 'invalid tooling.node');
  assert(typeof manifest.tooling.package_manager === 'string' && manifest.tooling.package_manager.trim(), 'invalid tooling.package_manager');
  assert(typeof manifest.tooling.verifier === 'string' && manifest.tooling.verifier.trim(), 'invalid tooling.verifier');
  return Object.freeze(manifest);
}

function verifyReleaseProvenance({ manifest, actual }) {
  const validated = validateReleaseProvenance(manifest);
  assert(actual && typeof actual === 'object', 'actual release identity is required');
  for (const field of ['git_sha', 'tree_sha', 'build_id', 'source_branch', 'ci_run_id']) {
    assert(actual[field] === validated[field], `${field} mismatch`);
  }
  const backendRoot = assertRealDirectory(actual.backend_root, 'backend');
  const frontendRoot = assertRealDirectory(actual.frontend_root, 'frontend');
  assertDistinctRoots(backendRoot, frontendRoot);
  const backend = inventoryDigest(backendRoot);
  const frontend = inventoryDigest(frontendRoot);
  assert(backend.digest === validated.artifacts.backend_digest, 'backend artifact digest mismatch');
  assert(frontend.digest === validated.artifacts.frontend_inventory_digest, 'frontend inventory digest mismatch');
  return Object.freeze({
    schemaVersion: validated.schema_version,
    gitSha: validated.git_sha,
    treeSha: validated.tree_sha,
    buildId: validated.build_id,
    ciRunId: validated.ci_run_id,
    backendDigest: backend.digest,
    frontendInventoryDigest: frontend.digest,
  });
}

module.exports = {
  PROVENANCE_SCHEMA_VERSION,
  collectInventory,
  inventoryDigest,
  validateReleaseProvenance,
  verifyReleaseProvenance,
};
