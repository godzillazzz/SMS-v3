const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_SENTINELS, verifyArtifact } = require('../scripts/ci/verify-release-artifact');

test('release sentinels include CFG-06 authority UI and Employee Critical Changes', () => {
  assert.ok(DEFAULT_SENTINELS.includes('ตารางผู้มีอำนาจอนุมัติและกรอบเวลา'));
  assert.ok(DEFAULT_SENTINELS.includes('เกณฑ์ SLA'));
  const panel = fs.readFileSync(path.join(__dirname, '../frontend/src/components/ApprovalAuthorityMatrixPanel.tsx'), 'utf8');
  assert.ok(panel.includes('ตารางผู้มีอำนาจอนุมัติและกรอบเวลา'));
  assert.ok(panel.includes('เกณฑ์ SLA'));
  assert.ok(DEFAULT_SENTINELS.includes('การเปลี่ยนแปลงสำคัญ'));
});

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


test('T38 attendance supervisor label is required in release artifacts and present in navigation', () => {
  const newLabel = 'ศูนย์ควบคุมการลงเวลา';
  assert.equal(DEFAULT_SENTINELS.length, 8, 'preserve all required release sentinels');
  assert.ok(DEFAULT_SENTINELS.includes(newLabel));
  assert.ok(!DEFAULT_SENTINELS.includes('ลงเวลาแทนพนักงาน'));
  const navigation = fs.readFileSync(path.join(__dirname, '../frontend/src/main.tsx'), 'utf8');
  assert.ok(navigation.includes("{ id: 'attendanceSupervisor', icon: 'dashboard', label: 'ศูนย์ควบคุมการลงเวลา' }"));
});

test('fails closed if the new T38 supervisor sentinel is absent from the artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-r7-release-artifact-'));
  try {
    const otherSentinels = DEFAULT_SENTINELS.filter((sentinel) => sentinel !== 'ศูนย์ควบคุมการลงเวลา');
    fs.writeFileSync(path.join(dir, 'index-abc.js'), otherSentinels.join('\n'), 'utf8');
    assert.throws(
      () => verifyArtifact([dir]),
      /missing required feature sentinels: ศูนย์ควบคุมการลงเวลา/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CI verifies the actual built frontend bundle with the full release artifact sentinel guard', () => {
  const verifier = fs.readFileSync(path.join(__dirname, '../scripts/ci/verify-frontend-production-bundle.js'), 'utf8');
  assert.ok(verifier.includes("require('./verify-release-artifact')"));
  assert.ok(verifier.includes("verifyArtifact([path.join(root, 'frontend', 'dist')])"));
  assert.ok(verifier.includes('FRONTEND_RELEASE_ARTIFACT_GUARD=PASS'));
});
