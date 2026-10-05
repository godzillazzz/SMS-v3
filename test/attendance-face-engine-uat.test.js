'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('in-process face-engine UAT is retired from the deployed Attendance route graph', () => {
  const route = read('src/routes/attendance.routes.js');
  assert.doesNotMatch(route, /attendance-face-engine-uat|in-process-face-match\.provider|inProcessFaceRuntimeConfigured|attendanceFaceEngineUatEnabled/);
  assert.doesNotMatch(route, /\/uat\/in-process-face-engine\/probe/);
});

test('Vercel runtime no longer activates or bundles the in-process Human\/TFJS face engine', () => {
  const vercelConfig = JSON.parse(read('vercel.json'));
  const serialized = JSON.stringify(vercelConfig);
  assert.equal(vercelConfig.env?.FACE_VERIFICATION_IN_PROCESS_ENABLED, undefined);
  assert.equal(vercelConfig.functions?.['api/[...path].js']?.includeFiles, undefined);
  assert.doesNotMatch(serialized, /@vladmandic\/human|tfjs-backend-wasm|human\.node-wasm/i);
});
