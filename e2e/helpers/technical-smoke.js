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

function isProtectedCandidateUrl(targetUrl = process.env.UAT_BASE_URL) {
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === 'https:'
      && parsed.hostname !== 'sms-v3-staging-ten.vercel.app'
      && /^sms-v3-staging-[a-z0-9-]+\.vercel\.app$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function classifyOriginBehavior({ targetUrl, status, body = '', errorText = '' } = {}) {
  let hostname = '';
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return 'UNKNOWN';
  }

  if (hostname === 'sms-v3-staging-ten.vercel.app') return 'CANONICAL_COMPATIBLE';
  if (status === 403 && /origin\s+not\s+allowed|cors|cross[- ]origin/i.test(`${body} ${errorText}`)) {
    return 'CORS_ORIGIN_RESTRICTED';
  }
  return 'UNKNOWN';
}

function isSameOrigin(targetUrl, requestUrl) {
  try {
    return new URL(requestUrl, targetUrl).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

function automationBypassHeaders(
  environment = process.env,
  targetUrl = process.env.UAT_BASE_URL,
  requestUrl = targetUrl,
  options = {}
) {
  const secret = String(environment.VERCEL_AUTOMATION_BYPASS_SECRET || '');
  if (!secret || !isProtectedCandidateUrl(targetUrl) || !isSameOrigin(targetUrl, requestUrl)) return {};
  return {
    'x-vercel-protection-bypass': secret,
    ...(options.setBypassCookie ? { 'x-vercel-set-bypass-cookie': 'true' } : {})
  };
}

function automationRequestOptions(
  options = {},
  environment = process.env,
  targetUrl = process.env.UAT_BASE_URL,
  requestUrl = targetUrl,
  headerOptions = {}
) {
  const headers = { ...(options.headers || {}) };
  delete headers['x-vercel-protection-bypass'];
  delete headers['x-vercel-set-bypass-cookie'];
  return {
    ...options,
    headers: {
      ...headers,
      ...automationBypassHeaders(environment, targetUrl, requestUrl, headerOptions)
    }
  };
}

function artifactContainsSecret(content, secret) {
  return Boolean(secret && secret.length > 0)
    && Buffer.from(content).includes(Buffer.from(secret));
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
  const protectedCandidate = isProtectedCandidateUrl(targetUrl);
  return protectedCandidate && (environment.VERCEL_TRUSTED_OIDC_TOKEN || environment.VERCEL_AUTOMATION_BYPASS_SECRET)
    ? 'off'
    : 'retain-on-failure';
}

module.exports = {
  assertExpectedStatus,
  assertNotVercelProtectionPage,
  assertReadiness,
  artifactContainsSecret,
  automationBypassHeaders,
  automationRequestOptions,
  classifyOriginBehavior,
  extractViteAssets,
  getTraceMode,
  isVercelProtectionPage,
  readJsonResponse,
  readResponseBody,
  isProtectedCandidateUrl,
  isSameOrigin,
  shouldUseTrustedSource,
  technicalFailure,
  trustedRequestOptions,
  trustedSourceHeaders
};
