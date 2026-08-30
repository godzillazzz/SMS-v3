'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createApprovalCenterService } = require('../services/approval-center.service');

const router = express.Router();
const service = createApprovalCenterService();
const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100) }).strict();

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));
router.get('/summary', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await service.summary({ actor: req.user }));
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await service.list({ actor: req.user, ...query.parse(req.query) }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
