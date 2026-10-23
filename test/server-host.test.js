process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const envSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'env.js'), 'utf8');

test('server host binding is explicit when configured and preserves legacy default', () => {
  assert.match(envSource, /HOST: z\.preprocess\(emptyToUndefined, z\.string\(\)\.trim\(\)\.min\(1\)\.optional\(\)\)/);
  assert.match(envSource, /host: parsed\.HOST/);
  assert.match(serverSource, /env\.host === undefined/);
  assert.match(serverSource, /app\.listen\(env\.port, env\.host, onListening\)/);
});

test('removing env.host wiring is mutation-detectable', () => {
  assert.match(serverSource, /env\.host === undefined/);
  assert.match(serverSource, /app\.listen\(env\.port, env\.host, onListening\)/);
});

test('proxy trust requires a loopback HOST binding', () => {
  assert.match(envSource, /TRUST_PROXY_LOOPBACK === 'true'/);
  assert.match(envSource, /HOST must bind to loopback when TRUST_PROXY_LOOPBACK=true/);
  assert.match(envSource, /127\.0\.0\.1/);
  assert.match(envSource, /::1/);
});
