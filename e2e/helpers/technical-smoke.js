'use strict';
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

module.exports = { automationBypassHeaders, automationRequestOptions };
