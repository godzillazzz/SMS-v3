const roles = ['ADMIN', 'MANAGER', 'VIEWER'];
const modes = ['technical', 'authenticated'];

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

function getUatConfig(environment = process.env) {
  if (!String(environment.UAT_BASE_URL || '').trim()) {
    throw configurationError('UAT_CONFIGURATION_MISSING', 'UAT configuration missing: UAT_BASE_URL');
  }

  const mode = normalizeUatMode(environment.UAT_MODE);
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
    baseURL: normalizeBaseUrl(String(environment.UAT_BASE_URL), environment.UAT_ALLOW_HTTP === 'true'),
    expectedDeploymentId: String(environment.UAT_EXPECTED_DEPLOYMENT_ID || '').trim(),
    accounts
  };
}

function hasRoleCredentials(role, environment = process.env) {
  if (!roles.includes(role)) throw new Error(`Unsupported UAT role: ${role}`);
  return getUatConfig(environment).accounts[role].configured;
}

module.exports = { configurationError, getUatConfig, hasRoleCredentials, normalizeBaseUrl, normalizeUatMode, roles, modes };
