const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_SENTINELS, verifyArtifact } = require('../scripts/ci/verify-release-artifact');

test('passes when all required feature sentinels are present in built assets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-release-artifact-'));
  try {
    fs.writeFileSync(path.join(dir, 'index-abc.js'), DEFAULT_SENTINELS.join('\n'), 'utf8');
    const result = verifyArtifact([dir]);
    assert.equal(result.sentinels.length, DEFAULT_SENTINELS.length);
    assert.equal(result.fileCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails closed when a critical feature sentinel is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-release-artifact-'));
  try {
    fs.writeFileSync(path.join(dir, 'index-abc.js'), 'เข้าสู่ระบบด้วย Passkey\nลงเวลา\nSecurity Site', 'utf8');
    assert.throws(() => verifyArtifact([dir]), /missing required feature sentinels/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fails closed when no built JS or HTML artifact exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-release-artifact-'));
  try {
    assert.throws(() => verifyArtifact([dir]), /no JS\/HTML artifact files found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
