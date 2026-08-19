const express = require('express');
const { z } = require('zod');
const auth = require('../services/auth.service');
const { createOtpService } = require('../services/email-otp.service');
const loginRateLimit = require('../middlewares/login-rate-limit');
const passkeyRateLimit = require('../middlewares/passkey-rate-limit');
const { createWebAuthnService } = require('../services/webauthn.service');
const env = require('../config/env');
const { authenticate } = require('../middlewares/authenticate');
const { parseCookies, isBrowser, setBrowserSession, clearBrowserSession, csrfProtection } = require('../middlewares/browser-session');

const router = express.Router();
const clientType = z.enum(['browser', 'mobile']).default('browser');
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1), clientType: clientType.optional() });
const refreshSchema = z.object({ refreshToken: z.string().min(40).max(500).optional(), clientType: clientType.optional() });
const requestDetails = (req) => ({ userAgent: req.get('user-agent'), ipAddress: req.ip });
const otp = createOtpService();
const webAuthn = createWebAuthnService();
const passkeyResponseSchema = z.record(z.unknown());
const passkeyChallengeSchema = z.object({ challengeId: z.string().uuid(), response: passkeyResponseSchema }).strict();
const passkeyRegistrationOptionsSchema = z.object({ currentPassword: z.string().min(1).max(128), displayName: z.string().trim().min(1).max(120).default('Passkey') }).strict();
const passkeyRegistrationVerifySchema = passkeyChallengeSchema.extend({ displayName: z.string().trim().min(1).max(120).default('Passkey') }).strict();
const passkeyRenameSchema = z.object({ displayName: z.string().trim().min(1).max(120) }).strict();
const passkeyRevokeSchema = z.object({ currentPassword: z.string().min(1).max(128) }).strict();
const registrationRequestSchema = z.object({ submittedName: z.string().trim().min(2).max(200), email: z.string().email().max(255), password: z.string().min(8).max(128), departmentHint: z.string().trim().max(100).optional().nullable() }).strict();
const registrationVerifySchema = z.object({ email: z.string().email().max(255), code: z.string().regex(/^\d{6}$/) }).strict();
const passwordResetRequestSchema = z.object({ email: z.string().email().max(255) });
const passwordResetCompleteSchema = z.object({ email: z.string().email().max(255), code: z.string().regex(/^\d{6}$/), newPassword: z.string().min(8).max(128) });
function browserResponse(tokens, user) { return { accessToken: tokens.accessToken, tokenType: tokens.tokenType, user: user || tokens.user }; }
function getRefreshToken(req) { return parseCookies(req.headers.cookie)[require('../config/env').authCookieName]; }

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const { email, password, clientType: requestedClient = 'browser' } = loginSchema.parse(req.body);
    const result = await auth.login(email, password, req.requestId, requestDetails(req));
    if (requestedClient === 'browser') { setBrowserSession(res, result.refreshToken); return res.json(browserResponse(result, result.user)); }
    return res.json(result);
  } catch (error) { return next(error); }
});
router.get('/passkeys/config', (_req, res) => res.json({ enabled: Boolean(env.webAuthnEnabled) }));
router.post('/passkeys/login/options', passkeyRateLimit, async (req, res, next) => {
  try { res.json(await webAuthn.authenticationOptions()); } catch (error) { next(error); }
});
router.post('/passkeys/login/verify', passkeyRateLimit, async (req, res, next) => {
  try {
    const { challengeId, response } = passkeyChallengeSchema.parse(req.body);
    const result = await webAuthn.verifyAuthentication({ challengeId, response, requestId: req.requestId, request: requestDetails(req) });
    if (isBrowser(req)) { setBrowserSession(res, result.refreshToken); return res.json(browserResponse(result, result.user)); }
    return res.json(result);
  } catch (error) { return next(error); }
});
router.get('/passkeys', authenticate, async (req, res, next) => {
  try { res.json({ data: await webAuthn.listCredentials(req.user.sub) }); } catch (error) { next(error); }
});
router.post('/passkeys/register/options', authenticate, async (req, res, next) => {
  try {
    const input = passkeyRegistrationOptionsSchema.parse(req.body);
    res.json(await webAuthn.registrationOptions({ userId: req.user.sub, ...input }));
  } catch (error) { next(error); }
});
router.post('/passkeys/register/verify', authenticate, async (req, res, next) => {
  try {
    const input = passkeyRegistrationVerifySchema.parse(req.body);
    res.status(201).json({ data: await webAuthn.verifyRegistration({ userId: req.user.sub, ...input }) });
  } catch (error) { next(error); }
});
router.patch('/passkeys/:id', authenticate, async (req, res, next) => {
  try { res.json({ data: await webAuthn.renameCredential({ userId: req.user.sub, credentialId: z.string().uuid().parse(req.params.id), ...passkeyRenameSchema.parse(req.body) }) }); } catch (error) { next(error); }
});
router.delete('/passkeys/:id', authenticate, async (req, res, next) => {
  try { res.json({ data: await webAuthn.revokeCredential({ userId: req.user.sub, credentialId: z.string().uuid().parse(req.params.id), ...passkeyRevokeSchema.parse(req.body) }) }); } catch (error) { next(error); }
});
router.post('/register/request-otp', async (req, res, next) => {
  try { res.status(202).json(await otp.requestRegistration(registrationRequestSchema.parse(req.body))); } catch (error) { next(error); }
});
router.post('/register/verify-otp', async (req, res, next) => {
  try { res.json(await otp.verifyRegistration(registrationVerifySchema.parse(req.body))); } catch (error) { next(error); }
});
router.post('/password-reset/request-otp', async (req, res, next) => {
  try { res.status(202).json(await otp.requestPasswordReset(passwordResetRequestSchema.parse(req.body))); } catch (error) { next(error); }
});
router.post('/password-reset/complete', async (req, res, next) => {
  try { res.json(await otp.completePasswordReset(passwordResetCompleteSchema.parse(req.body))); } catch (error) { next(error); }
});
router.post('/refresh', (req, res, next) => isBrowser(req) ? csrfProtection(req, res, next) : next(), async (req, res, next) => {
  try {
    const { refreshToken, clientType: requestedClient = 'browser' } = refreshSchema.parse(req.body);
    const result = await auth.refresh(requestedClient === 'browser' ? getRefreshToken(req) : refreshToken, req.requestId, requestDetails(req));
    if (requestedClient === 'browser') { setBrowserSession(res, result.refreshToken); return res.json(browserResponse(result, result.user)); }
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
