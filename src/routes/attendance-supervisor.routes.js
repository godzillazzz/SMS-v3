'use strict';

const express = require('express');
const { z } = require('zod');
const HttpError = require('../utils/http-error');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { attendanceApiEnabled } = require('../config/attendance-api-policy');
const { createAttendanceSupervisorService } = require('../services/attendance-supervisor.service');

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

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date.');
const monthPrintQuerySchema = z.object({
  selectedDate: calendarDate,
  employeeId: z.string().trim().min(1).optional()
}).strict();

function requireAttendanceApi(_req, _res, next) {
  if (attendanceApiEnabled()) return next();
  return next(new HttpError(404, 'Not found.'));
}

function createAttendanceSupervisorRoutes({
  service = createAttendanceSupervisorService(),
  requireAttendanceApiMiddleware = requireAttendanceApi,
  authenticateMiddleware = authenticate,
  authorizeMiddleware = authorize
} = {}) {
  const router = express.Router();
  router.use(requireAttendanceApiMiddleware, authenticateMiddleware, authorizeMiddleware('ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'));

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

  router.get('/month-print', async (req, res, next) => {
    try {
      const { selectedDate, employeeId } = monthPrintQuerySchema.parse(req.query);
      res.set('Cache-Control', 'no-store');
      const payload = { actor: req.user, selectedDate };
      if (employeeId) payload.employeeId = employeeId;
      res.json({ data: await service.monthPrint(payload) });
    } catch (error) { next(error); }
  });

  router.get('/assignments/:id/detail', async (req, res, next) => {
    try {
      res.json({ data: await service.detail({ actor: req.user, assignmentId: uuid.parse(req.params.id) }) });
    } catch (error) { next(error); }
  });

  return router;
}

const router = createAttendanceSupervisorRoutes();

module.exports = {
  router,
  createAttendanceSupervisorRoutes,
  filtersSchema,
  historyFiltersSchema,
  monthPrintQuerySchema,
  attendanceSupervisorApiEnabled: attendanceApiEnabled
};