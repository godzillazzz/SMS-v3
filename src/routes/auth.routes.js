const express = require('express');
const { z } = require('zod');
const auth = require('../services/auth.service');
const loginRateLimit = require('../middlewares/login-rate-limit');
const { authenticate } = require('../middlewares/authenticate');
const { parseCookies, isBrowser, setBrowserSession, clearBrowserSession, csrfProtection } = require('../middlewares/browser-session');

const router = express.Router();
const clientType = z.enum(['browser', 'mobile']).default('browser');
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1), clientType: clientType.optional() });
const refreshSchema = z.object({ refreshToken: z.string().min(40).max(500).optional(), clientType: clientType.optional() });
const requestDetails = (req) => ({ userAgent: req.get('user-agent'), ipAddress: req.ip });
function browserResponse(tokens, user) { return { accessToken: tokens.accessToken, tokenType: tokens.tokenType, user }; }
function getRefreshToken(req) { return parseCookies(req.headers.cookie)[require('../config/env').authCookieName]; }

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const { email, password, clientType: requestedClient = 'browser' } = loginSchema.parse(req.body);
    const result = await auth.login(email, password, req.requestId, requestDetails(req));
    if (requestedClient === 'browser') { setBrowserSession(res, result.refreshToken); return res.json(browserResponse(result, result.user)); }
    return res.json(result);
  } catch (error) { return next(error); }
});
router.post('/refresh', (req, res, next) => isBrowser(req) ? csrfProtection(req, res, next) : next(), async (req, res, next) => {
  try {
    const { refreshToken, clientType: requestedClient = 'browser' } = refreshSchema.parse(req.body);
    const result = await auth.refresh(requestedClient === 'browser' ? getRefreshToken(req) : refreshToken, req.requestId, requestDetails(req));
    if (requestedClient === 'browser') { setBrowserSession(res, result.refreshToken); return res.json(browserResponse(result)); }
    return res.json(result);
  } catch (error) { return next(error); }
});
router.post('/logout', (req, res, next) => isBrowser(req) ? csrfProtection(req, res, next) : next(), async (req, res, next) => {
  try {
    const { refreshToken, clientType: requestedClient = 'browser' } = refreshSchema.parse(req.body);
    await auth.logout(requestedClient === 'browser' ? getRefreshToken(req) : refreshToken, req.requestId);
    if (requestedClient === 'browser') clearBrowserSession(res);
    return res.status(204).send();
  } catch (error) { return next(error); }
});
router.post('/logout-all', authenticate, (req, res, next) => isBrowser(req) ? csrfProtection(req, res, next) : next(), async (req, res, next) => {
  try { await auth.logoutAll(req.user.sub, req.requestId); if (isBrowser(req)) clearBrowserSession(res); return res.status(204).send(); } catch (error) { return next(error); }
});
module.exports = router;
