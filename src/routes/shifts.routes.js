const express = require('express');
const { z } = require('zod');
const shiftService = require('../services/shift.service');
const { authenticate, authorize } = require('../middlewares/authenticate');

const router = express.Router();
router.use(authenticate);

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use HH:mm.');
const shiftFields = {
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  startTime: timeSchema.optional(),
  endTime: timeSchema.optional(),
  hours: z.coerce.number().min(0).max(24).default(8.0),
  color: z.string().trim().default('#3b82f6'),
  isActive: z.boolean().default(true),
  isOvernight: z.boolean().default(false)
};
const assertShiftTiming = (value, context) => {
  if (value.isOvernight && (!value.startTime || !value.endTime)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['isOvernight'], message: 'Overnight shifts require start and end times.' });
  }
  if (value.startTime && value.endTime && value.endTime <= value.startTime && !value.isOvernight) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['isOvernight'], message: 'Overnight must be enabled when the end time is not later than the start time.' });
  }
};
const shiftSchema = z.object(shiftFields).superRefine(assertShiftTiming);
const shiftUpdateSchema = z.object(shiftFields).partial();

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
