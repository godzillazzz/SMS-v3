process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('S3 provider is rejected outside test until WIRE-02', () => {
  const result = spawnSync(process.execPath, ['-e', "process.env.NODE_ENV='development'; process.env.STORAGE_PROVIDER='s3'; process.env.DATABASE_URL='postgresql://x:***@localhost:5432/db'; process.env.JWT_SECRET='12345678901234567890123456789012'; require('./src/config/env')"], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /STORAGE_PROVIDER/);
});
