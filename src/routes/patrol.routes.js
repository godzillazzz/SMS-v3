'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const HttpError = require('../utils/http-error');
const { createPatrolService } = require('../services/patrol.service');
const { lazyPatrolStorage } = require('../services/patrol-storage.service');

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const checkpointCreate = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(150),
  department: z.string().trim().min(1).max(100),
  locationNote: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional()
}).strict();
const checkpointUpdate = checkpointCreate.partial().extend({ isActive: z.boolean().optional() }).strict();
const resolveInput = z.object({ qrPayload: z.string().trim().min(1).max(200) }).strict();
const scanFields = z.object({
  qrPayload: z.string().trim().min(1).max(200),
  clientScanId: uuid,
  latitude: z.string().trim().max(32).optional(),
  longitude: z.string().trim().max(32).optional(),
  accuracyMeters: z.string().trim().max(32).optional(),
  note: z.string().trim().max(500).optional()
}).strict();
const reportQuery = z.object({ from: date, to: date, department: z.string().trim().min(1).max(100).optional() });

function createPatrolRoutes({
  service = createPatrolService({ storage: lazyPatrolStorage() }),
  authenticateMiddleware = authenticate,
  authorizeMiddleware = authorize
} = {}) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1, fields: 8, parts: 9 } }).single('photo');
  const photoUpload = (req, res, next) => upload(req, res, (error) => error
    ? next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'Patrol photo must not exceed 1 MB.' : 'Patrol scan upload is invalid.', { code: error.code === 'LIMIT_FILE_SIZE' ? 'PATROL_PHOTO_TOO_LARGE' : 'PATROL_UPLOAD_INVALID' }))
    : next());
  const reporters = authorizeMiddleware('ADMIN', 'MANAGER', 'SUPERVISOR');
  const admin = authorizeMiddleware('ADMIN');

  router.use(authenticateMiddleware);

  router.get('/checkpoints', reporters, async (req, res, next) => {
    try {
      const manage = req.query.manage === 'true';
      res.json({ data: await service.listCheckpoints({ actor: req.user, includeInactive: manage, includeQr: manage }) });
    } catch (error) { next(error); }
  });
  router.post('/checkpoints', admin, async (req, res, next) => {
    try { res.status(201).json({ data: await service.createCheckpoint({ actor: req.user, input: checkpointCreate.parse(req.body) }) }); } catch (error) { next(error); }
  });
  router.patch('/checkpoints/:id', admin, async (req, res, next) => {
    try { res.json({ data: await service.updateCheckpoint({ actor: req.user, checkpointId: uuid.parse(req.params.id), input: checkpointUpdate.parse(req.body) }) }); } catch (error) { next(error); }
  });
  router.post('/checkpoints/:id/rotate-qr', admin, async (req, res, next) => {
    try { res.json({ data: await service.rotateQr({ actor: req.user, checkpointId: uuid.parse(req.params.id) }) }); } catch (error) { next(error); }
  });

  router.post('/resolve', async (req, res, next) => {
    try { res.json({ data: await service.resolveQr({ actor: req.user, qrPayload: resolveInput.parse(req.body).qrPayload }) }); } catch (error) { next(error); }
  });
  router.post('/scans', photoUpload, async (req, res, next) => {
    try {
      const input = scanFields.parse(req.body || {});
      const result = await service.recordScan({ actor: req.user, input, photo: req.file });
      res.status(result.replayed ? 200 : 201).json({ data: result });
    } catch (error) { next(error); }
  });
  router.get('/scans/mine', async (req, res, next) => {
    try {
      const query = z.object({ date: date.optional() }).parse(req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ data: await service.myScans({ actor: req.user, date: query.date }) });
    } catch (error) { next(error); }
  });
  router.get('/scans/:id/photo', async (req, res, next) => {
    try {
      const result = await service.photo({ actor: req.user, scanId: uuid.parse(req.params.id) });
      res.set({ 'Content-Type': result.mimeType, 'Content-Length': String(result.bytes.length), 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'" });
      res.end(result.bytes);
    } catch (error) { next(error); }
  });
  router.get('/report', reporters, async (req, res, next) => {
    try {
      const query = reportQuery.parse(req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ data: await service.report({ actor: req.user, from: query.from, to: query.to, department: query.department }) });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { createPatrolRoutes };
