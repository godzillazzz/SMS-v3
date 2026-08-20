const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createSecuritySiteService } = require('../services/security-site.service');
const { createDutyService } = require('../services/duty.service');

const router = express.Router();
const securitySites = createSecuritySiteService();
const duties = createDutyService();
router.use(authenticate);

const siteSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(150),
  latitude: z.coerce.number().gte(-90).lte(90),
  longitude: z.coerce.number().gte(-180).lte(180),
  geofenceRadiusMeters: z.coerce.number().int().min(10).max(100000),
  address: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  departmentNames: z.array(z.string().trim().min(1).max(100)).max(100).optional()
});

const dutySchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional()
});

router.get('/sites', authorize('ADMIN'), async (req, res, next) => {
  try { res.json({ data: await securitySites.list({ includeInactive: req.query.includeInactive === 'true' }) }); } catch (error) { next(error); }
});

router.get('/duties', authorize('ADMIN'), async (req, res, next) => {
  try { res.json({ data: await duties.list({ includeInactive: req.query.includeInactive === 'true' }) }); } catch (error) { next(error); }
});
router.post('/duties', authorize('ADMIN'), async (req, res, next) => {
  try { res.status(201).json({ data: await duties.create(dutySchema.parse(req.body), req.user.sub) }); } catch (error) { next(error); }
});
router.put('/duties/:id', authorize('ADMIN'), async (req, res, next) => {
  try { res.json({ data: await duties.update(z.string().uuid().parse(req.params.id), dutySchema.partial().parse(req.body), req.user.sub) }); } catch (error) { next(error); }
});
router.post('/sites', authorize('ADMIN'), async (req, res, next) => {
  try { res.status(201).json({ data: await securitySites.create(siteSchema.parse(req.body), req.user.sub) }); } catch (error) { next(error); }
});
router.put('/sites/:id', authorize('ADMIN'), async (req, res, next) => {
  try { res.json({ data: await securitySites.update(z.string().uuid().parse(req.params.id), siteSchema.partial().parse(req.body), req.user.sub) }); } catch (error) { next(error); }
});

module.exports = router;
