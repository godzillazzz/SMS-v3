const test = require('node:test');
const assert = require('node:assert/strict');
const { getUatConfig, hasRoleCredentials, isAdminRbacTargetedRetry, isReportCenterDiagnostic, normalizeBaseUrl, normalizeUatScope } = require('../e2e/helpers/uat-config');
const { isHarmlessConsoleError, requestTarget, sanitizeDiagnostic } = require('../e2e/helpers/uat-observe');

const configuredEnvironment = {
  UAT_BASE_URL: 'https://candidate.example.test',
  UAT_ADMIN_EMAIL: 'admin@example.test',
  UAT_ADMIN_PASSWORD: 'admin-password',
  UAT_MANAGER_EMAIL: 'manager@example.test',
  UAT_MANAGER_PASSWORD: 'manager-password',
  UAT_VIEWER_EMAIL: 'viewer@example.test',
  UAT_VIEWER_PASSWORD: 'viewer-password'
};

test('UAT configuration requires only a base URL without exposing credentials', () => {
  assert.throws(() => getUatConfig({}), (error) => {
    assert.equal(error.code, 'UAT_CONFIGURATION_MISSING');
    assert.match(error.message, /UAT_BASE_URL/);
    assert.doesNotMatch(error.message, /admin-password/);
    return true;
  });

  const config = getUatConfig({ UAT_BASE_URL: 'https://candidate.example.test' });
  assert.deepEqual(config.accounts, {
    ADMIN: { configured: false, email: undefined, password: undefined },
    MANAGER: { configured: false, email: undefined, password: undefined },
    VIEWER: { configured: false, email: undefined, password: undefined }
  });
});

test('UAT configuration accepts role-specific environment values and HTTPS base URL', () => {
  const config = getUatConfig(configuredEnvironment);
  assert.equal(config.baseURL, 'https://candidate.example.test');
  assert.equal(config.scope, 'full');
  assert.equal(config.accounts.ADMIN.email, configuredEnvironment.UAT_ADMIN_EMAIL);
  assert.equal(config.accounts.MANAGER.email, configuredEnvironment.UAT_MANAGER_EMAIL);
  assert.equal(config.accounts.VIEWER.email, configuredEnvironment.UAT_VIEWER_EMAIL);
});

test('UAT scope accepts only the approved fixed values', () => {
  assert.equal(normalizeUatScope(undefined), 'full');
  assert.equal(normalizeUatScope('report-center-diagnostic'), 'report-center-diagnostic');
  assert.equal(normalizeUatScope('admin-rbac-targeted-retry'), 'admin-rbac-targeted-retry');
  assert.equal(normalizeUatScope('g03-readonly-targeted'), 'g03-readonly-targeted');
  assert.throws(() => normalizeUatScope('all-the-things'), { code: 'UAT_SCOPE_NOT_APPROVED' });
  assert.equal(getUatConfig({ ...configuredEnvironment, UAT_SCOPE: 'report-center-diagnostic' }).scope, 'report-center-diagnostic');
  assert.equal(getUatConfig({ ...configuredEnvironment, UAT_SCOPE: 'admin-rbac-targeted-retry', UAT_MODE: 'authenticated' }).scope, 'admin-rbac-targeted-retry');
  assert.equal(getUatConfig({ ...configuredEnvironment, UAT_SCOPE: 'g03-readonly-targeted', UAT_MODE: 'authenticated' }).scope, 'g03-readonly-targeted');
  assert.throws(() => getUatConfig({ ...configuredEnvironment, UAT_SCOPE: 'admin-rbac-targeted-retry', UAT_MODE: 'technical' }), { code: 'UAT_SCOPE_MODE_INVALID' });
  assert.throws(() => getUatConfig({ ...configuredEnvironment, UAT_SCOPE: 'g03-readonly-targeted', UAT_MODE: 'technical' }), { code: 'UAT_SCOPE_MODE_INVALID' });
  assert.equal(isReportCenterDiagnostic({ UAT_SCOPE: 'report-center-diagnostic' }), true);
  assert.equal(isReportCenterDiagnostic({ UAT_SCOPE: 'full' }), false);
  assert.equal(isAdminRbacTargetedRetry({ UAT_SCOPE: 'admin-rbac-targeted-retry' }), true);
  assert.equal(isAdminRbacTargetedRetry({ UAT_SCOPE: 'full' }), false);
});

test('partial optional role credentials are invalid while each complete role remains independently available', () => {
  assert.throws(
    () => getUatConfig({ UAT_BASE_URL: 'https://candidate.example.test', UAT_ADMIN_EMAIL: 'admin@example.test' }),
    { code: 'UAT_OPTIONAL_CREDENTIAL_CONFIGURATION_INVALID' }
  );
  assert.equal(hasRoleCredentials('ADMIN', configuredEnvironment), true);
  assert.equal(hasRoleCredentials('MANAGER', { UAT_BASE_URL: 'https://candidate.example.test' }), false);
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

test('UAT console allowlist accepts only the unauthenticated refresh 403', () => {
  const message = (url, text) => ({ type: () => 'error', location: () => ({ url }), text: () => text });
  assert.equal(isHarmlessConsoleError(message('https://sms-v3-staging-ten.vercel.app/api/v1/auth/refresh', 'Failed to load resource: the server responded with a status of 403')), true);
  assert.equal(isHarmlessConsoleError(message('https://sms-v3-staging-ten.vercel.app/api/v1/dashboard', 'Failed to load resource: the server responded with a status of 403')), false);
  assert.equal(isHarmlessConsoleError(message('https://sms-v3-staging-ten.vercel.app/api/v1/auth/refresh', 'Failed to load resource: the server responded with a status of 500')), false);
});
