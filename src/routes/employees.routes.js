const express = require('express');
const { z } = require('zod');
const employee = require('../services/employee.service');
const lifecycle = require('../services/employee-lifecycle.service');
const masterMutation = require('../services/employee-master-mutation.service');
const { createOnboardingReadinessService } = require('../services/onboarding-readiness.service');
const onboardingReadiness = createOnboardingReadinessService();
const { createEmployeeChangeRequestService } = require('../services/employee-change-request.service');
const changeRequests = createEmployeeChangeRequestService();
const { authenticate, authorize } = require('../middlewares/authenticate');
const HttpError = require('../utils/http-error');

const router = express.Router();
const employeeSchema = z.object({
  employeeCode: z.string().trim().min(1).max(50),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  department: z.string().trim().max(100).nullable().optional(),
  jobTitle: z.string().trim().max(100).nullable().optional(),
  hiredAt: z.coerce.date().nullable().optional(),
  skill: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().optional()
});
const lifecycleChangesSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  department: z.string().trim().min(1).max(100).optional(),
  jobTitle: z.string().trim().min(1).max(100).optional()
}).default({});
const lifecyclePreflightSchema = z.object({
  type: z.enum(lifecycle.EVENT_TYPES),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  changes: lifecycleChangesSchema
});
const lifecycleActionSchema = lifecyclePreflightSchema.extend({
  reason: z.string().trim().min(3).max(1000),
  expectedEmployeeUpdatedAt: z.string().datetime(),
  expectedLifecycleSequence: z.number().int().min(0),
  idempotencyKey: z.string().uuid(),
  acknowledgeWarnings: z.boolean().default(false)
});
const masterEditPreflightSchema = z.object({
  changes: z.record(z.unknown()),
  effectiveMode: z.enum(['IMMEDIATE', 'FUTURE_EFFECTIVE']).default('IMMEDIATE'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().trim().max(1000).nullable().optional()
}).strict();
const masterEditSchema = masterEditPreflightSchema.extend({
  expectedEmployeeUpdatedAt: z.string().datetime(),
  expectedLifecycleSequence: z.number().int().min(0),
  idempotencyKey: z.string().uuid(),
  acknowledgeWarnings: z.boolean().default(false)
});
const employeeChangeDraftSchema = z.object({
  proposal: z.record(z.unknown()).nullable().optional(),
  effectiveMode: z.enum(['IMMEDIATE', 'FUTURE_EFFECTIVE']).default('IMMEDIATE'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reason: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: z.string().uuid()
}).strict();

router.use(authenticate);
const uuid = z.string().uuid();
const listSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().min(1).max(100).optional(), isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(), department: z.string().trim().min(1).max(100).optional() });
router.get('/', async (req, res, next) => { try { res.json(await employee.list(listSchema.parse(req.query), req.user.role)); } catch (error) { next(error); } });
router.get('/readiness/center', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const query = z.object({ search: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }).parse(req.query); res.json(await onboardingReadiness.listEmployeeReadiness(query)); } catch (error) { next(error); } });
router.get('/:id/onboarding-readiness', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { res.json({ data: await onboardingReadiness.getEmployeeReadiness({ employeeId: uuid.parse(req.params.id) }) }); } catch (error) { next(error); } });
router.get('/:id/lifecycle', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query); res.json(await lifecycle.getEmployeeLifecycleHistory(uuid.parse(req.params.id), query, req.user.role)); } catch (error) { next(error); } });
router.get('/:id/lifecycle/state', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query); res.json({ data: await lifecycle.getEmployeeStateAt(uuid.parse(req.params.id), query.date) }); } catch (error) { next(error); } });
router.post('/:id/lifecycle/preflight', authorize('ADMIN'), async (req, res, next) => { try { const input = lifecyclePreflightSchema.parse(req.body); res.json({ data: await lifecycle.preflightEmployeeLifecycleAction({ employeeId: uuid.parse(req.params.id), ...input }) }); } catch (error) { next(error); } });
router.post('/:id/lifecycle', authorize('ADMIN'), async (req, res, next) => { try { const input = lifecycleActionSchema.parse(req.body); const result = await lifecycle.createEmployeeLifecycleEvent({ employeeId: uuid.parse(req.params.id), actorUserId: req.user.sub, ...input }); res.status(result.idempotent ? 200 : 201).json({ data: result }); } catch (error) { next(error); } });
router.get('/:id/change-requests', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { res.json(await changeRequests.listForEmployee({ employeeId: uuid.parse(req.params.id), actor: req.user })); } catch (error) { next(error); }
});
router.post('/:id/change-requests', authorize('MANAGER'), async (req, res, next) => {
  try { const input = employeeChangeDraftSchema.parse(req.body); res.status(201).json({ data: await changeRequests.createDraft({ employeeId: uuid.parse(req.params.id), actor: req.user, ...input }) }); } catch (error) { next(error); }
});
router.post('/:id/master-edit/preflight', authorize('ADMIN'), async (req, res, next) => {
  try { const input = masterEditPreflightSchema.parse(req.body); res.json({ data: await masterMutation.preflightEmployeeMasterMutation({ employeeId: uuid.parse(req.params.id), actorRole: 'ADMIN', fieldScope: 'ADMIN', ...input }) }); } catch (error) { next(error); }
});
router.get('/:id', async (req, res, next) => { try { res.json({ data: await employee.getById(uuid.parse(req.params.id), req.user.role) }); } catch (error) { next(error); } });
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { res.status(201).json({ data: await employee.create(employeeSchema.parse(req.body), req.user.sub) }); } catch (error) { next(error); } });
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    if (req.user.role === 'MANAGER') throw new HttpError(403, 'Manager Employee edits require a governed change request.', { code: 'EMPLOYEE_CHANGE_REQUEST_REQUIRED' });
    const input = masterEditSchema.parse(req.body);
    res.json({ data: await masterMutation.mutateEmployeeMaster({ employeeId: uuid.parse(req.params.id), actorUserId: req.user.sub, actorRole: req.user.role, fieldScope: 'ADMIN', ...input }) });
  } catch (error) { next(error); }
});
router.delete('/:id', authorize('ADMIN'), (_req, _res, next) => next(new HttpError(409, 'กรุณาใช้รายการลาออกในระบบวงจรพนักงาน', { code: 'LIFECYCLE_TERMINATION_REQUIRED' })));
module.exports = router;
