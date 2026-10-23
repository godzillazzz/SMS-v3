'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  PROVENANCE_SCHEMA_VERSION,
  inventoryDigest,
  validateReleaseProvenance,
  verifyReleaseProvenance,
} = require('../scripts/ci/verify-release-provenance');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-provenance-'));
  const backend = path.join(root, 'backend');
  const frontend = path.join(root, 'frontend');
  fs.mkdirSync(backend); fs.mkdirSync(frontend);
  fs.writeFileSync(path.join(backend, 'server.js'), 'backend-v1');
  fs.writeFileSync(path.join(frontend, 'index.js'), 'frontend-v1');
  const manifest = {
    schema_version: PROVENANCE_SCHEMA_VERSION,
    git_sha: 'a'.repeat(40),
    tree_sha: 'b'.repeat(40),
    build_id: 'build-20261023-001',
    build_timestamp: '2026-10-23T00:00:00Z',
    source_branch: 'fix/serverless-database-reliability',
    ci_run_id: 40123456789,
    artifacts: {
      backend_digest: inventoryDigest(backend).digest,
      frontend_inventory_digest: inventoryDigest(frontend).digest,
    },
    tooling: { node: '22.21.1', package_manager: 'npm@11.6.2', verifier: 'verify-release-provenance.js' },
  };
  return { root, backend, frontend, manifest };
}

test('accepts a complete release provenance record and binds both artifact inventories', () => {
  const f = fixture();
  const result = verifyReleaseProvenance({ manifest: f.manifest, actual: { ...f.manifest, backend_root: f.backend, frontend_root: f.frontend } });
  assert.equal(result.gitSha, f.manifest.git_sha);
  assert.equal(result.frontendInventoryDigest, f.manifest.artifacts.frontend_inventory_digest);
});

test('rejects a modified frontend asset', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.frontend, 'index.js'), 'frontend-modified');
  assert.throws(() => verifyReleaseProvenance({ manifest: f.manifest, actual: { ...f.manifest, backend_root: f.backend, frontend_root: f.frontend } }), /frontend inventory digest mismatch/);
});

test('rejects mismatched Git SHA', () => {
  const f = fixture();
  assert.throws(() => verifyReleaseProvenance({ manifest: f.manifest, actual: { ...f.manifest, git_sha: 'c'.repeat(40), backend_root: f.backend, frontend_root: f.frontend } }), /git_sha mismatch/);
});

test('rejects mixed frontend/backend artifact inventories', () => {
  const f = fixture();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-v3-mixed-'));
  fs.writeFileSync(path.join(other, 'server.js'), 'backend-other');
  assert.throws(() => verifyReleaseProvenance({ manifest: f.manifest, actual: { ...f.manifest, backend_root: other, frontend_root: f.frontend } }), /backend artifact digest mismatch/);
});

test('rejects missing manifest', () => {
  const f = fixture();
  assert.throws(() => verifyReleaseProvenance({ actual: { ...f.manifest, backend_root: f.backend, frontend_root: f.frontend } }), /manifest must be a JSON object/);
});

test('rejects malformed or incomplete manifest fields', () => {
  const f = fixture();
  for (const [field, value] of [['schema_version', 'wrong'], ['tree_sha', 'bad'], ['ci_run_id', 0], ['artifacts', undefined]]) {
    const candidate = { ...f.manifest, [field]: value };
    assert.throws(() => validateReleaseProvenance(candidate), /release provenance guard/);
  }
});

test('rejects missing artifact roots rather than silently treating them as empty', () => {
  const f = fixture();
  assert.throws(() => verifyReleaseProvenance({ manifest: f.manifest, actual: { ...f.manifest, backend_root: f.backend, frontend_root: '/missing/frontend' } }), /artifact root is missing/);
});
