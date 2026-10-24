process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('S3 provider configuration is accepted outside test when complete', () => {
  const result = spawnSync(process.execPath, ['-e', "process.env.NODE_ENV='development'; process.env.STORAGE_PROVIDER='s3'; process.env.S3_ENDPOINT='http://127.0.0.1:9000'; process.env.S3_ACCESS_KEY_ID='key'; process.env.S3_SECRET_ACCESS_KEY='secret'; process.env.DATABASE_URL='postgresql://x:***@localhost:5432/db'; process.env.JWT_SECRET='12345678901234567890123456789012'; require('./src/config/env')"], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
