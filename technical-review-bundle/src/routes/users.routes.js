const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');

const router = express.Router();
router.get('/', authenticate, authorize('ADMIN'), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, displayName: true, role: true, isActive: true, createdAt: true, updatedAt: true },
      orderBy: { displayName: 'asc' }
    });
    res.json({ data: users });
  } catch (error) { next(error); }
});
module.exports = router;
