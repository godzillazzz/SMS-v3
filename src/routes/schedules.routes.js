const express = require('express');
const { z } = require('zod');
const scheduleService = require('../services/schedule.service');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { logger, errorCategory } = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format')
});

const workDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Work date must be in YYYY-MM-DD format')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  }, 'Work date must be a valid calendar date');

const batchSchema = z.object({
  assignments: z.array(
    z.object({
      employeeId: z.string().uuid(),
      shiftTypeId: z.string().uuid(),
      workDate: workDateSchema,
      remark: z.string().optional(),
      licenseOverride: z.boolean().optional(),
      overrideReason: z.string().optional()
    })
  )
});

const autoPlanSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/)
});

const approveSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  note: z.string().optional()
});

router.get('/', async (req, res, next) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { month } = monthQuerySchema.parse({ month: req.query.month || currentMonth });
    res.json({ data: await scheduleService.getMonthlyGrid(month) });
  } catch (error) {
    next(error);
  }
});

router.post('/batch', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  let assignmentCount = Array.isArray(req.body?.assignments) ? req.body.assignments.length : 0;
  try {
    const { assignments } = batchSchema.parse(req.body);
    assignmentCount = assignments.length;
    res.json({ data: await scheduleService.saveBatchAssignments(assignments, req.user.sub, req.user.role) });
  } catch (error) {
    // Keep operational diagnostics tied to the write endpoint without
    // recording request bodies, credentials, or connection strings.
    logger.error('schedule_batch_write_failed', {
      endpoint: `${req.baseUrl}${req.path}`,
      requestId: req.requestId,
      assignmentCount,
      operation: 'upsert_batch',
      model: 'ShiftAssignment',
      errorName: error?.name,
      errorCode: error?.code,
      errorMessage: error?.message,
      errorDetails: error?.meta?.details || error?.details,
      errorHint: error?.meta?.hint || error?.hint,
      stack: error?.stack,
      errorCategory: errorCategory(error)
    });
    next(error);
  }
});

router.post('/auto-plan', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { month } = autoPlanSchema.parse(req.body);
    res.json({ data: await scheduleService.autoPlanMonth(month) });
  } catch (error) {
    next(error);
  }
});

router.post('/approve', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { month, note } = approveSchema.parse(req.body);
    res.json({ data: await scheduleService.approveMonth(month, note, req.user) });
  } catch (error) {
    next(error);
  }
});

// Exposed for isolated validation tests; the HTTP route remains the default export.
module.exports = router;
module.exports.batchSchema = batchSchema;
