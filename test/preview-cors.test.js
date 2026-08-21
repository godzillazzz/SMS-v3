process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCorsOrigins, isCorsOriginAllowed } = require('../src/config/env');

const configuredOrigin = 'https://sms-v3-staging-ten.vercel.app';
const previewDeploymentOrigin = 'https://sms-v3-staging-8nrefkbfm-godzillazz.vercel.app';
const previewBranchOrigin = 'https://sms-v3-staging-git-feat-g06-1b-attendance-admin-config-ui-v1-godzillazz.vercel.app';

test('production allows only explicitly configured CORS origins', () => {
  const origins = buildCorsOrigins({
    corsOrigin: configuredOrigin,
    vercelEnv: 'production',
    vercelUrl: 'sms-v3-staging-8nrefkbfm-godzillazz.vercel.app',
    vercelBranchUrl: 'sms-v3-staging-git-feat-g06-1b-attendance-admin-config-ui-v1-godzillazz.vercel.app'
  });
  assert.deepEqual(origins, [configuredOrigin]);
  assert.equal(isCorsOriginAllowed(configuredOrigin, origins), true);
  assert.equal(isCorsOriginAllowed(previewDeploymentOrigin, origins), false);
});

test('Preview includes only configured and current Vercel deployment origins', () => {
  const origins = buildCorsOrigins({
    corsOrigin: ` ${configuredOrigin}, ${configuredOrigin} `,
    vercelEnv: 'preview',
    vercelUrl: 'sms-v3-staging-8nrefkbfm-godzillazz.vercel.app',
    vercelBranchUrl: 'sms-v3-staging-git-feat-g06-1b-attendance-admin-config-ui-v1-godzillazz.vercel.app'
  });
  assert.deepEqual(origins, [configuredOrigin, previewDeploymentOrigin, previewBranchOrigin]);
  assert.equal(isCorsOriginAllowed(configuredOrigin, origins), true);
  assert.equal(isCorsOriginAllowed(previewDeploymentOrigin, origins), true);
  assert.equal(isCorsOriginAllowed(previewBranchOrigin, origins), true);
  assert.equal(isCorsOriginAllowed('https://random-project.vercel.app', origins), false);
  assert.equal(isCorsOriginAllowed('https://attacker.example', origins), false);
  assert.equal(isCorsOriginAllowed(undefined, origins), true);
});

test('credentialed CORS rejects wildcard and non-origin configuration', () => {
  assert.throws(() => buildCorsOrigins({ corsOrigin: '*', vercelEnv: 'preview' }), /wildcard/);
  assert.throws(() => buildCorsOrigins({ corsOrigin: 'https://example.test/path', vercelEnv: 'preview' }), /scheme and host/);
  assert.throws(() => buildCorsOrigins({ corsOrigin: configuredOrigin, vercelEnv: 'preview', vercelUrl: 'https://not-a-hostname.example' }), /hostname/);
});
