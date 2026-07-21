const crypto = require('node:crypto');
const env = require('../config/env');
const HttpError = require('../utils/http-error');

const refreshCookiePath = '/api/v1/auth';
const csrfCookiePath = '/';
// Retain the former export for callers that refer to the refresh-cookie path.
const cookiePath = refreshCookiePath;
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value || '')]));
}
function isBrowser(req) { return (req.get('x-client-type') || req.body?.clientType || 'browser') === 'browser'; }
function baseCookieOptions() {
  return { secure: env.cookieSecure, sameSite: env.cookieSameSite, ...(env.cookieDomain && { domain: env.cookieDomain }) };
}
function refreshCookieOptions() {
  return { ...baseCookieOptions(), httpOnly: true, path: refreshCookiePath };
}
function csrfCookieOptions() {
  // The browser must be able to read this non-sensitive value from application routes.
  return { ...baseCookieOptions(), httpOnly: false, path: csrfCookiePath };
}
function setBrowserSession(res, refreshToken) {
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  res.cookie(env.authCookieName, refreshToken, { ...refreshCookieOptions(), maxAge: env.refreshTokenExpiresDays * 86400000 });
  res.cookie(env.csrfCookieName, csrfToken, { ...csrfCookieOptions(), maxAge: env.refreshTokenExpiresDays * 86400000 });
}
function clearBrowserSession(res) {
  res.clearCookie(env.authCookieName, refreshCookieOptions());
  res.clearCookie(env.csrfCookieName, csrfCookieOptions());
}
function csrfProtection(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = req.get('x-csrf-token');
  const cookieToken = cookies[env.csrfCookieName];
  if (!token || !cookieToken || token.length !== cookieToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(cookieToken))) return next(new HttpError(403, 'CSRF validation failed.'));
  return next();
}
module.exports = { parseCookies, isBrowser, setBrowserSession, clearBrowserSession, csrfProtection, cookiePath, refreshCookiePath, csrfCookiePath };
