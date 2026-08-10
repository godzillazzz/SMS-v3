const test = require('node:test');
const assert = require('node:assert/strict');
const { getUatConfig, normalizeBaseUrl } = require('../e2e/helpers/uat-config');
const { requestTarget, sanitizeDiagnostic } = require('../e2e/helpers/uat-observe');

const configuredEnvironment = {
  UAT_BASE_URL: 'https://candidate.example.test',
  UAT_ADMIN_EMAIL: 'admin@example.test',
  UAT_ADMIN_PASSWORD: 'admin-password',
  UAT_MANAGER_EMAIL: 'manager@example.test',
  UAT_MANAGER_PASSWORD: 'manager-password',
  UAT_VIEWER_EMAIL: 'viewer@example.test',
  UAT_VIEWER_PASSWORD: 'viewer-password'
};

test('UAT configuration rejects missing values without exposing credentials', () => {
  assert.throws(() => getUatConfig({ UAT_BASE_URL: 'https://candidate.example.test' }), (error) => {
    assert.equal(error.code, 'UAT_CONFIGURATION_MISSING');
    assert.match(error.message, /UAT_ADMIN_EMAIL/);
    assert.doesNotMatch(error.message, /admin-password/);
    return true;
  });
});

test('UAT configuration accepts role-specific environment values and HTTPS base URL', () => {
  const config = getUatConfig(configuredEnvironment);
  assert.equal(config.baseURL, 'https://candidate.example.test');
  assert.equal(config.accounts.ADMIN.email, configuredEnvironment.UAT_ADMIN_EMAIL);
  assert.equal(config.accounts.MANAGER.email, configuredEnvironment.UAT_MANAGER_EMAIL);
  assert.equal(config.accounts.VIEWER.email, configuredEnvironment.UAT_VIEWER_EMAIL);
});

test('UAT base URL permits HTTP only when explicitly enabled for local execution', () => {
  assert.throws(() => normalizeBaseUrl('http://127.0.0.1:5173', false), /must use HTTPS/);
  assert.equal(normalizeBaseUrl('http://127.0.0.1:5173', true), 'http://127.0.0.1:5173');
});

test('UAT diagnostics redact sensitive values and query strings', () => {
  const message = sanitizeDiagnostic('Authorization=Bearer-value password=not-safe admin@example.test');
  assert.doesNotMatch(message, /Bearer-value|not-safe|admin@example\.test/);
  assert.equal(requestTarget('https://candidate.example.test/api/v1/dashboard?token=not-safe'), 'https://candidate.example.test/api/v1/dashboard');
});
