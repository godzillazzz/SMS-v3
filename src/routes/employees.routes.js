const express = require('express');
const { z } = require('zod');
const employee = require('../services/employee.service');
const lifecycle = require('../services/employee-lifecycle.service');
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
  idempotencyKey: z.string().uuid(),
  acknowledgeWarnings: z.boolean().default(false)
});

router.use(authenticate);
const uuid = z.string().uuid();
const listSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().min(1).max(100).optional(), isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(), department: z.string().trim().min(1).max(100).optional() });
router.get('/', async (req, res, next) => { try { res.json(await employee.list(listSchema.parse(req.query), req.user.role)); } catch (error) { next(error); } });
router.get('/:id/lifecycle', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query); res.json(await lifecycle.getEmployeeLifecycleHistory(uuid.parse(req.params.id), query)); } catch (error) { next(error); } });
router.get('/:id/lifecycle/state', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query); res.json({ data: await lifecycle.getEmployeeStateAt(uuid.parse(req.params.id), query.date) }); } catch (error) { next(error); } });
router.post('/:id/lifecycle/preflight', authorize('ADMIN'), async (req, res, next) => { try { const input = lifecyclePreflightSchema.parse(req.body); res.json({ data: await lifecycle.preflightEmployeeLifecycleAction({ employeeId: uuid.parse(req.params.id), ...input }) }); } catch (error) { next(error); } });
router.post('/:id/lifecycle', authorize('ADMIN'), async (req, res, next) => { try { const input = lifecycleActionSchema.parse(req.body); const result = await lifecycle.createEmployeeLifecycleEvent({ employeeId: uuid.parse(req.params.id), actorUserId: req.user.sub, ...input }); res.status(result.idempotent ? 200 : 201).json({ data: result }); } catch (error) { next(error); } });
router.get('/:id', async (req, res, next) => { try { res.json({ data: await employee.getById(uuid.parse(req.params.id), req.user.role) }); } catch (error) { next(error); } });
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { res.status(201).json({ data: await employee.create(employeeSchema.parse(req.body), req.user.sub) }); } catch (error) { next(error); } });
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const controlled = ['firstName', 'lastName', 'department', 'jobTitle', 'isActive'].filter((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field)); if (controlled.length) throw new HttpError(409, 'กรุณาใช้การจัดการวงจรพนักงานสำหรับชื่อ หน่วยงาน ตำแหน่ง หรือสถานะ', { code: 'LIFECYCLE_ACTION_REQUIRED', fields: controlled }); const body = employeeSchema.pick({ employeeCode: true, email: true, phone: true, hiredAt: true, skill: true }).partial().parse(req.body); if (Object.keys(body).length === 0) throw new HttpError(400, 'Update body cannot be empty.'); res.json({ data: await employee.update(uuid.parse(req.params.id), body, req.user.sub) }); } catch (error) { next(error); } });
router.delete('/:id', authorize('ADMIN'), (_req, _res, next) => next(new HttpError(409, 'กรุณาใช้รายการลาออกในระบบวงจรพนักงาน', { code: 'LIFECYCLE_TERMINATION_REQUIRED' })));
module.exports = router;
