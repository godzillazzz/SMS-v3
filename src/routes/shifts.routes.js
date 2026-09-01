const express = require('express');
const { z } = require('zod');
const shiftService = require('../services/shift.service');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { normalizeScheduleTime } = require('../utils/schedule-time');
const HttpError = require('../utils/http-error');

const router = express.Router();
router.use(authenticate);

const scheduleTimeInput = z.string().trim().max(20).nullable().optional()
  .refine((value) => value === undefined || value === null || normalizeScheduleTime(value) !== null, { message: 'Shift time must use HH:mm.' })
  .transform((value) => value === undefined || value === null ? value : normalizeScheduleTime(value));

const shiftFields = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/),
  name: z.string().trim().min(1).max(100),
  startTime: scheduleTimeInput,
  endTime: scheduleTimeInput,
  hours: z.coerce.number().min(0).max(24),
  color: z.string().trim().toUpperCase().regex(/^#[0-9A-F]{6}$/),
  isActive: z.boolean().optional()
};
const shiftCreateSchema = z.object({
  ...shiftFields,
  hours: shiftFields.hours.default(8.0),
  color: shiftFields.color.default('#3B82F6')
});
const shiftUpdateSchema = z.object({ ...shiftFields, reason: z.string().trim().min(3).max(1000).optional(), confirmImpact: z.boolean().optional() }).partial();

router.get('/', async (req, res, next) => {
  try {
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    if (includeInactive && req.user.role !== 'ADMIN') throw new HttpError(403, 'Only Admin may include inactive shift types.');
    res.json({ data: await shiftService.list({ includeInactive }) });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/impact', authorize('ADMIN'), async (req, res, next) => {
  try { res.json({ data: await shiftService.impact(req.params.id) }); } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json({ data: await shiftService.getById(req.params.id) });
  } catch (error) {
    next(error);
  }
});

router.post('/', authorize('ADMIN'), async (req, res, next) => {
  try {
    res.status(201).json({ data: await shiftService.create(shiftCreateSchema.parse(req.body), req.user.sub) });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    res.json({ data: await shiftService.update(req.params.id, shiftUpdateSchema.parse(req.body), req.user.sub) });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    await shiftService.remove(req.params.id, req.user.sub);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
