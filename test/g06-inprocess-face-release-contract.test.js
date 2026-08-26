'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

test('G06 in-process face Vercel function bundles required local model and WASM assets with a valid string glob', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const fn = config.functions?.['api/[...path].js'];
  assert.ok(fn, 'API serverless function config is required');
  assert.equal(typeof fn.includeFiles, 'string', 'Vercel includeFiles must be a string glob');
  assert.match(fn.includeFiles, /@vladmandic\/human\/models\/\*\*/);
  assert.match(fn.includeFiles, /human\.node-wasm\.js/);
  assert.match(fn.includeFiles, /@tensorflow\/tfjs-backend-wasm\/dist\/\*\.wasm/);
});
