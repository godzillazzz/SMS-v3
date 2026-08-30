const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { getSystemHealth } = require('../services/system-health.service');

const router = express.Router();

router.get('/', authenticate, authorize('ADMIN'), async (_req, res, next) => {
  try {
    res.json(await getSystemHealth({ prismaClient: prisma }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
