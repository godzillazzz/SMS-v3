'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyLinuxArtifact } = require('../scripts/ci/verify-linux-artifact');
const EXPECTED_SHARP_VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).dependencies.sharp;

function fixture({ includeWindows = false, includeSharp = true, sharpVersion = EXPECTED_SHARP_VERSION } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-linux-artifact-'));
  if (includeSharp) {
    for (const name of ['sharp', '@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64']) {
      const packageDir = path.join(root, 'functions', 'api.func', 'node_modules', ...name.split('/'));
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, version: name === 'sharp' ? sharpVersion : name.includes('libvips') ? '1.3.3' : sharpVersion }));
    }
  }
  if (includeWindows) {
    const packageDir = path.join(root, 'functions', 'api.func', 'node_modules', '@img', 'sharp-win32-x64');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@img/sharp-win32-x64', version: sharpVersion }));
  }
  return root;
}

function sharpContext({ dependencyVersion = EXPECTED_SHARP_VERSION, loadedVersion = dependencyVersion } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-sharp-context-'));
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ dependencies: { sharp: dependencyVersion } }));
  const sharpDir = path.join(cwd, 'node_modules', 'sharp');
  fs.mkdirSync(sharpDir, { recursive: true });
  fs.writeFileSync(path.join(sharpDir, 'index.js'), `module.exports = { versions: { sharp: '${loadedVersion}' } };\n`);
  return cwd;
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

test('sharp load must match the exact version pinned in the root package.json', () => {
  const root = fixture();
  const cwd = sharpContext();
  try {
    const result = verifyLinuxArtifact({ root, cwd, platform: 'linux', arch: 'x64', requireSharpLoad: true });
    assert.equal(result.hasSharp, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('sharp load fails when its runtime version does not match the root package.json', () => {
  const root = fixture();
  const cwd = sharpContext({ loadedVersion: '0.35.4' });
  try {
    assert.throws(
      () => verifyLinuxArtifact({ root, cwd, platform: 'linux', arch: 'x64', requireSharpLoad: true }),
      /does not match root dependency/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('sharp artifact verification rejects a non-exact root dependency version', () => {
  const root = fixture();
  const cwd = sharpContext({ dependencyVersion: '~0.35.5', loadedVersion: '0.35.5' });
  try {
    assert.throws(
      () => verifyLinuxArtifact({ root, cwd, platform: 'linux', arch: 'x64', requireSharpLoad: true }),
      /dependencies\.sharp must be an exact version/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('sharp lockfile records the libc for both Linux x64 variants', () => {
  const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package-lock.json'), 'utf8'));
  const expected = {
    '@img/sharp-linux-x64': ['glibc'],
    '@img/sharp-libvips-linux-x64': ['glibc'],
    '@img/sharp-linuxmusl-x64': ['musl'],
    '@img/sharp-libvips-linuxmusl-x64': ['musl'],
  };

  for (const [name, libc] of Object.entries(expected)) {
    assert.deepEqual(lock.packages[`node_modules/${name}`]?.libc, libc, `${name} libc metadata`);
  }
});
