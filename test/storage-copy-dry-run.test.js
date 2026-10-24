process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { plan } = require('../scripts/storage/copy-dry-run');

test('checksum-first copy plan is idempotent and never writes by default', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smsv3-copy-'));
  const source = path.join(root, 'source'); const destination = path.join(root, 'destination');
  await fs.mkdir(path.join(source, 'licenses'), { recursive: true }); await fs.mkdir(destination, { recursive: true });
  const file = Buffer.from('synthetic-object'); const key = 'licenses/object.pdf';
  await fs.writeFile(path.join(source, key), file);
  const sha256 = crypto.createHash('sha256').update(file).digest('hex');
  const manifest = path.join(root, 'manifest.json'); await fs.writeFile(manifest, JSON.stringify([{ key, sha256 }]));
  const result = await plan({ sourceRoot: source, destinationRoot: destination, manifestPath: manifest });
  assert.deepEqual(result, { scanned: 1, copied: 0, wouldCopy: 1, mismatch: 0, verified: 0, skipped: 0, failed: 0, dryRun: true, failures: [] });
  await assert.rejects(fs.access(path.join(destination, key)));
});

test('dry-run does not checkpoint and real copy remains resumable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smsv3-copy-dry-run-checkpoint-'));
  const source = path.join(root, 'source'); const destination = path.join(root, 'destination');
  await fs.mkdir(path.join(source, 'docs'), { recursive: true }); await fs.mkdir(destination, { recursive: true });
  const files = { 'docs/photo.txt': Buffer.from('synthetic-photo'), 'docs/license.txt': Buffer.from('synthetic-license') };
  for (const [key, content] of Object.entries(files)) await fs.writeFile(path.join(source, key), content);
  const manifest = path.join(root, 'manifest.json'); const checkpoint = path.join(root, 'checkpoint.json');
  await fs.writeFile(manifest, JSON.stringify(Object.entries(files).map(([key, content]) => ({ key, sha256: crypto.createHash('sha256').update(content).digest('hex') }))));

  const dryRun = await plan({ sourceRoot: source, destinationRoot: destination, manifestPath: manifest, dryRun: true, checkpointPath: checkpoint });
  assert.equal(dryRun.wouldCopy, 2); assert.equal(dryRun.failed, 0);
  await assert.rejects(fs.access(checkpoint));

  const first = await plan({ sourceRoot: source, destinationRoot: destination, manifestPath: manifest, dryRun: false, checkpointPath: checkpoint });
  assert.equal(first.copied, 2); assert.equal(first.failed, 0);
  for (const [key, content] of Object.entries(files)) assert.deepEqual(await fs.readFile(path.join(destination, key)), content);

  const second = await plan({ sourceRoot: source, destinationRoot: destination, manifestPath: manifest, dryRun: false, checkpointPath: checkpoint });
  assert.equal(second.skipped, 2); assert.equal(second.copied, 0);
});

test('copy mode is checkpointed, checksum-verified, and idempotent for synthetic files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smsv3-copy-write-'));
  const source = path.join(root, 'source'); const destination = path.join(root, 'destination');
  await fs.mkdir(path.join(source, 'licenses'), { recursive: true }); await fs.mkdir(destination, { recursive: true });
  const file = Buffer.from('synthetic-copy'); const key = 'licenses/object.pdf';
  await fs.writeFile(path.join(source, key), file);
  const sha256 = crypto.createHash('sha256').update(file).digest('hex');
  const manifest = path.join(root, 'manifest.json'); const checkpoint = path.join(root, 'checkpoint.json');
  await fs.writeFile(manifest, JSON.stringify([{ key, sha256 }]));
  const first = await plan({ sourceRoot: source, destinationRoot: destination, manifestPath: manifest, dryRun: false, checkpointPath: checkpoint });
  assert.equal(first.copied, 1); assert.equal(first.failed, 0);
  assert.deepEqual(await fs.readFile(path.join(destination, key)), file);
  const second = await plan({ sourceRoot: source, destinationRoot: destination, manifestPath: manifest, dryRun: false, checkpointPath: checkpoint });
  assert.equal(second.skipped, 1); assert.equal(second.copied, 0);
});
