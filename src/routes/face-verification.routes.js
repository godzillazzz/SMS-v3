'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../middlewares/authenticate');
const HttpError = require('../utils/http-error');
const { createFaceVerificationSessionService } = require('../services/face-verification-session.service');
const { createFaceVerificationPocService } = require('../services/face-verification-poc.service');

const router = express.Router();
const sessionService = createFaceVerificationSessionService();
const pocService = createFaceVerificationPocService({ sessionService });
const uuid = z.string().uuid();
const digest = z.string().regex(/^[0-9a-fA-F]{64}$/);
const createInput = z.object({ purpose: z.enum(['ATTENDANCE_EVENT', 'PATROL_EVENT']), contextDigest: digest }).strict();
const deviceProofInput = z.object({ challengeId: uuid, challenge: z.string().min(16).max(512), signatureBase64: z.string().min(16).max(4096) }).strict();
const providerResultInput = z.object({ providerSessionId: z.string().trim().min(8).max(2048) }).strict();

function pocApiEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return false;
  if (environment.NODE_ENV === 'test') return true;
  return environment.VERCEL_ENV === 'preview' && environment.FACE_VERIFICATION_POC_API_ENABLED === 'true';
}

function requirePreviewPoc(_req, _res, next) {
  return pocApiEnabled() ? next() : next(new HttpError(404, 'Not found.'));
}

router.use(requirePreviewPoc, authenticate);
router.get('/poc-config', (_req, res) => { res.json({ data: pocService.getPocConfig() }); });
router.post('/sessions', async (req, res, next) => {
  try { res.status(201).json({ data: await sessionService.createSession({ actor: req.user, ...createInput.parse(req.body) }) }); } catch (error) { next(error); }
});
router.post('/sessions/:id/device-proof', async (req, res, next) => {
  try { res.json({ data: await sessionService.verifyDeviceProof({ actor: req.user, sessionId: uuid.parse(req.params.id), ...deviceProofInput.parse(req.body) }) }); } catch (error) { next(error); }
});
router.post('/sessions/:id/provider-session', async (req, res, next) => {
  try { res.status(201).json({ data: await pocService.createProviderSession({ actor: req.user, sessionId: uuid.parse(req.params.id) }) }); } catch (error) { next(error); }
});
router.post('/sessions/:id/provider-result', async (req, res, next) => {
  try { const input = providerResultInput.parse(req.body); res.json({ data: await pocService.completeProviderSession({ actor: req.user, sessionId: uuid.parse(req.params.id), providerSessionId: input.providerSessionId }) }); } catch (error) { next(error); }
});

module.exports = { router, pocApiEnabled };
