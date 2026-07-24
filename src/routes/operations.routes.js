const express = require('express');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');

const router = express.Router();
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100)
});

const paged = async (model, query, options = {}) => {
  const { page, pageSize } = paging.parse(query);
  const where = options.where || {};
  const [total, data] = await prisma.$transaction([
    model.count({ where }),
    model.findMany({
      where,
      select: options.select,
      include: options.include,
      orderBy: options.orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
};

router.use(authenticate);

router.get('/licenses', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    res.json(await paged(prisma.employeeLicense, req.query, {
      select: {
        id: true, licenseType: true, licenseNumber: true, issueDate: true, expiryDate: true,
        status: true, documentMigrationStatus: true, remark: true,
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, department: true } }
      },
      orderBy: [{ expiryDate: 'asc' }, { employee: { lastName: 'asc' } }]
    }));
  } catch (error) { next(error); }
});

router.get('/shifts', async (req, res, next) => {
  try {
    const filters = z.object({
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(100),
      from: z.coerce.date().optional(), to: z.coerce.date().optional()
    }).parse(req.query);
    const where = filters.from || filters.to ? { workDate: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) } } : {};
    res.json(await paged(prisma.shiftAssignment, filters, {
      where,
      select: {
        id: true, workDate: true, employeeNameSnapshot: true, departmentSnapshot: true,
        startTime: true, endTime: true, hours: true, remark: true, locked: true,
        licenseStatus: true, shiftType: { select: { code: true, name: true, color: true } }
      },
      orderBy: [{ workDate: 'desc' }, { employeeNameSnapshot: 'asc' }]
    }));
  } catch (error) { next(error); }
});

router.get('/schedule-approvals', async (req, res, next) => {
  try {
    res.json(await paged(prisma.scheduleApproval, req.query, {
      select: { id: true, month: true, status: true, revision: true, changeType: true, changedAt: true, approvedAt: true, approvalNote: true },
      orderBy: [{ month: 'desc' }, { revision: 'desc' }]
    }));
  } catch (error) { next(error); }
});

router.get('/scheduling-rules', async (_req, res, next) => {
  try {
    const data = await prisma.schedulingRule.findMany({
      select: { id: true, ruleId: true, name: true, value: true, unit: true, enabled: true, updatedAt: true },
      orderBy: { name: 'asc' }
    });
    res.json({ data });
  } catch (error) { next(error); }
});

router.get('/leave-requests', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    res.json(await paged(prisma.leaveRequest, req.query, {
      select: {
        id: true, requestedAt: true, employeeNameSnapshot: true, departmentSnapshot: true,
        leaveType: true, startDate: true, endDate: true, dayCount: true, reason: true,
        attachmentMigrationStatus: true, status: true, approvedAt: true
      },
      orderBy: { requestedAt: 'desc' }
    }));
  } catch (error) { next(error); }
});

router.get('/leave-quotas', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    res.json(await paged(prisma.leaveQuota, req.query, {
      select: { id: true, employeeNameSnapshot: true, sickLeave: true, personalLeave: true, vacationLeave: true, matchStatus: true, updatedAt: true },
      orderBy: { employeeNameSnapshot: 'asc' }
    }));
  } catch (error) { next(error); }
});

router.get('/audit-events', authorize('ADMIN'), async (req, res, next) => {
  try {
    res.json(await paged(prisma.auditLog, req.query, {
      select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actor: { select: { displayName: true, role: true } } },
      orderBy: { createdAt: 'desc' }
    }));
  } catch (error) { next(error); }
});

router.get('/reports/summary', authorize('ADMIN', 'HR', 'MANAGER'), async (_req, res, next) => {
  try {
    const [employees, activeEmployees, licenses, shifts, leaveRequests, leaveQuotas, users] = await prisma.$transaction([
      prisma.employee.count({ where: { deletedAt: null } }),
      prisma.employee.count({ where: { deletedAt: null, isActive: true } }),
      prisma.employeeLicense.count(), prisma.shiftAssignment.count(), prisma.leaveRequest.count(),
      prisma.leaveQuota.count(), prisma.user.count()
    ]);
    res.json({ data: { employees, activeEmployees, licenses, shifts, leaveRequests, leaveQuotas, users } });
  } catch (error) { next(error); }
});

module.exports = router;
