'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { authenticate } = require('../middlewares/authenticate');
const HttpError = require('../utils/http-error');
const { createFaceVerificationSessionService } = require('../services/face-verification-session.service');
const { createSelfHostedFaceVerificationService } = require('../services/face-verification-self-hosted.service');
const { MAX_LIVE_PHOTO_SIZE, PROVIDER_NAME, VERIFICATION_MODE } = require('../services/self-hosted-face-match.provider');

const uuid = z.string().uuid();
const digest = z.string().regex(/^[0-9a-fA-F]{64}$/);
const createInput = z.object({ purpose: z.enum(['ATTENDANCE_EVENT', 'PATROL_EVENT']), contextDigest: digest }).strict();
const deviceProofInput = z.object({ challengeId: uuid, challenge: z.string().min(16).max(512), signatureBase64: z.string().min(16).max(4096) }).strict();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_LIVE_PHOTO_SIZE } });

function selfHostedFaceApiEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return false;
  if (environment.NODE_ENV === 'test') return true;
  return environment.VERCEL_ENV === 'preview' && environment.FACE_VERIFICATION_SELF_HOSTED_API_ENABLED === 'true';
}

function createSelfHostedFaceVerificationRoutes({
  environment = process.env,
  authenticateMiddleware = authenticate,
  sessionService = null,
  verificationService = null
} = {}) {
  const router = express.Router();
  const sessions = sessionService || createFaceVerificationSessionService();
  const verifier = verificationService || createSelfHostedFaceVerificationService({ sessionService: sessions });

  function requirePreviewSelfHosted(_req, _res, next) {
    return selfHostedFaceApiEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
  }

  router.use(requirePreviewSelfHosted, authenticateMiddleware);
  router.get('/config', (_req, res) => {
    res.json({ data: { provider: PROVIDER_NAME, verificationMode: VERIFICATION_MODE, storesLivePhoto: false } });
  });
  router.post('/sessions', async (req, res, next) => {
    try { res.status(201).json({ data: await sessions.createSession({ actor: req.user, ...createInput.parse(req.body) }) }); } catch (error) { next(error); }
  });
  router.post('/sessions/:id/device-proof', async (req, res, next) => {
    try { res.json({ data: await sessions.verifyDeviceProof({ actor: req.user, sessionId: uuid.parse(req.params.id), ...deviceProofInput.parse(req.body) }) }); } catch (error) { next(error); }
  });
  router.post('/sessions/:id/match', upload.single('photo'), async (req, res, next) => {
    try {
      res.json({ data: await verifier.verifyFaceMatch({ actor: req.user, sessionId: uuid.parse(req.params.id), livePhotoFile: req.file }) });
    } catch (error) { next(error); }
  });
  return router;
}

const router = createSelfHostedFaceVerificationRoutes();

module.exports = {
  router,
  selfHostedFaceApiEnabled,
  createSelfHostedFaceVerificationRoutes
};
