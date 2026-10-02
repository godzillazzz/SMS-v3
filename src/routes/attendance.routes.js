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
const { createAttendanceSelfService } = require('../services/attendance-self.service');
const { createAttendanceSimpleService } = require('../services/attendance-simple.service');
const { createSupabaseAttendanceFaceEvidenceStorage } = require('../services/attendance-face-evidence-storage.service');
const { authorize } = require('../middlewares/authenticate');

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
const attendanceContextEvidenceInput = z.object({
  siteId: uuid,
  expectedSiteId: uuid,
  actualSiteId: uuid,
  qrMode: z.enum(['GPS_ASSURED', 'STEP_UP_QR']),
  qrCredentialId: uuid.nullable(),
  geofenceClassification: z.enum(['CONFIDENT_INSIDE', 'BORDERLINE']).optional(),
  riskFlags: z.array(z.enum(['ASSIST_OTHER_SITE', 'LOCATION_RISK'])).max(2),
  location: contextLocationInput
}).strict().superRefine((evidence, context) => {
  if (evidence.siteId !== evidence.expectedSiteId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedSiteId'], message: 'Expected Site must match the server-issued Site authority.' });
  }
  if (new Set(evidence.riskFlags).size !== evidence.riskFlags.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['riskFlags'], message: 'Attendance Site risk flags must be unique.' });
  }
  const assistingOtherSite = evidence.expectedSiteId !== evidence.actualSiteId;
  const hasAssistFlag = evidence.riskFlags.includes('ASSIST_OTHER_SITE');
  if (assistingOtherSite !== hasAssistFlag) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['riskFlags'], message: 'Attendance Site risk flags do not match the server-issued Site pair.' });
  }
  const classification = evidence.geofenceClassification || 'CONFIDENT_INSIDE';
  const hasLocationRisk = evidence.riskFlags.includes('LOCATION_RISK');
  if ((classification === 'BORDERLINE') !== hasLocationRisk) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['riskFlags'], message: 'Attendance location risk flag does not match the server-issued geofence classification.' });
  }
});
const attendanceContextInput = z.object({
  captureId: uuid,
  eventIntent: z.enum(['CHECK_IN', 'CHECK_OUT']),
  shiftAssignmentId: uuid,
  evidence: attendanceContextEvidenceInput
}).strict();
const acceptInput = z.object({ receipt: z.string().trim().min(32).max(2048), attendanceContext: attendanceContextInput }).strict();
const geofenceOnlyUatReceiptInput = z.object({ attendanceContext: attendanceContextInput }).strict();
const deviceProofInput = z.object({ challengeId: uuid, challenge: z.string().min(16).max(512), signatureBase64: z.string().min(16).max(4096) }).strict();
const selfHistoryQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
}).strict();
const selfScheduleQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).strict();
const simpleDeviceSignalsInput = z.object({
  standalone: z.boolean().optional(),
  secureContext: z.boolean(),
  serviceWorkerControlled: z.boolean().optional(),
  webCrypto: z.boolean(),
  indexedDb: z.boolean(),
  privateKeyNonExportable: z.boolean(),
  automation: z.boolean().optional(),
  integrityWarnings: z.array(z.string().trim().min(1).max(80)).max(10).optional()
}).strict();
const simpleDeviceInput = z.object({
  publicKeySpkiBase64: z.string().min(16).max(8192),
  keyAlgorithm: z.literal('ECDSA_P256_SHA256'),
  displayName: z.string().trim().min(1).max(120).optional(),
  platformHint: z.string().trim().max(100).nullable().optional(),
  signals: simpleDeviceSignalsInput,
  signatureBase64: z.string().min(16).max(4096)
}).strict();
const simpleEventInput = z.object({
  captureId: uuid,
  eventIntent: z.enum(['CHECK_IN', 'CHECK_OUT']),
  shiftAssignmentId: uuid,
  capturedAt: z.string().datetime({ offset: true }),
  location: locationInput,
  device: simpleDeviceInput,
  offlineBundle: z.string().trim().min(32).max(900000).nullable().optional()
}).strict();
const simpleMoveInput = z.object({
  requestId: uuid,
  publicKeySpkiBase64: z.string().min(16).max(8192),
  keyAlgorithm: z.literal('ECDSA_P256_SHA256'),
  signatureBase64: z.string().min(16).max(4096),
  displayName: z.string().trim().min(1).max(120).optional(),
  platformHint: z.string().trim().max(100).nullable().optional(),
  reason: z.string().trim().min(3).max(1000)
}).strict();
const simplePendingReviewInput = z.object({ comment: z.string().trim().min(3).max(1000) }).strict();
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

