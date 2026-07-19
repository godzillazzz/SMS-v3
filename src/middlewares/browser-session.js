const crypto = require('node:crypto');
const env = require('../config/env');
const HttpError = require('../utils/http-error');

const cookiePath = '/api/v1/auth';
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value || '')]));
}
function isBrowser(req) { return (req.get('x-client-type') || req.body?.clientType || 'browser') === 'browser'; }
function cookieOptions(httpOnly) {
  return { httpOnly, secure: env.cookieSecure, sameSite: env.cookieSameSite, path: cookiePath, ...(env.cookieDomain && { domain: env.cookieDomain }) };
}
function setBrowserSession(res, refreshToken) {
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  res.cookie(env.authCookieName, refreshToken, { ...cookieOptions(true), maxAge: env.refreshTokenExpiresDays * 86400000 });
  res.cookie(env.csrfCookieName, csrfToken, { ...cookieOptions(false), maxAge: env.refreshTokenExpiresDays * 86400000 });
}
function clearBrowserSession(res) {
  res.clearCookie(env.authCookieName, cookieOptions(true));
  res.clearCookie(env.csrfCookieName, cookieOptions(false));
}
function csrfProtection(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = req.get('x-csrf-token');
  const cookieToken = cookies[env.csrfCookieName];
  if (!token || !cookieToken || token.length !== cookieToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(cookieToken))) return next(new HttpError(403, 'CSRF validation failed.'));
  return next();
}
module.exports = { parseCookies, isBrowser, setBrowserSession, clearBrowserSession, csrfProtection, cookiePath };
