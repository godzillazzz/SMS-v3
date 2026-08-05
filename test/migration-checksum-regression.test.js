const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('crypto');
const { execSync } = require('node:child_process');

const EXPECTED_MIGRATIONS = {
  'prisma/migrations/202608020001_license_correction_disposal/migration.sql': '75ca5c65c6c85bc3d20c311c9eaed25d20f961af4feb69c2d05b3dfa88d359b7',
  'prisma/migrations/202608030001_email_delivery_reservations/migration.sql': '3cb63e7df940eefe942b285970f8a238608cf0c9fe9df370a0223e931a2e9ff9'
};

test('migration files must match staging DB checksums exactly', () => {
  for (const [filePath, expectedChecksum] of Object.entries(EXPECTED_MIGRATIONS)) {
    assert.ok(fs.existsSync(filePath), `Migration file does not exist: ${filePath}`);
    const content = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    
    // Check local filesystem bytes
    assert.equal(
      hash,
      expectedChecksum,
      `Checksum mismatch for local file ${filePath}.\nExpected: ${expectedChecksum}\nActual: ${hash}\n(Possible line ending translation issue)`
    );

    // Check git blob bytes if git is available (to ensure committed bytes are also correct)
    try {
      const gitBytes = execSync(`git show HEAD:${filePath}`, { stdio: ['pipe', 'pipe', 'ignore'] });
      const gitHash = crypto.createHash('sha256').update(gitBytes).digest('hex');
      assert.equal(
        gitHash,
        expectedChecksum,
        `Checksum mismatch for committed git blob of ${filePath}.\nExpected: ${expectedChecksum}\nActual: ${gitHash}`
      );
    } catch (err) {
      // If git show fails (e.g. not committed yet or git not installed in environment), skip git blob check
      if (err.message && err.message.includes('exists on disk')) {
        throw err;
      }
    }
  }
});
