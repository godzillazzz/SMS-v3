'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

function safeKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/.test(key) && !key.includes('..') && !key.includes('//') && !key.split('/').some((part) => !part || part === '.' || part === '..');
}
async function checksum(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile()) throw new Error(stat.isSymbolicLink() ? 'SYMLINK_REJECTED' : 'SOURCE_NOT_REGULAR_FILE');
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes;
    do {
      ({ bytesRead: bytes } = await handle.read(buffer, 0, buffer.length, null));
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}
function countResult({ dryRun = true } = {}) { return { scanned: 0, copied: 0, wouldCopy: 0, mismatch: 0, verified: 0, skipped: 0, failed: 0, dryRun, failures: [] }; }

async function readCheckpoint(checkpointPath) {
  if (!checkpointPath) return new Set();
  try {
    const value = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
    return new Set(Array.isArray(value.completed) ? value.completed : []);
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}
async function writeCheckpoint(checkpointPath, completed) {
  if (!checkpointPath) return;
  const temporary = `${checkpointPath}.tmp-${process.pid}`;
  await fs.writeFile(temporary, JSON.stringify({ version: 1, completed: [...completed].sort() }, null, 2));
  await fs.rename(temporary, checkpointPath);
}
async function copyFile(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await fs.copyFile(source, temporary);
  await fs.rename(temporary, destination);
}
async function assertContainedRoots(sourceRoot, destinationRoot) {
  const [sourceReal, destinationReal] = await Promise.all([fs.realpath(sourceRoot), fs.realpath(destinationRoot)]);
  const sourceStat = await fs.lstat(sourceRoot); const destinationStat = await fs.lstat(destinationRoot);
  if (!sourceStat.isDirectory() || !destinationStat.isDirectory() || sourceStat.isSymbolicLink() || destinationStat.isSymbolicLink()) throw new Error('ROOT_SYMLINK_OR_NOT_DIRECTORY');
  return { sourceReal, destinationReal };
}
async function plan({ sourceRoot, destinationRoot, manifestPath, dryRun = true, checkpointPath = null, retries = 2 }) {
  const { sourceReal, destinationReal } = await assertContainedRoots(sourceRoot, destinationRoot);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest)) throw new Error('INVALID_MANIFEST');
  const completed = await readCheckpoint(checkpointPath);
  const result = countResult({ dryRun });
  for (const item of manifest) {
    result.scanned += 1;
    try {
      if (!safeKey(item.key) || !/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error('INVALID_MANIFEST_ITEM');
      const checkpointKey = `${item.key}:${item.sha256.toLowerCase()}`;
      if (completed.has(checkpointKey)) { result.skipped += 1; continue; }
      const source = path.join(sourceReal, item.key);
      const destination = path.join(destinationReal, item.key);
      const sourceHash = await checksum(source);
      if (sourceHash.toLowerCase() !== item.sha256.toLowerCase()) throw new Error('SOURCE_CHECKSUM_MISMATCH');
      let destinationHash = null;
      try { destinationHash = await checksum(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (destinationHash?.toLowerCase() === sourceHash.toLowerCase()) {
        result.verified += 1;
      } else {
        result.mismatch += Number(destinationHash !== null);
        if (dryRun) result.wouldCopy += 1;
        else {
          let lastError;
          for (let attempt = 0; attempt <= Math.max(0, Number(retries) || 0); attempt += 1) {
            try { await copyFile(source, destination); lastError = null; break; } catch (error) { lastError = error; }
          }
          if (lastError) throw lastError;
          if ((await checksum(destination)).toLowerCase() !== sourceHash.toLowerCase()) throw new Error('DESTINATION_CHECKSUM_MISMATCH');
          result.copied += 1;
        }
      }
      if (!dryRun) {
        completed.add(checkpointKey);
        await writeCheckpoint(checkpointPath, completed);
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({ key: item.key || null, code: String(error.message || 'FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 80) });
    }
  }
  return result;
}
if (require.main === module) {
  const [sourceRoot, destinationRoot, manifestPath] = process.argv.slice(2);
  if (!sourceRoot || !destinationRoot || !manifestPath) { console.error('Usage: node scripts/storage/copy-dry-run.js <source-root> <destination-root> <manifest.json>'); process.exitCode = 2; }
  else plan({ sourceRoot, destinationRoot, manifestPath }).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { plan, safeKey };
