'use strict';

const express = require('express');
const { z } = require('zod');
const HttpError = require('../utils/http-error');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createAttendanceSupervisorService } = require('../services/attendance-supervisor.service');

const router = express.Router();
const service = createAttendanceSupervisorService();
const uuid = z.string().uuid();

const filtersSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  department: z.string().trim().min(1).max(100).optional(),
  siteId: uuid.optional(),
  shiftTypeId: uuid.optional(),
  employeeId: uuid.optional(),
  status: z.string().trim().min(1).max(80).optional()
}).strict();

const historyFiltersSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  department: z.string().trim().min(1).max(100).optional(),
  siteId: uuid.optional(),
  shiftTypeId: uuid.optional(),
  employeeId: uuid.optional(),
  status: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
}).strict();

function attendanceSupervisorApiEnabled(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return environment.ATTENDANCE_API_PRODUCTION_ENABLED === 'true';
  return environment.VERCEL_ENV === 'preview' && environment.ATTENDANCE_API_PREVIEW_ENABLED === 'true';
}

function requireAttendanceApi(_req, _res, next) {
  if (attendanceSupervisorApiEnabled()) return next();
  return next(new HttpError(404, 'Not found.'));
}

router.use(requireAttendanceApi, authenticate, authorize('ADMIN', 'MANAGER'));

router.get('/daily', async (req, res, next) => {
  try {
    const filters = filtersSchema.parse(req.query);
    res.json({ data: await service.daily({ actor: req.user, filters }) });
  } catch (error) { next(error); }
});

router.get('/history', async (req, res, next) => {
  try {
    const filters = historyFiltersSchema.parse(req.query);
    res.json({ data: await service.history({ actor: req.user, filters }) });
  } catch (error) { next(error); }
});

router.get('/assignments/:id/detail', async (req, res, next) => {
  try {
    res.json({ data: await service.detail({ actor: req.user, assignmentId: uuid.parse(req.params.id) }) });
  } catch (error) { next(error); }
});

module.exports = { router, filtersSchema, historyFiltersSchema, attendanceSupervisorApiEnabled };
