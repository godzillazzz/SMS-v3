'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createSecuritySiteService } = require('../services/security-site.service');

const router = express.Router();
const service = createSecuritySiteService();

router.use(authenticate, authorize('ADMIN'));

const uuid = z.string().uuid();
const siteCreateSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(150),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  geofenceRadiusMeters: z.coerce.number().int().min(1).max(100000),
  isActive: z.boolean().optional().default(true)
});
const siteUpdateSchema = siteCreateSchema.partial().extend({ reason: z.string().trim().min(3).max(1000).optional() }).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required.' });
const duplicateSchema = z.object({ code: z.string().trim().min(1).max(50), name: z.string().trim().min(1).max(150).optional() }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const mappingSchema = z.object({
  departmentMasterId: uuid,
  siteIds: z.array(uuid).max(100).default([]),
  defaultSiteId: uuid.nullable().optional().default(null)
});

router.get('/', async (req, res, next) => {
  try {
    const includeInactive = String(req.query.includeInactive || 'true').toLowerCase() !== 'false';
    res.json({ data: await service.list({ includeInactive }) });
  } catch (error) { next(error); }
});

router.get('/departments', async (_req, res, next) => {
  try {
    res.json({ data: await service.listDepartments() });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json({ data: await service.create(siteCreateSchema.parse(req.body), req.user.sub) });
  } catch (error) { next(error); }
});

router.put('/department-mapping', async (req, res, next) => {
  try {
    res.json({ data: await service.replaceDepartmentMapping(mappingSchema.parse(req.body), req.user.sub) });
  } catch (error) { next(error); }
});

router.post('/:id/duplicate', async (req, res, next) => {
  try {
    res.status(201).json({ data: await service.duplicate(uuid.parse(req.params.id), duplicateSchema.parse(req.body), req.user.sub) });
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    res.json({ data: await service.update(uuid.parse(req.params.id), siteUpdateSchema.parse(req.body), req.user.sub) });
  } catch (error) { next(error); }
});

router.post('/:id/qr/rotate', async (req, res, next) => {
  try {
    res.json({ data: await service.rotateQr(uuid.parse(req.params.id), req.user.sub, reasonSchema.parse(req.body).reason) });
  } catch (error) { next(error); }
});

router.post('/:id/qr/:credentialId/revoke', async (req, res, next) => {
  try {
    res.json({ data: await service.revokeQr(uuid.parse(req.params.id), uuid.parse(req.params.credentialId), req.user.sub, reasonSchema.parse(req.body).reason) });
  } catch (error) { next(error); }
});

module.exports = router;
