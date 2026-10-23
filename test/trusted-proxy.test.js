process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isLoopbackAddress, trustProxyAddress } = require('../src/security/trusted-proxy');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const envSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'env.js'), 'utf8');

test('loopback recognition accepts IPv4, IPv6, and IPv4-mapped IPv6 only', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('0:0:0:0:0:0:0:1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('198.51.100.7'), false);
  assert.equal(isLoopbackAddress('::ffff:198.51.100.7'), false);
});

test('proxy trust is explicit, first-hop only, and disabled by default', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(trustProxyAddress(address, 0, false), false);
    assert.equal(trustProxyAddress(address, 0, true), true);
    assert.equal(trustProxyAddress(address, 1, true), false);
  }
  assert.equal(trustProxyAddress('198.51.100.7', 0, true), false);
});

test('forged forwarded chain cannot make a non-loopback peer trusted', () => {
  assert.equal(trustProxyAddress('203.0.113.9', 0, true), false);
});

test('application wiring remains fail-closed and mutation-sensitive', () => {
  assert.match(envSource, /TRUST_PROXY_LOOPBACK: z\.enum\(\['true', 'false'\]\)\.default\('false'\)/);
  assert.match(appSource, /app\.set\('trust proxy', \(address, index\) => trustProxyAddress\(address, index, env\.trustProxyLoopback\)\)/);
  assert.doesNotMatch(appSource, /app\.set\(['\"]trust proxy['\"], true\)/);
});
