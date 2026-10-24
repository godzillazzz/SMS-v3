'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  PROVENANCE_SCHEMA_VERSION,
  inventoryDigest,
  validateReleaseProvenance,
  verifyReleaseProvenance,
} = require('../scripts/ci/verify-release-provenance');

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
    build_timestamp: '2026-10-23T00:00:00.000Z',
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
  assert.throws(() => verifyReleaseProvenance({ manifest: f.manifest, actual: { ...f.manifest, backend_root: f.backend, frontend_root: '/missing/frontend' } }), /frontend root is missing/);
});

test('matches the golden inventory digest and metadata exactly', () => {
  const f = fixture();
  assert.deepEqual(inventoryDigest(f.backend).inventory, [{
    path: 'server.js', bytes: 10,
    sha256: 'b6a53f8b4e05e87ddc94339add3da13103fa39e7f56b4112527cd7a6d4342218',
  }]);
  assert.equal(f.manifest.artifacts.backend_digest,
    '3f67a6ba164f161fbc406b33b809843f501d34a4752b537892757a5ed8389460');
});

test('rejects symlink roots and symlink files', () => {
  const f = fixture();
  const rootLink = path.join(f.root, 'backend-link');
  fs.symlinkSync(f.backend, rootLink, 'dir');
  assert.throws(() => inventoryDigest(rootLink), /real directory/);
  fs.symlinkSync(path.join(f.backend, 'server.js'), path.join(f.frontend, 'linked.js'));
  assert.throws(() => inventoryDigest(f.frontend), /symlink is not allowed/);
});

test('rejects empty, identical, and nested roots', () => {
  const f = fixture();
  const empty = path.join(f.root, 'empty');
  fs.mkdirSync(empty);
  assert.throws(() => inventoryDigest(empty), /artifact root is empty/);
  assert.throws(() => verifyReleaseProvenance({ manifest: f.manifest,
    actual: { ...f.manifest, backend_root: f.backend, frontend_root: f.backend } }), /must be distinct/);
  assert.throws(() => verifyReleaseProvenance({ manifest: f.manifest,
    actual: { ...f.manifest, backend_root: f.root, frontend_root: f.backend } }), /must not be nested/);
});

test('rejects unsupported file types and ambiguous manifest structures', () => {
  const f = fixture();
  if (typeof fs.mkfifoSync === 'function') {
    const fifo = path.join(f.backend, 'pipe');
    fs.mkfifoSync(fifo, 0o600);
    assert.throws(() => inventoryDigest(f.backend), /unsupported file type/);
  }
  for (const candidate of [
    { ...f.manifest, build_timestamp: '2026-10-23T00:00:00Z' },
    { ...f.manifest, artifacts: [] },
    { ...f.manifest, tooling: [] },
  ]) assert.throws(() => validateReleaseProvenance(candidate), /release provenance guard/);
});
