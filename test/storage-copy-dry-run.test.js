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