function attendanceGeofenceOnlyUatEnabled(environment = process.env) {
  return environment.VERCEL_ENV === 'production'
    && attendanceApiEnabled(environment)
    && environment.G06_GEOFENCE_ONLY_UAT_ENABLED === 'true';
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

function createAttendanceRoutes({ environment = process.env, authenticateMiddleware = defaultAuthenticate, contractService = null, faceChallengeUatService = null, faceEngineUatService = null, selfService = null, simpleService = null, evidenceStorage = null } = {}) {
  const router = express.Router();
  const privateEvidence = evidenceStorage || createSupabaseAttendanceFaceEvidenceStorage({ environment });
  const service = contractService || createAttendanceApiContractService({
    faceVerificationService: createAttendanceFaceVerificationService({ environment }),
    isBiometricRuntimeEnabled: () => attendanceBiometricRuntimeEnabled(environment),
    isGeofenceOnlyUatEnabled: () => attendanceGeofenceOnlyUatEnabled(environment)
  });
  const uatService = faceChallengeUatService || createAttendanceFaceChallengeUatService();
  const engineUatService = faceEngineUatService || createAttendanceFaceEngineUatService({ environment });
  const employeeSelf = selfService || createAttendanceSelfService();
  const simpleAttendance = simpleService || createAttendanceSimpleService();

  function requirePreviewAttendance(_req, _res, next) {
    return attendanceApiEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
  }

  function requireFaceChallengeUat(_req, _res, next) {
    return attendanceFaceChallengeUatEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
  }

  function requireFaceEngineUat(_req, _res, next) {
    return attendanceFaceEngineUatEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
  }

  function requireGeofenceOnlyUat(_req, _res, next) {
    return attendanceGeofenceOnlyUatEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
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

  router.get('/simple/bootstrap', async (req, res, next) => {
    try { res.json({ data: await simpleAttendance.bootstrap({ actor: req.user }) }); } catch (error) { next(error); }
  });

  router.post('/simple/events', async (req, res, next) => {
    try {
      const input = simpleEventInput.parse(req.body);
      res.status(201).json({ data: await simpleAttendance.submit({ actor: req.user, input, requestUserAgent: req.headers['user-agent'] || null }) });
    } catch (error) { next(error); }
  });

  router.post('/simple/device/move-request', async (req, res, next) => {
    try {
      const input = simpleMoveInput.parse(req.body);
      res.status(201).json({ data: await simpleAttendance.requestDeviceMove({ actor: req.user, input, requestUserAgent: req.headers['user-agent'] || null }) });
    } catch (error) { next(error); }
  });

  router.get('/simple/pending', authorize('ADMIN'), async (req, res, next) => {
    try { res.json({ data: await simpleAttendance.listPending({ actor: req.user }) }); } catch (error) { next(error); }
  });

  router.post('/simple/pending/:id/confirm', authorize('ADMIN'), async (req, res, next) => {
    try {
      const input = simplePendingReviewInput.parse(req.body);
      res.json({ data: await simpleAttendance.reviewPending({ actor: req.user, pendingId: uuid.parse(req.params.id), action: 'CONFIRM', comment: input.comment }) });
    } catch (error) { next(error); }
  });

  router.post('/simple/pending/:id/reject', authorize('ADMIN'), async (req, res, next) => {
    try {
      const input = simplePendingReviewInput.parse(req.body);
      res.json({ data: await simpleAttendance.reviewPending({ actor: req.user, pendingId: uuid.parse(req.params.id), action: 'REJECT', comment: input.comment }) });
    } catch (error) { next(error); }
  });

  router.get('/me/today', async (req, res, next) => {
    try { res.json({ data: await employeeSelf.today({ actor: req.user }) }); } catch (error) { next(error); }
  });

  router.get('/me/history', async (req, res, next) => {
    try {
      const query = selfHistoryQuery.parse(req.query);
      res.json({ data: await employeeSelf.history({ actor: req.user, ...query }) });
    } catch (error) { next(error); }
  });

  router.get('/me/schedule', async (req, res, next) => {
    try {
      const query = selfScheduleQuery.parse(req.query);
      res.json({ data: await employeeSelf.schedule({ actor: req.user, ...query }) });
    } catch (error) { next(error); }
  });

  router.get('/evidence/:id/view', authorize('ADMIN', 'MANAGER', 'SUPERVISOR'), async (req, res, next) => {
    try { res.json({ data: await privateEvidence.view({ id: uuid.parse(req.params.id), actor: req.user }) }); } catch (error) { next(error); }
  });

  router.post('/evidence/purge-expired', authorize('ADMIN'), async (req, res, next) => {
    try { res.json({ data: await privateEvidence.purgeExpired({ actorUserId: req.user.sub }) }); } catch (error) { next(error); }
  });

  router.post('/readiness', async (req, res, next) => {
    try { const input = prepareInput.parse(req.body); res.json({ data: await service.assessReadiness({ actor: req.user, ...input }) }); } catch (error) { next(error); }
  });

  router.post('/verification/start', async (req, res, next) => {
    try { const input = prepareInput.parse(req.body); res.status(201).json({ data: await service.beginVerification({ actor: req.user, ...input }) }); } catch (error) { next(error); }
  });

  router.post('/verification/:id/device-proof', async (req, res, next) => {
    try { const input = deviceProofInput.parse(req.body); res.json({ data: await service.verifyDeviceProof({ actor: req.user, sessionId: uuid.parse(req.params.id), ...input }) }); } catch (error) { next(error); }
  });

  router.post('/verification/:id/geofence-only-uat/receipt', requireGeofenceOnlyUat, async (req, res, next) => {
    try {
      const input = geofenceOnlyUatReceiptInput.parse(req.body);
      res.json({ data: await service.issueGeofenceOnlyUatEventReceipt({ actor: req.user, sessionId: uuid.parse(req.params.id), ...input }) });
    } catch (error) { next(error); }
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
  attendanceGeofenceOnlyUatEnabled,
  selfHostedFaceRuntimeConfigured,
  inProcessFaceRuntimeConfigured,
  attendanceBiometricRuntimeEnabled,
  attendanceFaceChallengeUatEnabled,
  attendanceFaceEngineUatEnabled,
  createAttendanceRoutes,
  prepareInput,
  deviceProofInput,
  acceptInput,
  selfHistoryQuery,
  selfScheduleQuery
};
