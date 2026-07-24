const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');

const router = express.Router();
router.get('/', authenticate, authorize('ADMIN', 'MANAGER'), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, displayName: true, role: true, accountStatus: true, isActive: true, passwordResetRequired: true, createdAt: true, updatedAt: true },
      orderBy: { displayName: 'asc' }
    });
    res.json({ data: users });
  } catch (error) { next(error); }
});
module.exports = router;
