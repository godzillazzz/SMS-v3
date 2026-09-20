'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const assetsDir = path.join(projectRoot, 'frontend', 'dist', 'assets');
const maxChunkBytes = 500_000;

function fail(message) {
  console.error(`FRONTEND_PRODUCTION_BUNDLE=FAIL ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(assetsDir)) {
  fail('reason=assets-directory-missing');
} else {
  const files = fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
  const chunks = files.map((name) => {
    const fullPath = path.join(assetsDir, name);
    return { name, bytes: fs.statSync(fullPath).size };
  }).sort((a, b) => b.bytes - a.bytes);

  const devRuntime = chunks.find((chunk) => chunk.name.includes('jsx-dev-runtime'));
  const oversized = chunks.filter((chunk) => chunk.bytes > maxChunkBytes);
  const maxChunk = chunks[0];

  if (devRuntime) fail(`reason=jsx-dev-runtime-present file=${devRuntime.name}`);
  if (oversized.length) {
    for (const chunk of oversized) {
      fail(`reason=chunk-over-500kb file=${chunk.name} bytes=${chunk.bytes}`);
    }
  }

  if (!process.exitCode) {
    console.log(`FRONTEND_PRODUCTION_BUNDLE=PASS max_js_chunk=${maxChunk?.name || 'none'} max_js_bytes=${maxChunk?.bytes || 0} js_chunks=${chunks.length}`);
  }
}
