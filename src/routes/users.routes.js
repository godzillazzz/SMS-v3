const express = require('express');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');
const audit = require('../services/audit.service');
const { accessTokenFor } = require('../services/auth.service');
const HttpError = require('../utils/http-error');

const router = express.Router();
router.get('/', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: req.user.role === 'MANAGER' ? { accountStatus: 'PENDING' } : undefined,
      select: { id: true, legacyUserId: true, email: true, displayName: true, role: true, department: true, accountStatus: true, isActive: true, passwordResetRequired: true, createdAt: true, updatedAt: true },
      orderBy: { displayName: 'asc' }
    });
    res.json({ data: users });
  } catch (error) { next(error); }
});
router.post('/:id/view-as', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    if (id === req.user.sub) throw new HttpError(400, 'Select another account for View As mode.');
    const target = await prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true, email: true, displayName: true, role: true, department: true, isActive: true, accountStatus: true, passwordResetRequired: true, tokenVersion: true } });
    if (!target.isActive || target.accountStatus !== 'ACTIVE' || target.passwordResetRequired) throw new HttpError(409, 'Only an active account can be used in View As mode.');
    const accessToken = accessTokenFor(target, { impersonatorSub: req.user.sub, impersonatorTokenVersion: req.user.tokenVersion, expiresIn: '10m' });
    await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'ViewAsSession', entityId: target.id, metadata: { targetRole: target.role, readOnly: true, expiresInMinutes: 10 } });
    res.json({ data: { accessToken, expiresIn: '10m', readOnly: true, user: { id: target.id, email: target.email, displayName: target.displayName, role: target.role, department: target.department } } });
  } catch (error) { next(error); }
});
module.exports = router;
