'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const HttpError = require('../utils/http-error');
const { createAttendanceApiContractService } = require('../services/attendance-api-contract.service');
const { createAttendanceFaceVerificationService } = require('../services/attendance-face-verification.service');
const { ACTIVE_FACE_CHALLENGE_FRAME_COUNT } = require('../services/active-face-challenge.service');
const { createAttendanceFaceChallengeUatService } = require('../services/attendance-face-challenge-uat.service');
const { createAttendanceFaceEngineUatService } = require('../services/attendance-face-engine-uat.service');
const { inProcessFaceConfig } = require('../services/in-process-face-match.provider');
const { validateAttachment, ATTACHMENT_PROFILES } = require('../services/attachment-optimizer.service');

const uuid = z.string().uuid();
const decimal = z.union([z.number().finite(), z.string().trim().regex(/^-?\d+(?:\.\d+)?$/).max(32)]);
const locationInput = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().positive(),
  capturedAt: z.string().datetime({ offset: true })
}).strict();
const attendanceEvidenceInput = z.object({ qrToken: z.string().trim().min(24).max(512).optional(), location: locationInput }).strict();
const prepareInput = z.object({ captureId: uuid, attendanceEvidence: attendanceEvidenceInput }).strict();
const contextLocationInput = z.object({ latitude: decimal, longitude: decimal, accuracyMeters: decimal, capturedAt: z.string().datetime({ offset: true }) }).strict();
const attendanceContextInput = z.object({
  captureId: uuid,
  eventIntent: z.enum(['CHECK_IN', 'CHECK_OUT']),
  shiftAssignmentId: uuid,
  evidence: z.object({ siteId: uuid, qrMode: z.enum(['GPS_ASSURED', 'STEP_UP_QR']), qrCredentialId: uuid.nullable(), location: contextLocationInput }).strict()
}).strict();
const acceptInput = z.object({ receipt: z.string().trim().min(32).max(512), attendanceContext: attendanceContextInput }).strict();
const deviceProofInput = z.object({ challengeId: uuid, challenge: z.string().min(16).max(512), signatureBase64: z.string().min(16).max(4096) }).strict();
const livePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { files: 1 + ACTIVE_FACE_CHALLENGE_FRAME_COUNT, fields: 0, parts: 2 + ACTIVE_FACE_CHALLENGE_FRAME_COUNT, fileSize: ATTACHMENT_PROFILES.ATTENDANCE_FACE.imageHardLimitBytes } }).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'challengeFrame', maxCount: ACTIVE_FACE_CHALLENGE_FRAME_COUNT }
]);

function faceCaptureUpload(req, res, next) {
  livePhotoUpload(req, res, async (error) => {
    if (error) return next(new HttpError(400, 'Invalid face capture upload.', { code: 'ATTENDANCE_FACE_INPUT_INVALID' }));
    try {
      const files = Object.values(req.files || {}).flat();
      for (const file of files) await validateAttachment(file, 'ATTENDANCE_FACE');
      return next();
    } catch (validationError) { return next(validationError); }
  });
}

function attendanceApiEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return environment.ATTENDANCE_API_PRODUCTION_ENABLED === 'true';
  return environment.VERCEL_ENV === 'preview' && environment.ATTENDANCE_API_PREVIEW_ENABLED === 'true';
}

function selfHostedFaceRuntimeConfigured(environment = process.env) {
  if (environment.FACE_VERIFICATION_SELF_HOSTED_API_ENABLED !== 'true') return false;
  const token = String(environment.FACE_VERIFIER_SHARED_TOKEN || '').trim();
  if (token.length < 16) return false;
  try { return new URL(String(environment.FACE_VERIFIER_URL || '')).protocol === 'https:'; } catch { return false; }
}

function inProcessFaceRuntimeConfigured(environment = process.env) {
  if (environment.FACE_VERIFICATION_IN_PROCESS_ENABLED !== 'true') return false;
  try { inProcessFaceConfig(environment); return true; } catch { return false; }
}

function attendanceBiometricRuntimeEnabled(environment = process.env) {
  if (!attendanceApiEnabled(environment)) return false;
  return inProcessFaceRuntimeConfigured(environment) || selfHostedFaceRuntimeConfigured(environment);
}

function attendanceFaceChallengeUatEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return false;
  return environment.VERCEL_ENV === 'preview' && environment.G06_FACE_CHALLENGE_UAT_PREVIEW_ENABLED === 'true';
}

function attendanceFaceEngineUatEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return false;
  return environment.VERCEL_ENV === 'preview'
    && environment.G06_FACE_ENGINE_UAT_PREVIEW_ENABLED === 'true'
    && inProcessFaceRuntimeConfigured(environment);
}

function defaultAuthenticate(req, res, next) {
  return require('../middlewares/authenticate').authenticate(req, res, next);
}

