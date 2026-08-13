const { automationBypassHeaders } = require('./technical-smoke');

function safeRequestError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function authenticatedRequest(path, {
  accessToken,
  baseURL = process.env.UAT_BASE_URL,
  data,
  method = 'GET',
  timeout = 60_000
} = {}) {
  if (!accessToken) throw safeRequestError('UAT_ACCESS_TOKEN_REQUIRED');

  const url = new URL(path, baseURL);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...automationBypassHeaders(process.env, baseURL, url.toString())
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    return { payload, status: response.status };
  } catch (error) {
    throw safeRequestError(error?.name === 'AbortError' ? 'UAT_API_TIMEOUT' : 'UAT_API_REQUEST_FAILED');
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { authenticatedRequest };
