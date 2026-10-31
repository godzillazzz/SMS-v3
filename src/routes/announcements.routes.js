'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createAnnouncementService, ANNOUNCEMENT_CATEGORIES } = require('../services/announcement.service');

const uuid = z.string().uuid();
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const category = z.enum(ANNOUNCEMENT_CATEGORIES);
const createInput = z.object({
  title: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(5000),
  category,
  pinned: z.boolean().optional(),
  expiresOn: dateText.nullable().optional(),
  siteId: uuid.nullable().optional()
}).strict();
const updateInput = createInput.partial().strict();
const listQuery = z.object({
  category: category.optional(),
  siteId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  includeExpired: z.enum(['true', 'false']).optional().transform((value) => value === 'true')
});

function createAnnouncementRoutes({
  service = createAnnouncementService(),
  authenticateMiddleware = authenticate,
  authorizeMiddleware = authorize
} = {}) {
  const router = express.Router();
  const admin = authorizeMiddleware('ADMIN');
  router.use(authenticateMiddleware);

  router.get('/', async (req, res, next) => {
    try {
      const query = listQuery.parse(req.query);
      res.set('Cache-Control', 'no-store');
      res.json({ data: await service.list({ actor: req.user, query }) });
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
