const express = require('express');
const { z } = require('zod');
const auth = require('../services/auth.service');
const loginRateLimit = require('../middlewares/login-rate-limit');

const router = express.Router();
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(40).max(500) });
const requestDetails = (req) => ({ userAgent: req.get('user-agent'), ipAddress: req.ip });

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    res.json(await auth.login(email, password, req.requestId, requestDetails(req)));
  } catch (error) { next(error); }
});
router.post('/refresh', async (req, res, next) => { try { const { refreshToken } = refreshSchema.parse(req.body); res.json(await auth.refresh(refreshToken, req.requestId, requestDetails(req))); } catch (error) { next(error); } });
router.post('/logout', async (req, res, next) => { try { const { refreshToken } = refreshSchema.parse(req.body); await auth.logout(refreshToken, req.requestId); res.status(204).send(); } catch (error) { next(error); } });
router.post('/logout-all', require('../middlewares/authenticate').authenticate, async (req, res, next) => { try { await auth.logoutAll(req.user.sub, req.requestId); res.status(204).send(); } catch (error) { next(error); } });

module.exports = router;
