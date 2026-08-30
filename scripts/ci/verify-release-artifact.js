'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SENTINELS = [
  'เข้าสู่ระบบด้วย Passkey',
  'ลงเวลา',
  'อุปกรณ์ลงเวลา',
  'Security Site',
  'ลงเวลาแทนพนักงาน',
];

function collectFiles(targets) {
  const files = [];
  for (const target of targets) {
    if (!target || !fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      files.push(target);
      continue;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) files.push(...collectFiles([child]));
      else if (/\.(?:js|mjs|cjs|html)$/i.test(entry.name)) files.push(child);
    }
  }
  return files;
}

function verifyArtifact(targets, sentinels = DEFAULT_SENTINELS) {
  const files = collectFiles(targets);
  if (files.length === 0) throw new Error('release artifact guard: no JS/HTML artifact files found');
  const corpus = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const missing = sentinels.filter((sentinel) => !corpus.includes(sentinel));
  if (missing.length) {
    throw new Error(`release artifact guard: missing required feature sentinels: ${missing.join(', ')}`);
  }
  return { fileCount: files.length, sentinels: [...sentinels] };
}

function main() {
  const targets = process.argv.slice(2);
  const result = verifyArtifact(targets.length ? targets : ['frontend/dist', '.vercel/output/static']);
  process.stdout.write(`RELEASE_ARTIFACT_GUARD=PASS\nARTIFACT_FILES=${result.fileCount}\nSENTINELS=${result.sentinels.length}\n`);
}

if (require.main === module) main();

module.exports = { DEFAULT_SENTINELS, collectFiles, verifyArtifact };
