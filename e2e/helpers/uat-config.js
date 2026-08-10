const roles = ['ADMIN', 'MANAGER', 'VIEWER'];

function configurationError(missing) {
  const error = new Error(`UAT configuration missing: ${missing.join(', ')}`);
  error.code = 'UAT_CONFIGURATION_MISSING';
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

function getUatConfig(environment = process.env) {
  const missing = [];
  if (!String(environment.UAT_BASE_URL || '').trim()) missing.push('UAT_BASE_URL');

  const accounts = {};
  for (const role of roles) {
    const emailKey = `UAT_${role}_EMAIL`;
    const passwordKey = `UAT_${role}_PASSWORD`;
    if (!String(environment[emailKey] || '').trim()) missing.push(emailKey);
    if (!String(environment[passwordKey] || '').trim()) missing.push(passwordKey);
    accounts[role] = { email: environment[emailKey], password: environment[passwordKey] };
  }

  if (missing.length) throw configurationError(missing);

  return {
    baseURL: normalizeBaseUrl(String(environment.UAT_BASE_URL), environment.UAT_ALLOW_HTTP === 'true'),
    expectedDeploymentId: String(environment.UAT_EXPECTED_DEPLOYMENT_ID || '').trim(),
    protectionBypass: String(environment.UAT_VERCEL_PROTECTION_BYPASS || ''),
    accounts
  };
}

module.exports = { configurationError, getUatConfig, normalizeBaseUrl, roles };
