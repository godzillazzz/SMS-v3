'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createG06UatProvisioningService } = require('../services/g06-uat-provisioning.service');

const router = express.Router();
const service = createG06UatProvisioningService();
const emptyBody = z.object({}).strict();

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

module.exports = router;
