const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');
const audit = require('../services/audit.service');
const HttpError = require('../utils/http-error');

const router = express.Router();
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100)
});
const uuid = z.string().uuid();
const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const licenseInput = z.object({ employeeId: uuid, licenseType: z.string().trim().min(1).max(150), licenseNumber: nullableText(255), issueDate: z.coerce.date().nullable().optional(), expiryDate: z.coerce.date().nullable().optional(), status: nullableText(100), remark: nullableText(2000) });
const shiftInput = z.object({ employeeId: uuid, shiftTypeId: uuid, workDate: z.coerce.date(), startTime: nullableText(20), endTime: nullableText(20), hours: z.coerce.number().min(0).max(24), remark: nullableText(2000), locked: z.boolean().optional() });
const leaveInput = z.object({ employeeId: uuid, leaveType: z.string().trim().min(1).max(100), startDate: z.coerce.date(), endDate: z.coerce.date(), dayCount: z.coerce.number().positive().max(366), reason: nullableText(2000) });
const safeRecord = (record, fields) => Object.fromEntries(fields.map((field) => [field, record[field]]));

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
router.post('/licenses', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    const input = licenseInput.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const license = await tx.employeeLicense.create({ data: { ...input, legacyLicenseId: `v3:${crypto.randomUUID()}`, documentMigrationStatus: 'NONE' } });
      await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'EmployeeLicense', entityId: license.id, metadata: { after: safeRecord(license, ['employeeId', 'licenseType', 'issueDate', 'expiryDate', 'status']) } }, tx);
      return license;
    });
    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.put('/licenses/:id', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id); const input = licenseInput.omit({ employeeId: true }).partial().parse(req.body);
    if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.');
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.employeeLicense.findUniqueOrThrow({ where: { id } });
      const after = await tx.employeeLicense.update({ where: { id }, data: input });
      await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'EmployeeLicense', entityId: id, metadata: { before: safeRecord(before, ['licenseType', 'issueDate', 'expiryDate', 'status']), after: safeRecord(after, ['licenseType', 'issueDate', 'expiryDate', 'status']) } }, tx);
      return after;
    }); res.json({ data: result });
  } catch (error) { next(error); }
});
router.delete('/licenses/:id', authorize('ADMIN', 'HR'), async (req, res, next) => {
  try { const id = uuid.parse(req.params.id); await prisma.$transaction(async (tx) => { const before = await tx.employeeLicense.delete({ where: { id } }); await audit.log({ actorUserId: req.user.sub, action: 'DELETE', entityType: 'EmployeeLicense', entityId: id, metadata: { before: safeRecord(before, ['employeeId', 'licenseType', 'expiryDate', 'status']) } }, tx); }); res.status(204).send(); } catch (error) { next(error); }
});

router.get('/shift-types', async (_req, res, next) => {
  try {
    const data = await prisma.shiftType.findMany({
      select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, color: true },
      orderBy: { code: 'asc' }
    });
    res.json({ data });
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
        id: true, employeeId: true, shiftTypeId: true, workDate: true, employeeNameSnapshot: true, departmentSnapshot: true,
        startTime: true, endTime: true, hours: true, remark: true, locked: true,
        licenseStatus: true, shiftType: { select: { id: true, code: true, name: true, color: true } }
      },
      orderBy: [{ workDate: 'desc' }, { employeeNameSnapshot: 'asc' }]
    }));
  } catch (error) { next(error); }
});
router.post('/shifts', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    const input = shiftInput.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const [employee, shiftType] = await Promise.all([tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } }), tx.shiftType.findUniqueOrThrow({ where: { id: input.shiftTypeId } })]);
      const shift = await tx.shiftAssignment.create({ data: { ...input, employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department, source: 'SMS_V3' } });
      await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'ShiftAssignment', entityId: shift.id, metadata: { after: safeRecord(shift, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']) } }, tx);
      return { ...shift, shiftType: { code: shiftType.code, name: shiftType.name } };
    }); res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.put('/shifts/:id', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id); const input = shiftInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.');
    const result = await prisma.$transaction(async (tx) => { const before = await tx.shiftAssignment.findUniqueOrThrow({ where: { id } }); const after = await tx.shiftAssignment.update({ where: { id }, data: input }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'ShiftAssignment', entityId: id, metadata: { before: safeRecord(before, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']), after: safeRecord(after, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']) } }, tx); return after; }); res.json({ data: result });
  } catch (error) { next(error); }
});
router.delete('/shifts/:id', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); await prisma.$transaction(async (tx) => { const before = await tx.shiftAssignment.delete({ where: { id } }); await audit.log({ actorUserId: req.user.sub, action: 'DELETE', entityType: 'ShiftAssignment', entityId: id, metadata: { before: safeRecord(before, ['employeeId', 'shiftTypeId', 'workDate']) } }, tx); }); res.status(204).send(); } catch (error) { next(error); } });

