'use strict';

const express = require('express');
const { z } = require('zod');
const HttpError = require('../utils/http-error');
const { authenticate } = require('../middlewares/authenticate');
const { createAttendanceCorrectionService } = require('../services/attendance-correction.service');
const { createAttendanceMonthGovernanceService } = require('../services/attendance-month-governance.service');
const { attendanceRuntimeEnabled } = require('../services/attendance-production-runtime.service');

const router = express.Router();
const corrections = createAttendanceCorrectionService();
const months = createAttendanceMonthGovernanceService();
const uuid = z.string().uuid();
const month = z.string().regex(/^\d{4}-\d{2}$/);
const correctionInput = z.object({
  eventType: z.enum(['CHECK_IN', 'CHECK_OUT']),
  correctedEffectiveEventAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(5).max(1000)
}).strict();
const unlockInput = z.object({ reason: z.string().trim().min(5).max(1000) }).strict();

function attendanceGovernanceApiEnabled(environment = process.env) {
  return attendanceRuntimeEnabled(environment);
}

function requireAttendanceRuntime(_req, _res, next) {
  return attendanceGovernanceApiEnabled() ? next() : next(new HttpError(404, 'Not found.'));
}

function requireManagerOrAdmin(req, _res, next) {
  return ['ADMIN', 'MANAGER'].includes(String(req.user?.role || '').toUpperCase())
    ? next()
    : next(new HttpError(403, 'Attendance governance access denied.'));
}

function requireAdmin(req, _res, next) {
  return String(req.user?.role || '').toUpperCase() === 'ADMIN'
    ? next()
    : next(new HttpError(403, 'Attendance certification requires Admin authority.'));
}

router.use(requireAttendanceRuntime, authenticate);

router.get('/assignments/:id/corrections', requireManagerOrAdmin, async (req, res, next) => {
  try {
    res.json({ data: await corrections.list({ actor: req.user, assignmentId: uuid.parse(req.params.id) }) });
  } catch (error) { next(error); }
});

router.post('/assignments/:id/corrections', requireManagerOrAdmin, async (req, res, next) => {
  try {
    const input = correctionInput.parse(req.body);
    res.status(201).json({ data: await corrections.correct({ actor: req.user, assignmentId: uuid.parse(req.params.id), ...input }) });
  } catch (error) { next(error); }
});

router.get('/months/:month/preview', requireAdmin, async (req, res, next) => {
  try { res.json({ data: await months.preview(month.parse(req.params.month)) }); }
  catch (error) { next(error); }
});

router.get('/months/:month/certifications', requireAdmin, async (req, res, next) => {
  try { res.json({ data: await months.certificationHistory(month.parse(req.params.month)) }); }
  catch (error) { next(error); }
});

router.post('/months/:month/certify', requireAdmin, async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body || {});
    res.status(201).json({ data: await months.certify({ actor: req.user, month: month.parse(req.params.month) }) });
  } catch (error) { next(error); }
});

router.post('/months/:month/unlock', requireAdmin, async (req, res, next) => {
  try {
    const input = unlockInput.parse(req.body);
    res.json({ data: await months.unlock({ actor: req.user, month: month.parse(req.params.month), reason: input.reason }) });
  } catch (error) { next(error); }
});

module.exports = {
  router,
  correctionInput,
  unlockInput,
  attendanceGovernanceApiEnabled
};
