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

function collectInventory(root) {
  assert(typeof root === 'string' && root.length > 0, 'artifact root is required');
  assert(fs.existsSync(root) && fs.statSync(root).isDirectory(), `artifact root is missing: ${root}`);
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        const content = fs.readFileSync(absolute);
        files.push({ path: relative, bytes: content.length, sha256: sha256(content) });
      }
    }
  }
  visit(root);
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
  assert(typeof manifest.build_timestamp === 'string' && !Number.isNaN(Date.parse(manifest.build_timestamp)), 'invalid build_timestamp');
  assert(typeof manifest.source_branch === 'string' && manifest.source_branch.trim(), 'invalid source_branch');
  assert(Number.isSafeInteger(manifest.ci_run_id) && manifest.ci_run_id > 0, 'invalid ci_run_id');
  assert(manifest.artifacts && typeof manifest.artifacts === 'object', 'artifacts object is required');
  assert(SHA256.test(manifest.artifacts.backend_digest || ''), 'invalid artifacts.backend_digest');
  assert(SHA256.test(manifest.artifacts.frontend_inventory_digest || ''), 'invalid artifacts.frontend_inventory_digest');
  assert(manifest.tooling && typeof manifest.tooling === 'object', 'tooling object is required');
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
  assert(actual.backend_root && actual.frontend_root, 'backend_root and frontend_root are required');
  const backend = inventoryDigest(actual.backend_root);
  const frontend = inventoryDigest(actual.frontend_root);
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
