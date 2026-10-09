'use strict';
const { roles, fail } = require('./config');
const { getRoleApiMatrix } = require('./role-matrix');
const { automationBypassHeaders } = require('../helpers/technical-smoke');
class RoleSessions {
  #sessions = new Map();
  put(role, payload) {
    if (!roles.includes(role) || payload?.user?.role !== role || typeof payload?.user?.id !== 'string' || !payload.user.id || typeof payload?.accessToken !== 'string' || !payload.accessToken) fail('UAT_ROLE_IDENTITY_MISMATCH');
    for (const [otherRole, session] of this.#sessions) if (otherRole !== role && (session.user.id === payload.user.id || session.accessToken === payload.accessToken)) fail('UAT_ROLE_SESSION_NOT_ISOLATED');
    this.#sessions.set(role, { user: payload.user, accessToken: payload.accessToken });
  }
  get(role) { if (!this.#sessions.has(role)) fail('UAT_ROLE_SESSION_REQUIRED'); return this.#sessions.get(role); }
  clear() { this.#sessions.clear(); }
  summary() { return roles.map((role) => ({ role, status: this.#sessions.has(role) ? 'READY' : 'BLOCKED' })); }
}
async function preflightAccounts(createContext, config) {
  const sessions = new RoleSessions();
  try {
    for (const role of roles) {
      const context = await createContext();
      try {
      const account = config.accounts[role];
      const response = await context.post('/api/v1/auth/login', { data: { ...account, clientType: 'browser' }, timeout: 15000, maxRedirects: 0 });
      if (response.status() !== 200) fail('UAT_ACCOUNT_LOGIN_FAILED');
      const payload = await response.json();
      if (payload.passwordResetRequired || payload.user?.passwordResetRequired || payload.user?.isViewingAs || payload.user?.impersonation) fail('UAT_ACCOUNT_NOT_READY');
      sessions.put(role, payload);
      } finally { await context.dispose(); }
    }
    return sessions;
  } catch { sessions.clear(); fail('UAT_ACCOUNT_PREFLIGHT_FAILED'); }
}
async function readRoleApi(context, role, session, path) {
  if (session.user?.role !== role) fail('UAT_ROLE_IDENTITY_MISMATCH');
  const allowed = getRoleApiMatrix(role, undefined, { employeeLinked: Boolean(session.user.employeeId) });
  if (!allowed.some((entry) => entry.path === path)) fail('UAT_READ_PATH_NOT_ALLOWLISTED');
  return context.get(path, { headers: { Authorization: `Bearer ${session.accessToken}` }, timeout: 30000, maxRedirects: 0 });
}
async function installReadonlyBrowser(page, session, baseURL, { realLogin = false } = {}) {
  const attempts = [];
  const origin = new URL(baseURL).origin;
  async function guardedFetch(route, req, url) {
    const response = await route.fetch({ maxRedirects: 0, headers: { ...req.headers(), ...(url.origin === origin ? automationBypassHeaders(process.env, baseURL, req.url()) : {}) } });
    if (response.status() >= 300 && response.status() < 400) {
      attempts.push({ method: req.method(), path: 'redirect-blocked' });
      return route.abort('blockedbyclient');
    }
    return route.fulfill({ response });
  }
  await page.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (realLogin && url.origin === origin && url.pathname === '/api/v1/auth/login' && req.method() === 'POST') return guardedFetch(route, req, url);
    // In-memory refresh bootstrap is disclosed as API_LOGIN_SESSION_BOOTSTRAP.
    if (url.origin === origin && url.pathname === '/api/v1/auth/refresh' && req.method() === 'POST') {
      if (realLogin) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...session, tokenType: 'Bearer' }) });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      attempts.push({ method: req.method(), path: url.pathname.startsWith('/api/') ? url.pathname : 'non-api' });
      return route.abort('blockedbyclient');
    }
    // Never send API credentials or protection headers to another origin.
    if (url.origin !== origin && (req.headers().authorization || Object.keys(req.headers()).some((key) => key.startsWith('x-vercel-')))) {
      attempts.push({ method: req.method(), path: 'cross-origin-credential' }); return route.abort('blockedbyclient');
    }
    return guardedFetch(route, req, url);
  });
  return attempts;
}
module.exports = { RoleSessions, preflightAccounts, readRoleApi, installReadonlyBrowser };
