'use strict';

const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createEmployeeChangeRequestService } = require('../services/employee-change-request.service');

const router = express.Router();
const service = createEmployeeChangeRequestService();
const uuid = z.string().uuid();
const status = z.enum(['DRAFT', 'PENDING_APPROVAL', 'RETURNED_FOR_CORRECTION', 'APPROVED', 'REJECTED', 'CANCELLED']);
const paging = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(25), status: status.optional() }).strict();
const draft = z.object({ proposal: z.record(z.unknown()), effectiveMode: z.enum(['IMMEDIATE', 'FUTURE_EFFECTIVE']).default('IMMEDIATE'), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), reason: z.string().trim().max(1000).nullable().optional(), idempotencyKey: z.string().uuid() }).strict();
const transition = z.object({ idempotencyKey: z.string().uuid() }).strict();
const cancel = transition.extend({ reason: z.string().trim().min(3).max(1000).nullable().optional() });
const reviewReturn = transition.extend({ comment: z.string().trim().min(3).max(1000) });
const reviewReject = transition.extend({ reason: z.string().trim().min(3).max(1000) });
const approve = transition.extend({ acknowledgeWarnings: z.boolean().default(false) });

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));
router.get('/', async (req, res, next) => { try { res.json(await service.list({ actor: req.user, ...paging.parse(req.query) })); } catch (error) { next(error); } });
router.get('/:id', async (req, res, next) => { try { res.json({ data: await service.getById({ id: uuid.parse(req.params.id), actor: req.user }) }); } catch (error) { next(error); } });
router.put('/:id/draft', async (req, res, next) => { try { res.json({ data: await service.saveDraft({ id: uuid.parse(req.params.id), actor: req.user, ...draft.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/:id/submit', async (req, res, next) => { try { res.json({ data: await service.submit({ id: uuid.parse(req.params.id), actor: req.user, ...transition.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/:id/resubmit', async (req, res, next) => { try { res.json({ data: await service.resubmit({ id: uuid.parse(req.params.id), actor: req.user, ...transition.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/:id/cancel', async (req, res, next) => { try { res.json({ data: await service.cancel({ id: uuid.parse(req.params.id), actor: req.user, ...cancel.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/:id/approve', async (req, res, next) => { try { res.json({ data: await service.approve({ id: uuid.parse(req.params.id), actor: req.user, ...approve.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/:id/return-for-correction', async (req, res, next) => { try { res.json({ data: await service.returnForCorrection({ id: uuid.parse(req.params.id), actor: req.user, ...reviewReturn.parse(req.body) }) }); } catch (error) { next(error); } });
router.post('/:id/reject', async (req, res, next) => { try { res.json({ data: await service.reject({ id: uuid.parse(req.params.id), actor: req.user, ...reviewReject.parse(req.body) }) }); } catch (error) { next(error); } });
module.exports = router;
