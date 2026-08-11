function technicalFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertExpectedStatus(actual, expected, code) {
  if (actual !== expected) throw technicalFailure(code);
}

function assertReadiness(payload) {
  if (!payload || payload.status !== 'ready') throw technicalFailure('READINESS_STATUS_INVALID');
  if (payload.database !== 'ok') throw technicalFailure('READINESS_DATABASE_NOT_OK');
}

function isVercelProtectionPage(html) {
  return typeof html === 'string'
    && /<title[^>]*>\s*Login\s*[–—-]\s*Vercel\s*<\/title>/i.test(html);
}

function assertNotVercelProtectionPage(html) {
  if (isVercelProtectionPage(html)) throw technicalFailure('PROTECTED_DEPLOYMENT_UNVERIFIED');
}

function extractViteAssets(html) {
  if (typeof html !== 'string' || !/<html[\s>]/i.test(html)) throw technicalFailure('APPLICATION_HTML_INVALID');
  assertNotVercelProtectionPage(html);
  if (/_next\//i.test(html)) throw technicalFailure('UNEXPECTED_NEXT_ARTIFACT');
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|css))["']/gi)].map((match) => match[1]);
  if (!assets.some((asset) => asset.endsWith('.js')) || !assets.some((asset) => asset.endsWith('.css'))) {
    throw technicalFailure('VITE_ASSETS_MISSING');
  }
  return [...new Set(assets)];
}

async function readResponseBody(response) {
  const body = await response.text();
  assertNotVercelProtectionPage(body);
  return body;
}

async function readJsonResponse(response, code) {
  const body = await readResponseBody(response);
  try {
    return JSON.parse(body);
  } catch {
    throw technicalFailure(code);
  }
}

function shouldUseTrustedSource(targetUrl = process.env.UAT_BASE_URL) {
  try {
    return new URL(targetUrl).hostname !== 'sms-v3-staging-ten.vercel.app';
  } catch {
    return false;
  }
}

function trustedSourceHeaders(environment = process.env, targetUrl = process.env.UAT_BASE_URL) {
  const token = String(environment.VERCEL_TRUSTED_OIDC_TOKEN || '');
  return token && shouldUseTrustedSource(targetUrl) ? { 'x-vercel-trusted-oidc-idp-token': token } : {};
}

function trustedRequestOptions(options = {}, environment = process.env, targetUrl = process.env.UAT_BASE_URL) {
  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...trustedSourceHeaders(environment, targetUrl)
    }
  };
}

function getTraceMode(environment = process.env, targetUrl = process.env.UAT_BASE_URL) {
  return environment.VERCEL_TRUSTED_OIDC_TOKEN && shouldUseTrustedSource(targetUrl) ? 'off' : 'retain-on-failure';
}

module.exports = {
  assertExpectedStatus,
  assertNotVercelProtectionPage,
  assertReadiness,
  extractViteAssets,
  getTraceMode,
  isVercelProtectionPage,
  readJsonResponse,
  readResponseBody,
  shouldUseTrustedSource,
  technicalFailure,
  trustedRequestOptions,
  trustedSourceHeaders
};
