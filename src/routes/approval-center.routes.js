'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createApprovalCenterService } = require('../services/approval-center.service');

const router = express.Router();
const service = createApprovalCenterService();
const query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  type: z.string().optional(),
  requestId: z.string().optional()
}).strict();
router.use(authenticate);

// View-As detail reads are intentionally a zero-information response. This
// narrow intercept must run after authentication (so inactive impersonators
// still receive 401) but before role authorization (the target role may not
// itself be an Approval Center reviewer). Mutations never reach this branch.
router.get('/', async (req, res, next) => {
  if (!req.user?.impersonation || req.method !== 'GET'
    || !Object.prototype.hasOwnProperty.call(req.query, 'requestId')) return next();
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await service.getItem({
      actor: req.user,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      requestId: typeof req.query.requestId === 'string' ? req.query.requestId : undefined,
      correlationId: req.requestId
    }));
  } catch (error) {
    next(error);
  }
});

router.use(authorize('ADMIN', 'MANAGER', 'SUPERVISOR'));
router.get('/summary', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await service.summary({ actor: req.user, correlationId: req.requestId }));
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const parsed = query.parse(req.query);
    if (Object.prototype.hasOwnProperty.call(req.query, 'type') || Object.prototype.hasOwnProperty.call(req.query, 'requestId')) {
      res.json(await service.getItem({ actor: req.user, type: parsed.type, requestId: parsed.requestId, correlationId: req.requestId }));
      return;
    }
    res.json(await service.list({ actor: req.user, correlationId: req.requestId, limit: parsed.limit }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
