'use strict';

const express = require('express');
const { createRuntimeIsolationReceipt } = require('../services/runtime-isolation-probe.service');

function statusFor(code) {
  if (code === 'PROBE_AUTH_REQUIRED' || code === 'PROBE_AUTH_NOT_CONFIGURED') return 401;
  if (code === 'PREVIEW_RUNTIME_REQUIRED') return 404;
  return 503;
}

function createRuntimeIsolationRoutes({
  environment = process.env,
  prisma,
  fetchImpl = globalThis.fetch,
  logger = require('../utils/logger').logger
} = {}) {
  const router = express.Router();

  router.head('/', (_req, res) => {
    res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache');
    return res.status(environment.VERCEL_ENV === 'preview' ? 405 : 404).end();
  });

  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    try {
      const receipt = await createRuntimeIsolationReceipt({
        req,
        environment,
        prisma,
        fetchImpl,
        now: Date.now()
      });
      return res.status(200).json(receipt);
    } catch (error) {
      const code = /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'PROBE_UNVERIFIED';
      logger.warn('runtime_isolation_probe_unverified', {
        requestId: req.requestId,
        code
      });
      const status = statusFor(code);
      return res.status(status).json({
        status: 'unverified',
        requestId: req.requestId
      });
    }
  });

  return router;
}

module.exports = { createRuntimeIsolationRoutes, statusFor };
