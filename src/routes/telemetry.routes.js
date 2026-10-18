'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { summarize } = require('../lib/route-latency-registry');

const querySchema = z.object({
  minutes: z.coerce.number().int().min(1).max(120).default(15),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

function createTelemetryRoutes({ authenticateMiddleware = authenticate, authorizeMiddleware = authorize } = {}) {
  const router = express.Router();
  router.get('/latency', authenticateMiddleware, authorizeMiddleware('ADMIN'), (req, res, next) => {
    try {
      res.json(summarize(querySchema.parse(req.query)));
    } catch (error) {
      if (error?.name === 'ZodError') error.statusCode = 400;
      next(error);
    }
  });
  return router;
}

const router = createTelemetryRoutes();
module.exports = router;
module.exports.createTelemetryRoutes = createTelemetryRoutes;
