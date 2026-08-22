const express = require('express');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const employeesRoutes = require('./employees.routes');
const shiftsRoutes = require('./shifts.routes');
const schedulesRoutes = require('./schedules.routes');
const operationsRoutes = require('./operations.routes');
const dataQualityRoutes = require('./data-quality.routes');
const registrationRequestRoutes = require('./registration-requests.routes');
const employeeChangeRequestRoutes = require('./employee-change-requests.routes');
const prisma = require('../config/prisma');

const router = express.Router();

// TEMPORARY PREVIEW-ONLY SUPABASE PROJECT IDENTITY PROBE. Remove immediately after isolation proof.
const EXPECTED_PREVIEW_SUPABASE_PROJECT_REF = 'ezxanpfagitckpfsnflp';
const PRODUCTION_SUPABASE_PROJECT_REF = 'jkexwnlxnxbemwavsebv';

function supabaseProjectRef(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const directHostMatch = url.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i);
    if (directHostMatch) return directHostMatch[1].toLowerCase();
    const username = decodeURIComponent(url.username || '');
    const poolerUserMatch = username.match(/^postgres\.([a-z0-9]{20})$/i);
    return poolerUserMatch ? poolerUserMatch[1].toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

router.get('/internal/preview-db-identity', async (_req, res, next) => {
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ error: 'Not found' });
  try {
    const databaseUrlProjectRef = supabaseProjectRef(process.env.DATABASE_URL);
    const directUrlProjectRef = supabaseProjectRef(process.env.DIRECT_URL);
    const rows = await prisma.$queryRaw`SELECT current_database() AS database`;
    return res.json({
      databaseUrlProjectMatchesExpectedPreview: databaseUrlProjectRef === EXPECTED_PREVIEW_SUPABASE_PROJECT_REF,
      directUrlProjectMatchesExpectedPreview: directUrlProjectRef === EXPECTED_PREVIEW_SUPABASE_PROJECT_REF,
      databaseUrlMatchesProductionProject: databaseUrlProjectRef === PRODUCTION_SUPABASE_PROJECT_REF,
      directUrlMatchesProductionProject: directUrlProjectRef === PRODUCTION_SUPABASE_PROJECT_REF,
      databaseName: rows[0]?.database ?? null
    });
  } catch (error) {
    return next(error);
  }
});router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/employees', employeesRoutes);
router.use('/registration-requests', registrationRequestRoutes);
router.use('/employee-change-requests', employeeChangeRequestRoutes);
router.use('/shift-types', shiftsRoutes);
router.use('/schedules', schedulesRoutes);
router.use('/schedule-calendar', schedulesRoutes);
router.use('/data-quality', dataQualityRoutes);
router.use('/', operationsRoutes);
module.exports = router;
