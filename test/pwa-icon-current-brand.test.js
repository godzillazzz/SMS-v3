'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'frontend', 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
const worker = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
const generator = fs.readFileSync(path.join(root, 'scripts', 'brand', 'generate-pwa-icons.js'), 'utf8');
const oldHashes = new Set([
  'bf119a4f9b4d15a9af74e8695cff3283cb6ef70806140729ff40c5282abddab8',
  '71e19adbbb3a9136ecef87dc19e5bfeea190957ab7601055e743615ff6d2554a',
  '5b32dab36d657c85820892d8d228a04739b9de1c20188bdc2caa335d71f68025'
]);

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('PWA icons are generated from the current SMS shield and replace the legacy Y icon', async () => {
  assert.match(generator, /'brand', 'sms-logo\.webp'/);
  assert.match(generator, /CURRENT SMS SHIELD/);
  for (const [name, size] of [['pwa-icon-192.png', 192], ['pwa-icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const file = path.join(publicDir, name);
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.equal(metadata.hasAlpha, true);
    assert.equal(oldHashes.has(sha256(file)), false, `${name} still uses the legacy icon`);
  }
});

test('manifest separates any and maskable icons and cache revision invalidates installed PWA assets', () => {
  const purposes = manifest.icons.map((icon) => icon.purpose);
  assert.deepEqual(purposes, ['any', 'maskable']);
  assert.match(manifest.icons[0].src, /pwa-icon-192\.png\?v=2$/);
  assert.match(manifest.icons[1].src, /pwa-icon-512\.png\?v=2$/);
  assert.match(worker, /sms-pwa-shell-v7/);
  assert.doesNotMatch(worker, /sms-pwa-shell-v6/);
  assert.match(worker, /apple-touch-icon\.png\?v=2/);
});
