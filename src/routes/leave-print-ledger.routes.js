'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticateReadOnly } = require('../middlewares/authenticate-read-only');
const { authorize } = require('../middlewares/authenticate');
const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { getLeavePrintLedger } = require('../services/leave-print-ledger.service');

const router = express.Router();
const uuid = z.string().uuid();
router.get('/:id/print-ledger', authenticateReadOnly('ADMIN', 'MANAGER', 'SUPERVISOR'), authorize('ADMIN', 'MANAGER', 'SUPERVISOR'), async (req, res, next) => {
  try {
    if (Object.keys(req.query).length) throw new HttpError(400, 'Print ledger does not accept query parameters.');
    const parsedId = uuid.safeParse(req.params.id);
    if (!parsedId.success) throw new HttpError(400, 'Invalid leave request id.');
    const data = await getLeavePrintLedger(prisma, parsedId.data, req.user);
    res.set('Cache-Control', 'no-store');
    res.json({ data });
  } catch (error) { next(error); }
});

module.exports = router;
