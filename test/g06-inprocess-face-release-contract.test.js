'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

test('G06 release contract keeps retired in-process face assets out of the Vercel function bundle', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const fn = config.functions?.['api/[...path].js'];
  assert.ok(fn, 'API serverless function config is required');
  assert.equal(fn.includeFiles, undefined);
  assert.equal(config.env?.FACE_VERIFICATION_IN_PROCESS_ENABLED, undefined);
  assert.doesNotMatch(JSON.stringify(config), /@vladmandic\/human|human\.node-wasm|@tensorflow\/tfjs-backend-wasm/i);
});
