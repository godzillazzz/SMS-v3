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
    const filters = filtersSchema.parse({
      date: req.query.date,
      department: req.query.department,
      siteId: req.query.siteId,
      shiftTypeId: req.query.shiftTypeId,
      employeeId: req.query.employeeId,
      status: req.query.status
    });
    res.json({ data: await service.daily({ actor: req.user, filters }) });
  } catch (error) { next(error); }
});

module.exports = { router, filtersSchema, attendanceSupervisorApiEnabled };
