'use strict';

const express = require('express');
const { z } = require('zod');
const HttpError = require('../utils/http-error');
const { createAttendanceApiContractService } = require('../services/attendance-api-contract.service');

const uuid = z.string().uuid();
const decimal = z.union([
  z.number().finite(),
  z.string().trim().regex(/^-?\d+(?:\.\d+)?$/).max(32)
]);
const locationInput = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().positive(),
  capturedAt: z.string().datetime({ offset: true })
}).strict();
const attendanceEvidenceInput = z.object({
  qrToken: z.string().trim().min(24).max(512),
  location: locationInput
}).strict();
const prepareInput = z.object({
  captureId: uuid,
  eventIntent: z.enum(['CHECK_IN', 'CHECK_OUT']),
  attendanceEvidence: attendanceEvidenceInput
}).strict();
const contextLocationInput = z.object({
  latitude: decimal,
  longitude: decimal,
  accuracyMeters: decimal,
  capturedAt: z.string().datetime({ offset: true })
}).strict();
const attendanceContextInput = z.object({
  captureId: uuid,
  eventIntent: z.enum(['CHECK_IN', 'CHECK_OUT']),
  shiftAssignmentId: uuid,
  evidence: z.object({
    siteId: uuid,
    qrCredentialId: uuid,
    location: contextLocationInput
  }).strict()
}).strict();
const acceptInput = z.object({
  receipt: z.string().trim().min(32).max(512),
  attendanceContext: attendanceContextInput
}).strict();

function attendanceApiEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return false;
  return environment.VERCEL_ENV === 'preview' && environment.ATTENDANCE_API_PREVIEW_ENABLED === 'true';
}

function attendanceBiometricRuntimeEnabled(environment = process.env) {
  if (!attendanceApiEnabled(environment)) return false;
  return environment.FACE_VERIFICATION_POC_API_ENABLED === 'true';
}

function defaultAuthenticate(req, res, next) {
  return require('../middlewares/authenticate').authenticate(req, res, next);
}

function createAttendanceRoutes({
  environment = process.env,
  authenticateMiddleware = defaultAuthenticate,
  contractService = null
} = {}) {
  const router = express.Router();
  const service = contractService || createAttendanceApiContractService({
    isBiometricRuntimeEnabled: () => attendanceBiometricRuntimeEnabled(environment)
  });

  function requirePreviewAttendance(_req, _res, next) {
    return attendanceApiEnabled(environment) ? next() : next(new HttpError(404, 'Not found.'));
  }

  router.use(requirePreviewAttendance, authenticateMiddleware);

  router.post('/readiness', async (req, res, next) => {
    try {
      const input = prepareInput.parse(req.body);
      res.json({ data: await service.assessReadiness({ actor: req.user, ...input }) });
    } catch (error) { next(error); }
  });

  router.post('/verification/start', async (req, res, next) => {
    try {
      const input = prepareInput.parse(req.body);
      res.status(201).json({ data: await service.beginVerification({ actor: req.user, ...input }) });
    } catch (error) { next(error); }
  });

  router.post('/events', async (req, res, next) => {
    try {
      const input = acceptInput.parse(req.body);
      res.json({ data: await service.acceptVerifiedEvent({ actor: req.user, ...input }) });
    } catch (error) { next(error); }
  });

  return router;
}

const router = createAttendanceRoutes();

module.exports = {
  router,
  attendanceApiEnabled,
  attendanceBiometricRuntimeEnabled,
  createAttendanceRoutes,
  prepareInput,
  acceptInput
};
