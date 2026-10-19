'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createAttendanceDeviceService } = require('../services/attendance-device.service');

const router = express.Router();
const service = createAttendanceDeviceService();
const uuid = z.string().uuid();
const status = z.enum(['PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED']);
const rejectInput = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

router.use(authenticate, authorize('ADMIN'));
router.get('/', async (req, res, next) => {
  try { res.json({ data: await service.listRequests({ actor: req.user, status: req.query.status ? status.parse(req.query.status) : 'PENDING_APPROVAL' }) }); } catch (error) { next(error); }
});
router.post('/:id/approve', async (req, res, next) => {
  try { res.json({ data: await service.approve({ actor: req.user, requestId: uuid.parse(req.params.id) }) }); } catch (error) { next(error); }
});
router.post('/:id/reject', async (req, res, next) => {
  try { res.json({ data: await service.reject({ actor: req.user, requestId: uuid.parse(req.params.id), reason: rejectInput.parse(req.body).reason }) }); } catch (error) { next(error); }
});

module.exports = router;
