'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { authenticate } = require('../middlewares/authenticate');
const HttpError = require('../utils/http-error');
const { createFaceVerificationSessionService } = require('../services/face-verification-session.service');
const { createSelfHostedFaceVerificationService } = require('../services/face-verification-self-hosted.service');
const { MAX_CHALLENGE_FRAME_SIZE, PROVIDER_NAME, VERIFICATION_MODE } = require('../services/self-hosted-face-match.provider');
const { ACTIVE_FACE_CHALLENGE_VERSION, ACTIVE_FACE_CHALLENGE_FRAME_COUNT } = require('../services/active-face-challenge.service');

const uuid = z.string().uuid();
const digest = z.string().regex(/^[0-9a-fA-F]{64}$/);
const createInput = z.object({ purpose: z.enum(['ATTENDANCE_EVENT', 'PATROL_EVENT']), contextDigest: digest }).strict();
const deviceProofInput = z.object({ challengeId: uuid, challenge: z.string().min(16).max(512), signatureBase64: z.string().min(16).max(4096) }).strict();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1 + ACTIVE_FACE_CHALLENGE_FRAME_COUNT, fields: 0, parts: 2 + ACTIVE_FACE_CHALLENGE_FRAME_COUNT, fileSize: MAX_CHALLENGE_FRAME_SIZE } }).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'challengeFrame', maxCount: ACTIVE_FACE_CHALLENGE_FRAME_COUNT }
]);

function faceCaptureUpload(req, res, next) {
  upload(req, res, (error) => {
    if (error) return next(new HttpError(400, 'Invalid face capture upload.', { code: 'FACE_VERIFICATION_INPUT_INVALID' }));
    return next();
  });
}

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
    res.json({ data: { provider: PROVIDER_NAME, verificationMode: VERIFICATION_MODE, storesLivePhoto: false, activeChallengeVersion: ACTIVE_FACE_CHALLENGE_VERSION } });
  });
  router.post('/sessions', async (req, res, next) => {
    try { res.status(201).json({ data: await sessions.createSession({ actor: req.user, ...createInput.parse(req.body) }) }); } catch (error) { next(error); }
  });
  router.post('/sessions/:id/device-proof', async (req, res, next) => {
    try { res.json({ data: await sessions.verifyDeviceProof({ actor: req.user, sessionId: uuid.parse(req.params.id), ...deviceProofInput.parse(req.body) }) }); } catch (error) { next(error); }
  });
  router.post('/sessions/:id/match', faceCaptureUpload, async (req, res, next) => {
    try {
      if (Object.keys(req.body || {}).length !== 0) throw new HttpError(400, 'Unexpected face-verification fields.', { code: 'FACE_VERIFICATION_INPUT_INVALID' });
      const photoFiles = Array.isArray(req.files?.photo) ? req.files.photo : [];
      const challengeFrameFiles = Array.isArray(req.files?.challengeFrame) ? req.files.challengeFrame : [];
      if (photoFiles.length !== 1 || challengeFrameFiles.length !== ACTIVE_FACE_CHALLENGE_FRAME_COUNT) {
        throw new HttpError(400, 'Live face capture is incomplete.', { code: 'ACTIVE_CHALLENGE_FRAMES_INVALID' });
      }
      res.json({ data: await verifier.verifyFaceMatch({ actor: req.user, sessionId: uuid.parse(req.params.id), livePhotoFile: photoFiles[0], challengeFrameFiles }) });
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
