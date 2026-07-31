const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

function loadEnvironment(overrides = {}) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.DATABASE_URL;
  delete childEnvironment.DIRECT_URL;
  delete childEnvironment.VERCEL;
  delete childEnvironment.VERCEL_ENV;
  Object.assign(childEnvironment, overrides);
  return spawnSync(process.execPath, ['-e', "require('./src/config/env')"], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: childEnvironment
  });
}

const validJwtSecret = 'x'.repeat(32);

for (const vercelEnvironment of ['preview', 'production']) {
  test(`VERCEL_ENV=${vercelEnvironment} fails fast when DATABASE_URL is missing`, () => {
    const result = loadEnvironment({ NODE_ENV: vercelEnvironment === 'production' ? 'production' : 'test', VERCEL_ENV: vercelEnvironment, JWT_SECRET: validJwtSecret });
    const output = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /DATABASE_URL/);
    assert.doesNotMatch(output, /postgres(ql)?:\/\/|localhost|127\.0\.0\.1|sms_v3_(dev|test)/i);
  });
}

test('Vercel environments reject an explicitly configured local database', () => {
  const localDatabaseUrl = ['postgresql:', '', 'test:test@127.0.0.1:5432', 'sms_v3_test'].join('/');
  const result = loadEnvironment({ NODE_ENV: 'production', VERCEL_ENV: 'preview', DATABASE_URL: localDatabaseUrl, JWT_SECRET: validJwtSecret });
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /Invalid environment configuration: DATABASE_URL/);
  assert.doesNotMatch(output, /non-local|non-test|localhost|sms_v3_test/);
  assert.doesNotMatch(output, /postgres(ql)?:\/\/|127\.0\.0\.1/);
});

test('local NODE_ENV=test keeps isolated test defaults when not running on Vercel', () => {
  const result = loadEnvironment({ NODE_ENV: 'test' });
  assert.equal(result.status, 0);
});
