'use strict';

const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const HttpError = require('../utils/http-error');
const { createSupabaseEmployeeReferencePhotoStorage } = require('../services/employee-reference-photo-storage.service');
const { createEmployeeReferencePhotoService } = require('../services/employee-reference-photo.service');

const router = express.Router();
const service = createEmployeeReferencePhotoService({ storage: createSupabaseEmployeeReferencePhotoStorage() });
const uuid = z.string().uuid();
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 4 } }).single('photo');
const photoUpload = (req, res, next) => upload(req, res, (error) => error ? next(new HttpError(400, error.code === 'LIMIT_FILE_SIZE' ? 'รูปอ้างอิงต้องมีขนาดไม่เกิน 4 MB' : 'Reference photo upload is invalid.', { code: error.code === 'LIMIT_FILE_SIZE' ? 'REFERENCE_PHOTO_TOO_LARGE' : 'REFERENCE_PHOTO_UPLOAD_INVALID' })) : next());

router.use(authenticate);
router.get('/employee/:employeeId', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { res.json({ data: await service.getForEmployee({ employeeId: uuid.parse(req.params.employeeId), actor: req.user }) }); } catch (error) { next(error); }
});
router.post('/employee/:employeeId', authorize('ADMIN', 'MANAGER'), photoUpload, async (req, res, next) => {
  try { res.status(201).json({ data: await service.upload({ employeeId: uuid.parse(req.params.employeeId), actor: req.user, file: req.file }) }); } catch (error) { next(error); }
});
router.get('/:id/view', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { res.json({ data: await service.view({ id: uuid.parse(req.params.id), actor: req.user }) }); } catch (error) { next(error); }
});
router.post('/:id/approve', authorize('ADMIN'), async (req, res, next) => {
  try { res.json({ data: await service.approve({ id: uuid.parse(req.params.id), actor: req.user }) }); } catch (error) { next(error); }
});
router.post('/:id/reject', authorize('ADMIN'), async (req, res, next) => {
  try { const input = rejectSchema.parse(req.body); res.json({ data: await service.reject({ id: uuid.parse(req.params.id), actor: req.user, reason: input.reason }) }); } catch (error) { next(error); }
});
router.post('/:id/cancel', authorize('MANAGER'), async (req, res, next) => {
  try { res.json({ data: await service.cancel({ id: uuid.parse(req.params.id), actor: req.user }) }); } catch (error) { next(error); }
});

module.exports = router;
