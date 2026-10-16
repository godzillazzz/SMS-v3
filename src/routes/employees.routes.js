const express = require('express');
const { z } = require('zod');
const employee = require('../services/employee.service');
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
  isActive: z.boolean().optional()
});

router.use(authenticate);
const uuid = z.string().uuid();
const listSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().min(1).max(100).optional(), isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(), department: z.string().trim().min(1).max(100).optional() });
router.get('/', async (req, res, next) => { try { res.json(await employee.list(listSchema.parse(req.query), req.user.role)); } catch (error) { next(error); } });
router.get('/:id', async (req, res, next) => { try { res.json({ data: await employee.getById(uuid.parse(req.params.id), req.user.role) }); } catch (error) { next(error); } });
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { res.status(201).json({ data: await employee.create(employeeSchema.parse(req.body), req.user.sub) }); } catch (error) { next(error); } });
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const body = employeeSchema.partial().parse(req.body); if (Object.keys(body).length === 0) throw new HttpError(400, 'Update body cannot be empty.'); res.json({ data: await employee.update(uuid.parse(req.params.id), body, req.user.sub) }); } catch (error) { next(error); } });
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => { try { await employee.remove(uuid.parse(req.params.id), req.user.sub); res.status(204).send(); } catch (error) { next(error); } });
module.exports = router;
