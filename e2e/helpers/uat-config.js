const roles = ['ADMIN', 'MANAGER', 'VIEWER'];
const modes = ['technical', 'authenticated'];
const TARGETED_AUTH_RETRY_SCOPE = 'admin-rbac-targeted-retry';
const TARGETED_AUTH_RETRY_TEST_TITLES = Object.freeze([
  'V3 ADMIN: navigation shell',
  'V3 ADMIN: Unified Report Center acceptance',
  'V3 ADMIN: authenticated responsive smoke',
  'V3 ADMIN: License initial-load network contract',
  'V3 ADMIN: Report Center exact network contract',
  'V3 MANAGER: navigation shell',
  'V3 MANAGER: Unified Report Center acceptance',
  'V3 MANAGER: authenticated responsive smoke'
]);
const G03_READONLY_SCOPE = 'g03-readonly-targeted';
const G03_READONLY_TEST_TITLES = Object.freeze([
  'G03 ADMIN: leave quota provisioning read-only contract',
  'G03 MANAGER: leave quota provisioning control is absent',
  'G03 VIEWER: leave quota provisioning control is absent'
]);
const scopes = ['full', 'report-center-diagnostic', TARGETED_AUTH_RETRY_SCOPE, G03_READONLY_SCOPE];

function configurationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeBaseUrl(value, allowHttp) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('UAT configuration invalid: UAT_BASE_URL must be an absolute URL.');
  }

  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error('UAT configuration invalid: UAT_BASE_URL must use HTTPS unless UAT_ALLOW_HTTP=true.');
  }

  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeUatMode(value = 'technical') {
  const mode = String(value || 'technical').trim().toLowerCase();
  if (!modes.includes(mode)) {
    throw configurationError('UAT_MODE_INVALID', 'UAT mode invalid: use technical or authenticated.');
  }
  return mode;
}

function normalizeUatScope(value = 'full') {
  const scope = String(value || 'full').trim().toLowerCase();
  if (!scopes.includes(scope)) {
    throw configurationError(
      'UAT_SCOPE_NOT_APPROVED',
      'UAT scope not approved: use full, report-center-diagnostic, admin-rbac-targeted-retry, or g03-readonly-targeted.'
    );
  }
  return scope;
}

function isReportCenterDiagnostic(environment = process.env) {
  return normalizeUatScope(environment.UAT_SCOPE) === 'report-center-diagnostic';
}

function isAdminRbacTargetedRetry(environment = process.env) {
  return normalizeUatScope(environment.UAT_SCOPE) === TARGETED_AUTH_RETRY_SCOPE;
}

function isG03ReadonlyTargeted(environment = process.env) {
  return normalizeUatScope(environment.UAT_SCOPE) === G03_READONLY_SCOPE;
}

function getUatScopeTestTitles(environment = process.env) {
  const scope = normalizeUatScope(environment.UAT_SCOPE);
  if (scope === TARGETED_AUTH_RETRY_SCOPE) return [...TARGETED_AUTH_RETRY_TEST_TITLES];
  if (scope === G03_READONLY_SCOPE) return [...G03_READONLY_TEST_TITLES];
  return undefined;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
}

function getUatScopeGrep(environment = process.env) {
  if (String(environment.UAT_MODE || 'technical').trim().toLowerCase() !== 'authenticated') return undefined;
  const titles = getUatScopeTestTitles(environment);
  if (!titles) return undefined;
  return new RegExp('(?:' + titles.map(escapeRegExp).join('|') + ')$');
}

function getUatConfig(environment = process.env) {
  if (!String(environment.UAT_BASE_URL || '').trim()) {
    throw configurationError('UAT_CONFIGURATION_MISSING', 'UAT configuration missing: UAT_BASE_URL');
  }

  const mode = normalizeUatMode(environment.UAT_MODE);
  const scope = normalizeUatScope(environment.UAT_SCOPE);
  if (mode === 'technical' && [TARGETED_AUTH_RETRY_SCOPE, G03_READONLY_SCOPE].includes(scope)) {
    throw configurationError('UAT_SCOPE_MODE_INVALID', `UAT scope ${scope} requires authenticated mode.`);
  }
  const accounts = {};
  for (const role of roles) {
    const emailKey = `UAT_${role}_EMAIL`;
    const passwordKey = `UAT_${role}_PASSWORD`;
    const email = String(environment[emailKey] || '').trim();
    const password = String(environment[passwordKey] || '');
    if (Boolean(email) !== Boolean(password)) {
      throw configurationError(
        'UAT_OPTIONAL_CREDENTIAL_CONFIGURATION_INVALID',
        `UAT optional credential configuration invalid: ${role}`
      );
    }
    accounts[role] = { configured: Boolean(email), email: email || undefined, password: password || undefined };
  }

  if (mode === 'authenticated' && roles.some((role) => !accounts[role].configured)) {
    throw configurationError('UAT_CREDENTIALS_REQUIRED', 'UAT_CREDENTIALS_REQUIRED');
  }

  return {
    mode,
    scope,
    baseURL: normalizeBaseUrl(String(environment.UAT_BASE_URL), environment.UAT_ALLOW_HTTP === 'true'),
    expectedDeploymentId: String(environment.UAT_EXPECTED_DEPLOYMENT_ID || '').trim(),
    accounts
  };
}

function hasRoleCredentials(role, environment = process.env) {
  if (!roles.includes(role)) throw new Error(`Unsupported UAT role: ${role}`);
  return getUatConfig(environment).accounts[role].configured;
}

module.exports = {
  G03_READONLY_SCOPE,
  G03_READONLY_TEST_TITLES,
  TARGETED_AUTH_RETRY_SCOPE,
  TARGETED_AUTH_RETRY_TEST_TITLES,
  configurationError,
  getUatConfig,
  getUatScopeGrep,
  getUatScopeTestTitles,
  hasRoleCredentials,
  isAdminRbacTargetedRetry,
  isG03ReadonlyTargeted,
  isReportCenterDiagnostic,
  normalizeBaseUrl,
  normalizeUatMode,
  normalizeUatScope,
  roles,
  modes,
  scopes
};