router.get('/schedule-approvals', async (req, res, next) => {
  try {
    res.json(await paged(prisma.scheduleApproval, req.query, {
      select: { id: true, month: true, status: true, revision: true, changeType: true, changedAt: true, approvedAt: true, approvalNote: true },
      orderBy: [{ month: 'desc' }, { revision: 'desc' }]
    }));
  } catch (error) { next(error); }
});
router.put('/schedule-approvals/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try { const id = uuid.parse(req.params.id); const input = z.object({ status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']), approvalNote: nullableText(2000) }).parse(req.body); const result = await prisma.$transaction(async (tx) => { const before = await tx.scheduleApproval.findUniqueOrThrow({ where: { id } }); const after = await tx.scheduleApproval.update({ where: { id }, data: { ...input, approvedAt: input.status === 'APPROVED' ? new Date() : null } }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'ScheduleApproval', entityId: id, metadata: { before: safeRecord(before, ['status', 'revision']), after: safeRecord(after, ['status', 'revision', 'approvedAt']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); }
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
router.put('/scheduling-rules/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ value: z.string().trim().min(1).max(1000).optional(), unit: nullableText(100), enabled: z.boolean().optional() }).parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.'); const result = await prisma.$transaction(async (tx) => { const before = await tx.schedulingRule.findUniqueOrThrow({ where: { id } }); const after = await tx.schedulingRule.update({ where: { id }, data: input }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'SchedulingRule', entityId: id, metadata: { before: safeRecord(before, ['value', 'unit', 'enabled']), after: safeRecord(after, ['value', 'unit', 'enabled']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });

router.get('/leave-requests', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    res.json(await paged(prisma.leaveRequest, req.query, {
      select: {
        id: true, employeeId: true, requestedAt: true, employeeNameSnapshot: true, departmentSnapshot: true,
        leaveType: true, startDate: true, endDate: true, dayCount: true, reason: true,
        attachmentMigrationStatus: true, status: true, approvedAt: true
      },
      orderBy: { requestedAt: 'desc' }
    }));
  } catch (error) { next(error); }
});
router.post('/leave-requests', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => { try { const input = leaveInput.parse(req.body); const result = await prisma.$transaction(async (tx) => { const employee = await tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } }); const leave = await tx.leaveRequest.create({ data: { ...input, sourceFingerprint: crypto.createHash('sha256').update(`v3:${crypto.randomUUID()}`).digest('hex'), requestedAt: new Date(), employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department, attachmentMigrationStatus: 'NONE', status: 'PENDING' } }); await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'LeaveRequest', entityId: leave.id, metadata: { after: safeRecord(leave, ['employeeId', 'leaveType', 'startDate', 'endDate', 'dayCount', 'status']) } }, tx); return leave; }); res.status(201).json({ data: result }); } catch (error) { next(error); } });
router.put('/leave-requests/:id', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']), reason: nullableText(2000) }).parse(req.body); const result = await prisma.$transaction(async (tx) => { const before = await tx.leaveRequest.findUniqueOrThrow({ where: { id } }); const after = await tx.leaveRequest.update({ where: { id }, data: { ...input, approvedAt: input.status === 'APPROVED' ? new Date() : null } }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'LeaveRequest', entityId: id, metadata: { before: safeRecord(before, ['status']), after: safeRecord(after, ['status', 'approvedAt']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });

router.get('/leave-quotas', authorize('ADMIN', 'HR', 'MANAGER'), async (req, res, next) => {
  try {
    res.json(await paged(prisma.leaveQuota, req.query, {
      select: { id: true, employeeNameSnapshot: true, sickLeave: true, personalLeave: true, vacationLeave: true, matchStatus: true, updatedAt: true },
      orderBy: { employeeNameSnapshot: 'asc' }
    }));
  } catch (error) { next(error); }
});
router.put('/leave-quotas/:id', authorize('ADMIN', 'HR'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ sickLeave: z.coerce.number().min(0).max(999).optional(), personalLeave: z.coerce.number().min(0).max(999).optional(), vacationLeave: z.coerce.number().min(0).max(999).optional() }).parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.'); const result = await prisma.$transaction(async (tx) => { const before = await tx.leaveQuota.findUniqueOrThrow({ where: { id } }); const after = await tx.leaveQuota.update({ where: { id }, data: input }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'LeaveQuota', entityId: id, metadata: { before: safeRecord(before, ['sickLeave', 'personalLeave', 'vacationLeave']), after: safeRecord(after, ['sickLeave', 'personalLeave', 'vacationLeave']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });

router.put('/users/:id', authorize('ADMIN'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ role: z.enum(['ADMIN', 'HR', 'USER', 'MANAGER', 'VIEWER']).optional(), accountStatus: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED']).optional(), isActive: z.boolean().optional() }).parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.'); const result = await prisma.$transaction(async (tx) => { const before = await tx.user.findUniqueOrThrow({ where: { id } }); const after = await tx.user.update({ where: { id }, data: { ...input, tokenVersion: { increment: 1 } }, select: { id: true, displayName: true, email: true, role: true, accountStatus: true, isActive: true, passwordResetRequired: true } }); await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'User', entityId: id, metadata: { before: safeRecord(before, ['role', 'accountStatus', 'isActive']), after: safeRecord(after, ['role', 'accountStatus', 'isActive']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });
router.post('/users/:id/reset-password', authorize('ADMIN'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const { newPassword } = z.object({ newPassword: z.string().min(8).max(128) }).parse(req.body); const passwordHash = await bcrypt.hash(newPassword, 12); const result = await prisma.$transaction(async (tx) => { const after = await tx.user.update({ where: { id }, data: { passwordHash, passwordResetRequired: false, failedLoginCount: 0, tokenVersion: { increment: 1 } }, select: { id: true, displayName: true, email: true, role: true, accountStatus: true, isActive: true, passwordResetRequired: true } }); await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'UserCredential', entityId: id, metadata: { passwordResetRequired: false, sessionsRevoked: true } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });

router.get('/audit-events', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { page, pageSize } = paging.parse(req.query);
    const take = page * pageSize;
    const [appCount, userCount, licenseCount, appEvents, userEvents, licenseEvents] = await Promise.all([
      prisma.auditLog.count(), prisma.legacyUserAuditEvent.count(), prisma.legacyLicenseAuditEvent.count(),
      prisma.auditLog.findMany({ take, orderBy: { createdAt: 'desc' }, select: { id: true, action: true, entityType: true, createdAt: true, actor: { select: { displayName: true, role: true } } } }),
      prisma.legacyUserAuditEvent.findMany({ take, orderBy: { occurredAt: 'desc' }, select: { id: true, action: true, occurredAt: true, roleSnapshot: true } }),
      prisma.legacyLicenseAuditEvent.findMany({ take, orderBy: { occurredAt: 'desc' }, select: { id: true, action: true, occurredAt: true, licenseStatus: true } })
    ]);
    const normalized = [
      ...appEvents.map((event) => ({ ...event, createdAt: event.createdAt })),
      ...userEvents.map((event) => ({ id: event.id, action: event.action, entityType: 'LegacyUser', createdAt: event.occurredAt, actor: event.roleSnapshot ? { displayName: event.roleSnapshot, role: 'LEGACY' } : null })),
      ...licenseEvents.map((event) => ({ id: event.id, action: event.action, entityType: 'LegacyLicense', createdAt: event.occurredAt, actor: event.licenseStatus ? { displayName: event.licenseStatus, role: 'LEGACY' } : null }))
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = appCount + userCount + licenseCount;
    res.json({ data: normalized.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
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
