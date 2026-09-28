'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createG06UatProvisioningService } = require('../services/g06-uat-provisioning.service');

const router = express.Router();
const service = createG06UatProvisioningService();
const emptyBody = z.object({}).strict();
const attendanceAuthorityBody = z.object({
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().nonnegative().max(1000),
    capturedAt: z.string().datetime()
  }).strict()
}).strict();

router.use(authenticate, authorize('ADMIN'));

router.post('/provision', async (req, res, next) => {
  try {
    emptyBody.parse(req.body || {});
    const result = await service.provision({ actorUserId: req.user.sub });
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    return res.status(result.created ? 201 : 200).json({ data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/attendance-authority', async (req, res, next) => {
  try {
    const input = attendanceAuthorityBody.parse(req.body || {});
    const result = await service.prepareAttendanceAuthority({ actorUserId: req.user.sub, location: input.location });
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    return res.status(result.idempotent ? 200 : 201).json({ data: result });
  } catch (error) {
    return next(error);
  }
});
module.exports = router;
