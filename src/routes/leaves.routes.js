const express = require('express');
const { z } = require('zod');
const leaveService = require('../services/leave.service');
const { authenticate, authorize } = require('../middlewares/authenticate');

const router = express.Router();
router.use(authenticate);

const leaveSubmitSchema = z.object({
  employeeId: z.string().uuid(),
  leaveType: z.string().trim().min(1).max(100),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().trim().min(1).max(500)
});

const rejectSchema = z.object({
  reason: z.string().optional()
});

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json({ data: await leaveService.submitRequest(leaveSubmitSchema.parse(req.body)) });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    res.json({ data: await leaveService.listRequests(req.query) });
  } catch (error) {
    next(error);
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    const employeeId = req.query.employeeId || req.user.employeeId;
    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId query parameter is required.' });
    }
    res.json({ data: await leaveService.getSummary(employeeId) });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/approve', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    res.json({ data: await leaveService.approveRequest(req.params.id, req.user.sub) });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/reject', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const body = rejectSchema.parse(req.body || {});
    res.json({ data: await leaveService.rejectRequest(req.params.id, body.reason, req.user.sub) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
