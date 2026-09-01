const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const service = require('../services/personnel-master.service');

const router = express.Router();
const kind = z.enum(['department', 'position']);
const uuid = z.string().uuid();
const input = z.object({ name: z.string().trim().min(1).max(100), isActive: z.boolean().optional(), sortOrder: z.number().int().min(-9999).max(9999).optional() }).strict();
const patch = input.partial().refine((value) => Object.keys(value).length > 0, 'Update body cannot be empty.');

router.use(authenticate);
router.get('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { res.json({ data: await service.list({ activeOnly: req.query.activeOnly === 'true' }) }); } catch (error) { next(error); } });
router.post('/:kind', authorize('ADMIN'), async (req, res, next) => { try { res.status(201).json({ data: await service.create({ kind: kind.parse(req.params.kind), input: input.parse(req.body), actorUserId: req.user.sub }) }); } catch (error) { next(error); } });
router.put('/:kind/:id', authorize('ADMIN'), async (req, res, next) => { try { res.json({ data: await service.update({ kind: kind.parse(req.params.kind), id: uuid.parse(req.params.id), input: patch.parse(req.body), actorUserId: req.user.sub }) }); } catch (error) { next(error); } });

module.exports = router;
