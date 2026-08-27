
'use strict';

const express = require('express');
const { z } = require('zod');
const HttpError = require('../utils/http-error');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createAttendanceAdjustmentService } = require('../services/attendance-adjustment.service');

const router = express.Router();
const service = createAttendanceAdjustmentService();
const uuid = z.string().uuid();

const requestType = z.enum(['CONFIRM_WORK_PERFORMED', 'ADJUST_WORK_TIME']);
const proposal = z.object({
  checkInAt: z.string().datetime({ offset: true }).nullable().optional(),
  checkOutAt: z.string().datetime({ offset: true }).nullable().optional()
}).strict();

const requestInput = z.object({
  assignmentId: uuid,
  requestType,
  proposal,
  reason: z.string().trim().min(5).max(1000)
}).strict();

const revisionInput = z.object({
  requestType,
  proposal,
  reason: z.string().trim().min(5).max(1000)
}).strict();

const listQuery = z.object({
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  assignmentId: uuid.optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
}).strict();

const commentInput = z.object({
  comment: z.string().trim().min(3).max(1000)
}).strict();

function attendanceAdjustmentApiEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return environment.ATTENDANCE_API_PRODUCTION_ENABLED === 'true';
  return environment.VERCEL_ENV === 'preview' && environment.ATTENDANCE_API_PREVIEW_ENABLED === 'true';
}

function requireAttendanceApi(_req, _res, next) {
  return attendanceAdjustmentApiEnabled()
    ? next()
    : next(new HttpError(404, 'Not found.'));
}

router.use(requireAttendanceApi, authenticate, authorize('ADMIN', 'MANAGER'));

router.get('/', async (req, res, next) => {
  try {
    const filters = listQuery.parse(req.query);
    res.json(await service.list({ actor: req.user, ...filters }));
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const input = requestInput.parse(req.body);
    res.status(201).json({
      data: await service.createDraft({
        actor: req.user,
        assignmentId: input.assignmentId,
        requestType: input.requestType,
        proposal: input.proposal,
        reason: input.reason
      })
    });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json({ data: await service.get({ actor: req.user, id: uuid.parse(req.params.id) }) });
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const input = revisionInput.parse(req.body);
    res.json({
      data: await service.revise({
        actor: req.user,
        id: uuid.parse(req.params.id),
        requestType: input.requestType,
        proposal: input.proposal,
        reason: input.reason
      })
    });
  } catch (error) { next(error); }
});

router.post('/:id/submit', async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body || {});
    res.json({ data: await service.submit({ actor: req.user, id: uuid.parse(req.params.id) }) });
  } catch (error) { next(error); }
});

router.post('/:id/return', authorize('ADMIN'), async (req, res, next) => {
  try {
    const input = commentInput.parse(req.body);
    res.json({
      data: await service.returnForCorrection({
        actor: req.user,
        id: uuid.parse(req.params.id),
        comment: input.comment
      })
    });
  } catch (error) { next(error); }
});

router.post('/:id/reject', authorize('ADMIN'), async (req, res, next) => {
  try {
    const input = commentInput.parse(req.body);
    res.json({
      data: await service.reject({
        actor: req.user,
        id: uuid.parse(req.params.id),
        comment: input.comment
      })
    });
  } catch (error) { next(error); }
});

router.post('/:id/approve', authorize('ADMIN'), async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body || {});
    res.json({ data: await service.approve({ actor: req.user, id: uuid.parse(req.params.id) }) });
  } catch (error) { next(error); }
});

module.exports = {
  router,
  requestInput,
  revisionInput,
  listQuery,
  commentInput,
  attendanceAdjustmentApiEnabled
};
