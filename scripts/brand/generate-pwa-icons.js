'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..', '..');
const source = path.join(root, 'frontend', 'public', 'brand', 'sms-logo.webp');
const publicDir = path.join(root, 'frontend', 'public');

// CURRENT SMS SHIELD: crop the four-quadrant guard/clock/calendar/check shield from the
// current vertical brand asset. The wordmark is intentionally excluded because it is unreadable at app-icon sizes.
const SOURCE_SHIELD_CROP = { left: 128, top: 0, width: 700, height: 680 };

function iconSvg(size, shieldPng, options = {}) {
  const { maskable = false } = options;
  const shieldWidth = Math.round(size * (maskable ? 0.56 : 0.72));
  const shieldX = Math.round((size - shieldWidth) / 2);
  const shieldY = Math.round(size * (maskable ? 0.21 : 0.12));
  const shieldHeight = Math.round(shieldWidth * 0.92);
  const radius = maskable ? 0 : Math.round(size * 0.22);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#071529"/>
        <stop offset="0.55" stop-color="#092746"/>
        <stop offset="1" stop-color="#06455c"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="35%" r="64%">
        <stop offset="0" stop-color="#22d3ee" stop-opacity=".20"/>
        <stop offset="1" stop-color="#020813" stop-opacity="0"/>
      </radialGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
        <feDropShadow dx="0" dy="${Math.max(2, Math.round(size * .025))}" stdDeviation="${Math.max(3, Math.round(size * .035))}" flood-color="#020813" flood-opacity=".72"/>
      </filter>
    </defs>
    <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>
    <rect width="${size}" height="${size}" rx="${radius}" fill="url(#glow)"/>
    <rect x="${Math.round(size * .025)}" y="${Math.round(size * .025)}" width="${Math.round(size * .95)}" height="${Math.round(size * .95)}" rx="${Math.round(radius * .9)}" fill="none" stroke="#67e8f9" stroke-opacity=".16" stroke-width="${Math.max(1, Math.round(size * .006))}"/>
    <image href="data:image/png;base64,${shieldPng.toString('base64')}" x="${shieldX}" y="${shieldY}" width="${shieldWidth}" height="${shieldHeight}" preserveAspectRatio="xMidYMid meet" filter="url(#shadow)"/>
  </svg>`);
}

async function buildIcon(size, outputName, options = {}) {
  const shieldMask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SOURCE_SHIELD_CROP.width}" height="${SOURCE_SHIELD_CROP.height}" viewBox="0 0 ${SOURCE_SHIELD_CROP.width} ${SOURCE_SHIELD_CROP.height}">
    <!-- The brand source overlaps the top of the SMS wordmark with the shield point. Mask to the actual shield silhouette so no wordmark fragments enter the app icon. -->
    <path fill="#fff" d="M82 78 L145 20 Q350 -15 555 20 L618 78 L598 465 Q590 535 526 570 L350 675 L174 570 Q110 535 102 465 Z"/>
  </svg>`);
  const shield = await sharp(source)
    .extract(SOURCE_SHIELD_CROP)
    .ensureAlpha()
    .composite([{ input: shieldMask, blend: 'dest-in' }])
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp(iconSvg(size, shield, options))
    .ensureAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(publicDir, outputName));
}

async function main() {
  await Promise.all([
    buildIcon(192, 'pwa-icon-192.png'),
    buildIcon(512, 'pwa-icon-512.png', { maskable: true }),
    buildIcon(180, 'apple-touch-icon.png')
  ]);
  const outputs = ['pwa-icon-192.png', 'pwa-icon-512.png', 'apple-touch-icon.png'];
  for (const name of outputs) {
    const metadata = await sharp(path.join(publicDir, name)).metadata();
    const stat = await fs.stat(path.join(publicDir, name));
    console.log(`${name} ${metadata.width}x${metadata.height} ${stat.size} bytes`);
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { SOURCE_SHIELD_CROP, buildIcon };
