'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyLinuxArtifact } = require('../scripts/ci/verify-linux-artifact');

function fixture({ includeWindows = false, includeSharp = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-linux-artifact-'));
  if (includeSharp) {
    for (const name of ['sharp', '@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64']) {
      const packageDir = path.join(root, 'functions', 'api.func', 'node_modules', ...name.split('/'));
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, version: name === 'sharp' ? '0.35.4' : name.includes('libvips') ? '1.3.3' : '0.35.4' }));
    }
  }
  if (includeWindows) {
    const packageDir = path.join(root, 'functions', 'api.func', 'node_modules', '@img', 'sharp-win32-x64');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@img/sharp-win32-x64', version: '0.35.4' }));
  }
  return root;
}

test('valid Linux x64 sharp artifact passes', () => {
  const root = fixture();
  try {
    const result = verifyLinuxArtifact({ root, platform: 'linux', arch: 'x64', requireSharpLoad: false });
    assert.equal(result.hasSharp, true);
    assert.deepEqual(result.unsupported, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Windows native package in a Linux artifact fails closed', () => {
  const root = fixture({ includeWindows: true });
  try {
    assert.throws(() => verifyLinuxArtifact({ root, platform: 'linux', arch: 'x64' }), /unsupported native packages/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Linux guard rejects artifacts built on Windows', () => {
  const root = fixture();
  try {
    assert.throws(() => verifyLinuxArtifact({ root, platform: 'win32', arch: 'x64' }), /built on linux-x64/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Linux guard requires both sharp and libvips packages when sharp is present', () => {
  const root = fixture({ includeSharp: false });
  try {
    assert.throws(() => verifyLinuxArtifact({ root, platform: 'linux', arch: 'x64' }), /sharp package is missing/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('generic artifact mode can be used for non-sharp functions without weakening release mode', () => {
  const root = fixture({ includeSharp: false });
  try {
    const result = verifyLinuxArtifact({ root, platform: 'linux', arch: 'x64', requireSharp: false });
    assert.equal(result.hasSharp, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
