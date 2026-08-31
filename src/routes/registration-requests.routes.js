const express = require('express');
const { z } = require('zod');
const { authenticate, authorize } = require('../middlewares/authenticate');
const { createRegistrationRequestService } = require('../services/registration-request.service');
const { createApprovalPolicyService } = require('../services/approval-policy.service');

const router = express.Router();
const service = createRegistrationRequestService();
const approvalPolicy = createApprovalPolicyService();
const uuid = z.string().uuid();
const status = z.enum(['PENDING', 'MATCHED', 'APPROVED', 'REJECTED']);
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
  status: status.optional()
}).strict();
const candidateSchema = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(20)
}).strict();
const matchSchema = z.object({ employeeId: z.string().uuid() }).strict();
const approveSchema = z.object({}).strict();
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

router.use(authenticate);
router.use(authorize('ADMIN', 'MANAGER'));
router.use(async (req, _res, next) => {
  try { await approvalPolicy.assertReviewer('REGISTRATION_REQUEST', req.user); next(); }
  catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try { res.json(await service.list(listSchema.parse(req.query))); } catch (error) { next(error); }
});
router.get('/:id', async (req, res, next) => {
  try { res.json({ data: await service.getById(uuid.parse(req.params.id)) }); } catch (error) { next(error); }
});
router.get('/:id/candidates', async (req, res, next) => {
  try { res.json(await service.searchCandidates({ id: uuid.parse(req.params.id), ...candidateSchema.parse(req.query) })); } catch (error) { next(error); }
});
router.post('/:id/match', async (req, res, next) => {
  try { res.json({ data: await service.match({ id: uuid.parse(req.params.id), employeeId: matchSchema.parse(req.body).employeeId, actorUserId: req.user.sub, actorRole: req.user.role }) }); } catch (error) { next(error); }
});
router.post('/:id/approve', async (req, res, next) => {
  try { approveSchema.parse(req.body || {}); res.json({ data: await service.approve({ id: uuid.parse(req.params.id), actorUserId: req.user.sub, actorRole: req.user.role }) }); } catch (error) { next(error); }
});
router.post('/:id/reject', async (req, res, next) => {
  try { const input = rejectSchema.parse(req.body); res.json({ data: await service.reject({ id: uuid.parse(req.params.id), reason: input.reason, actorUserId: req.user.sub, actorRole: req.user.role }) }); } catch (error) { next(error); }
});

module.exports = router;
