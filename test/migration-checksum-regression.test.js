const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');

const EXPECTED_MIGRATIONS = {
  'prisma/migrations/202608020001_license_correction_disposal/migration.sql': '75ca5c65c6c85bc3d20c311c9eaed25d20f961af4feb69c2d05b3dfa88d359b7',
  'prisma/migrations/202608030001_email_delivery_reservations/migration.sql': '3cb63e7df940eefe942b285970f8a238608cf0c9fe9df370a0223e931a2e9ff9'
};

const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');
const normalizeLineEndings = (content) => Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

test('migration files must match staging DB checksums exactly', () => {
  for (const [filePath, expectedChecksum] of Object.entries(EXPECTED_MIGRATIONS)) {
    assert.ok(fs.existsSync(filePath), `Migration file does not exist: ${filePath}`);

    // Working-tree migration SQL may be checked out with CRLF on Windows.
    // Permit line-ending translation only; any substantive byte change still fails.
    const workingBytes = fs.readFileSync(filePath);
    const workingHash = sha256(workingBytes);
    if (workingHash !== expectedChecksum) {
      const normalizedHash = sha256(normalizeLineEndings(workingBytes));
      assert.equal(
        normalizedHash,
        expectedChecksum,
        `Checksum mismatch for local file ${filePath}.\nExpected: ${expectedChecksum}\nActual: ${workingHash}\nThe difference is not explainable by CRLF/LF checkout translation.`
      );
    }

    // The committed Git blob is authoritative and must remain byte-identical to staging.
    const gitBytes = execFileSync('git', ['show', `HEAD:${filePath}`], { stdio: ['pipe', 'pipe', 'ignore'] });
    const gitHash = sha256(gitBytes);
    assert.equal(
      gitHash,
      expectedChecksum,
      `Checksum mismatch for committed git blob of ${filePath}.\nExpected: ${expectedChecksum}\nActual: ${gitHash}`
    );
  }
});
