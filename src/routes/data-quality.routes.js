const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');
const HttpError = require('../utils/http-error');
const { dataQualityQuery, getDataQualityIssues } = require('../services/data-quality.service');

const router = express.Router();

router.get('/issues', authenticate, authorize('ADMIN'), async (req, res, next) => {
  const parsed = dataQualityQuery.safeParse(req.query);
  if (!parsed.success) return next(new HttpError(400, 'Invalid data quality filters.'));
  try {
    res.json(await getDataQualityIssues({ prismaClient: prisma, query: parsed.data }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
