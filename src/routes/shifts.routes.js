const express = require('express');
const { z } = require('zod');
const shiftService = require('../services/shift.service');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { normalizeScheduleTime } = require('../utils/schedule-time');

const router = express.Router();
router.use(authenticate);

const scheduleTimeInput = z.string().trim().max(20).nullable().optional()
  .refine((value) => value === undefined || value === null || normalizeScheduleTime(value) !== null, { message: 'Shift time must use HH:mm.' })
  .transform((value) => value === undefined || value === null ? value : normalizeScheduleTime(value));

const shiftSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  startTime: scheduleTimeInput,
  endTime: scheduleTimeInput,
  hours: z.coerce.number().min(0).max(24).default(8.0),
  color: z.string().trim().default('#3b82f6')
});

router.get('/', async (req, res, next) => {
  try {
    res.json({ data: await shiftService.list() });
  } catch (error) {
    next(error);
  }
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
    res.status(201).json({ data: await shiftService.create(shiftSchema.parse(req.body), req.user.sub) });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    res.json({ data: await shiftService.update(req.params.id, shiftSchema.partial().parse(req.body), req.user.sub) });
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
