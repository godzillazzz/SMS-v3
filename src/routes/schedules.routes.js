const express = require('express');
const { z } = require('zod');
const scheduleService = require('../services/schedule.service');
const { authenticate, authorize } = require('../middlewares/authenticate');

const router = express.Router();
router.use(authenticate);

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format')
});

const batchSchema = z.object({
  assignments: z.array(
    z.object({
      employeeId: z.string().uuid(),
      shiftTypeId: z.string().uuid(),
      workDate: z.string(),
      remark: z.string().optional()
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
  try {
    const { assignments } = batchSchema.parse(req.body);
    res.json({ data: await scheduleService.saveBatchAssignments(assignments) });
  } catch (error) {
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

router.post('/approve', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { month, note } = approveSchema.parse(req.body);
    res.json({ data: await scheduleService.approveMonth(month, note, req.user.sub) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