function createAttendanceRoutes({ environment = process.env, authenticateMiddleware = defaultAuthenticate, contractService = null, faceChallengeUatService = null, faceEngineUatService = null } = {}) {
  const router = express.Router();
  const service = contractService || createAttendanceApiContractService({
    faceVerificationService: createAttendanceFaceVerificationService({ environment }),
    isBiometricRuntimeEnabled: () => attendanceBiometricRuntimeEnabled(environment)
  });
  const uatService = faceChallengeUatService || createAttendanceFaceChallengeUatService();
  const engineUatService = faceEngineUatService || createAttendanceFaceEngineUatService({ environment });

  function requirePreviewAttendance(_req, _res, next) {
    return attendanceApiEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
  }

  function requireFaceChallengeUat(_req, _res, next) {
    return attendanceFaceChallengeUatEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
  }

  function requireFaceEngineUat(_req, _res, next) {
    return attendanceFaceEngineUatEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
  }

  router.post('/uat/face-challenge/start', requireFaceChallengeUat, authenticateMiddleware, async (req, res, next) => {
    try { z.object({}).strict().parse(req.body || {}); res.status(201).json({ data: uatService.start() }); } catch (error) { next(error); }
  });

  router.post('/uat/face-challenge/:id/capture', requireFaceChallengeUat, authenticateMiddleware, faceCaptureUpload, async (req, res, next) => {
    try {
      if (Object.keys(req.body || {}).length !== 0) throw new HttpError(400, 'Unexpected UAT capture fields.', { code: 'FACE_CHALLENGE_UAT_CAPTURE_INVALID' });
      const photoFiles = Array.isArray(req.files?.photo) ? req.files.photo : [];
      const challengeFrameFiles = Array.isArray(req.files?.challengeFrame) ? req.files.challengeFrame : [];
      if (photoFiles.length !== 1 || challengeFrameFiles.length !== ACTIVE_FACE_CHALLENGE_FRAME_COUNT) throw new HttpError(400, 'UAT face capture is incomplete.', { code: 'FACE_CHALLENGE_UAT_CAPTURE_INVALID' });
      res.json({ data: uatService.acceptCapture({ attemptId: uuid.parse(req.params.id), livePhotoFile: photoFiles[0], challengeFrameFiles }) });
    } catch (error) { next(error); }
  });

  router.post('/uat/in-process-face-engine/probe', requireFaceEngineUat, faceCaptureUpload, async (req, res, next) => {
    try {
      if (Object.keys(req.body || {}).length !== 0) throw new HttpError(400, 'Unexpected face-engine UAT fields.', { code: 'FACE_ENGINE_UAT_INPUT_INVALID' });
      const photoFiles = Array.isArray(req.files?.photo) ? req.files.photo : [];
      const challengeFrameFiles = Array.isArray(req.files?.challengeFrame) ? req.files.challengeFrame : [];
      if (photoFiles.length !== 1 || challengeFrameFiles.length !== 0) throw new HttpError(400, 'Face-engine UAT image is invalid.', { code: 'FACE_ENGINE_UAT_INPUT_INVALID' });
      res.json({ data: await engineUatService.probe({ photoFile: photoFiles[0] }) });
    } catch (error) { next(error); }
  });

  router.use(requirePreviewAttendance, authenticateMiddleware);

  router.post('/readiness', async (req, res, next) => {
    try { const input = prepareInput.parse(req.body); res.json({ data: await service.assessReadiness({ actor: req.user, ...input }) }); } catch (error) { next(error); }
  });

  router.post('/verification/start', async (req, res, next) => {
    try { const input = prepareInput.parse(req.body); res.status(201).json({ data: await service.beginVerification({ actor: req.user, ...input }) }); } catch (error) { next(error); }
  });

  router.post('/verification/:id/device-proof', async (req, res, next) => {
    try { const input = deviceProofInput.parse(req.body); res.json({ data: await service.verifyDeviceProof({ actor: req.user, sessionId: uuid.parse(req.params.id), ...input }) }); } catch (error) { next(error); }
  });

  router.post('/verification/:id/face-match', faceCaptureUpload, async (req, res, next) => {
    try {
      if (Object.keys(req.body || {}).length !== 0) throw new HttpError(400, 'Unexpected face-verification fields.', { code: 'ATTENDANCE_FACE_INPUT_INVALID' });
      const photoFiles = Array.isArray(req.files?.photo) ? req.files.photo : [];
      const challengeFrameFiles = Array.isArray(req.files?.challengeFrame) ? req.files.challengeFrame : [];
      if (photoFiles.length !== 1 || challengeFrameFiles.length !== ACTIVE_FACE_CHALLENGE_FRAME_COUNT) throw new HttpError(400, 'Live face capture is incomplete.', { code: 'ACTIVE_CHALLENGE_FRAMES_INVALID' });
      res.json({ data: await service.verifyLiveFace({ actor: req.user, sessionId: uuid.parse(req.params.id), livePhotoFile: photoFiles[0], challengeFrameFiles }) });
    } catch (error) { next(error); }
  });

  router.post('/events', async (req, res, next) => {
    try { const input = acceptInput.parse(req.body); res.json({ data: await service.acceptVerifiedEvent({ actor: req.user, ...input }) }); } catch (error) { next(error); }
  });

  return router;
}

const router = createAttendanceRoutes();

module.exports = {
  router,
  attendanceApiEnabled,
  selfHostedFaceRuntimeConfigured,
  inProcessFaceRuntimeConfigured,
  attendanceBiometricRuntimeEnabled,
  attendanceFaceChallengeUatEnabled,
  attendanceFaceEngineUatEnabled,
  createAttendanceRoutes,
  prepareInput,
  deviceProofInput,
  acceptInput
};
