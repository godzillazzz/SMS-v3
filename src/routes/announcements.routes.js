'use strict';

const express = require('express');
const multer = require('multer');
const HttpError = require('../utils/http-error');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createAnnouncementService, ANNOUNCEMENT_CATEGORIES, MAX_IMAGE_BYTES } = require('../services/announcement.service');
const { lazyAnnouncementStorage } = require('../services/announcement-storage.service');

const uuid = z.string().uuid();
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const category = z.enum(ANNOUNCEMENT_CATEGORIES);
const createInput = z.object({
  title: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(5000),
  category,
  pinned: z.boolean().optional(),
  showPopup: z.boolean().optional(),
  expiresOn: dateText.nullable().optional()
}).strict();
const updateInput = createInput.partial().strict();
const listQuery = z.object({
  category: category.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  includeExpired: z.enum(['true', 'false']).optional().transform((value) => value === 'true')
});

function createAnnouncementRoutes({
  service = createAnnouncementService({ storage: lazyAnnouncementStorage() }),
  authenticateMiddleware = authenticate,
  authorizeMiddleware = authorize
} = {}) {
  const router = express.Router();
  const admin = authorizeMiddleware('ADMIN');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 } }).single('image');
  const imageUpload = (req, res, next) => upload(req, res, (error) => error
    ? next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'Announcement image must not exceed 5 MB.' : 'Announcement image upload is invalid.', { code: error.code === 'LIMIT_FILE_SIZE' ? 'ANNOUNCEMENT_IMAGE_TOO_LARGE' : 'ANNOUNCEMENT_UPLOAD_INVALID' }))
    : next());
  router.use(authenticateMiddleware);

  router.get('/popups', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ data: await service.popups({ actor: req.user }) });
    } catch (error) { next(error); }
  });
  router.get('/:id/image', async (req, res, next) => {
    try {
      const result = await service.image({ actor: req.user, id: uuid.parse(req.params.id) });
      res.set({ 'Content-Type': result.mimeType, 'Content-Length': String(result.bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'" });
      res.end(result.bytes);
    } catch (error) { next(error); }
  });
  router.put('/:id/image', admin, imageUpload, async (req, res, next) => {
    try { res.json({ data: await service.setImage({ actor: req.user, id: uuid.parse(req.params.id), file: req.file }) }); } catch (error) { next(error); }
  });
  router.delete('/:id/image', admin, async (req, res, next) => {
    try { res.json({ data: await service.removeImage({ actor: req.user, id: uuid.parse(req.params.id) }) }); } catch (error) { next(error); }
  });

  router.get('/', async (req, res, next) => {
    try {
      const query = listQuery.parse(req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ data: await service.list({ actor: req.user, query }) });
    } catch (error) { next(error); }
  });
  router.get('/:id', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ data: await service.get({ actor: req.user, id: uuid.parse(req.params.id) }) });
    } catch (error) { next(error); }
  });
  router.post('/', admin, async (req, res, next) => {
    try { res.status(201).json({ data: await service.create({ actor: req.user, input: createInput.parse(req.body) }) }); } catch (error) { next(error); }
  });
  router.patch('/:id', admin, async (req, res, next) => {
    try { res.json({ data: await service.update({ actor: req.user, id: uuid.parse(req.params.id), input: updateInput.parse(req.body) }) }); } catch (error) { next(error); }
  });
  router.delete('/:id', admin, async (req, res, next) => {
    try { res.json({ data: await service.remove({ actor: req.user, id: uuid.parse(req.params.id) }) }); } catch (error) { next(error); }
  });
  return router;
}

module.exports = { createAnnouncementRoutes };
