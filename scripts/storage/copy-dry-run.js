'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

function safeKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/.test(key) && !key.includes('..') && !key.includes('//') && !key.split('/').some((part) => !part || part === '.' || part === '..');
}
async function checksum(file) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(file));
  return hash.digest('hex');
}
async function plan({ sourceRoot, destinationRoot, manifestPath, dryRun = true }) {
  if (!dryRun) throw new Error('COPY_DRY_RUN_ONLY: explicit write mode is not implemented or authorized.');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const result = { scanned: 0, copied: 0, verified: 0, skipped: 0, failed: 0, dryRun: true, failures: [] };
  for (const item of manifest) {
    result.scanned += 1;
    try {
      if (!safeKey(item.key) || !/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error('INVALID_MANIFEST_ITEM');
      const source = path.join(sourceRoot, item.key);
      const destination = path.join(destinationRoot, item.key);
      const sourceHash = await checksum(source);
      if (sourceHash.toLowerCase() !== item.sha256.toLowerCase()) throw new Error('SOURCE_CHECKSUM_MISMATCH');
      try {
        const destinationHash = await checksum(destination);
        if (destinationHash.toLowerCase() === sourceHash.toLowerCase()) result.verified += 1;
        else result.copied += 1;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        result.copied += 1;
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
