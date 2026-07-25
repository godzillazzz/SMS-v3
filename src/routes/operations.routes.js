const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');
const audit = require('../services/audit.service');
const { evaluateScheduleRules } = require('../services/schedule-rules.service');
const { buildAutoSchedulePlan, buildEmployeeAutoSchedulePlan, commitAutoSchedule, commitEmployeeAutoSchedule, monthBounds } = require('../services/auto-schedule.service');
const { buildApprovedScheduleWorkbook } = require('../services/schedule-export.service');
const HttpError = require('../utils/http-error');

const router = express.Router();
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100)
});
const uuid = z.string().uuid();
const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const licenseInputBase = z.object({ employeeId: uuid, licenseType: z.string().trim().min(1).max(150), licenseNumber: z.string().trim().min(1).max(255), issueDate: z.coerce.date(), expiryDate: z.coerce.date(), status: z.enum(['Active', 'Suspended', 'Revoked', 'Inactive']).default('Active'), documentUrl: z.string().url().max(2000).nullable().optional(), remark: nullableText(2000) });
const validLicenseDates = (value) => !value.issueDate || !value.expiryDate || value.issueDate <= value.expiryDate;
const licenseInput = licenseInputBase.refine(validLicenseDates, { message: 'Issue date must not be after expiry date.', path: ['expiryDate'] });
const licenseUpdateInput = licenseInputBase.omit({ employeeId: true }).partial().refine(validLicenseDates, { message: 'Issue date must not be after expiry date.', path: ['expiryDate'] });
const shiftTypeInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,12}$/),
  name: z.string().trim().min(1).max(150),
  startTime: nullableText(20), endTime: nullableText(20),
  hours: z.coerce.number().min(0).max(24),
  color: z.string().trim().toUpperCase().regex(/^#[0-9A-F]{6}$/).default('#2F80FF')
}).superRefine((value, context) => {
  if (value.hours > 0 && (!value.startTime || !value.endTime)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Working shifts require start and end times.' });
});
const booleanCoerce = z.union([z.boolean(), z.string().transform((val) => val === 'true' || val === '1'), z.number().transform((val) => val === 1)]).optional();
const shiftInput = z.object({ employeeId: uuid, shiftTypeId: uuid, workDate: z.coerce.date(), startTime: nullableText(20), endTime: nullableText(20), hours: z.coerce.number().min(0).max(24).optional(), remark: nullableText(2000), locked: booleanCoerce, licenseOverride: booleanCoerce, overrideReason: nullableText(2000) });
const leaveInput = z.object({ employeeId: uuid.optional(), leaveType: z.string().trim().min(1).max(100), startDate: z.coerce.date(), endDate: z.coerce.date(), dayCount: z.coerce.number().positive().max(366).optional(), reason: nullableText(2000) }).refine((value) => value.startDate <= value.endDate, { message: 'Start date must not be after end date.', path: ['endDate'] });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 12 } }).single('attachment');
const leaveUpload = (req, res, next) => upload(req, res, (error) => error ? next(new HttpError(400, error.code === 'LIMIT_FILE_SIZE' ? 'Attachment must not exceed 4 MB.' : 'Attachment upload is invalid.')) : next());
const allowedAttachmentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const safeRecord = (record, fields) => Object.fromEntries(fields.map((field) => [field, record[field]]));
const leaveQuotaField = (leaveType) => {
  const value = String(leaveType).toLowerCase();
  if (value.includes('ป่วย') || value.includes('sick')) return 'sickLeave';
  if (value.includes('กิจ') || value.includes('personal')) return 'personalLeave';
  if (value.includes('พักร้อน') || value.includes('vacation')) return 'vacationLeave';
  throw new HttpError(400, 'Unsupported leave type.');
};
const inclusiveDays = (startDate, endDate) => Math.floor((Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) - Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())) / 86400000) + 1;
const ensureLeaveAvailable = async (tx, employeeId, leaveType, requestedDays, excludeId) => {
  const field = leaveQuotaField(leaveType);
  const quota = await tx.leaveQuota.findFirst({ where: { employeeId } });
  const entitlement = Number(quota?.[field] ?? ({ sickLeave: 30, personalLeave: 6, vacationLeave: 10 })[field]);
  const approved = await tx.leaveRequest.aggregate({ where: { employeeId, status: 'APPROVED', leaveType, ...(excludeId && { id: { not: excludeId } }) }, _sum: { dayCount: true } });
  const remaining = entitlement - Number(approved._sum.dayCount || 0);
  if (requestedDays > remaining) throw new HttpError(400, `Insufficient leave quota. Remaining: ${remaining} day(s).`);
  return { entitlement, remaining };
};
const licenseStateForShift = async (tx, { employeeId, workDate, shiftCode, override, overrideReason, actorRole }) => {
  if (['OFF', 'AL'].includes(String(shiftCode).toUpperCase())) return { licenseStatus: 'NOT_REQUIRED', licenseExpiryDate: null, licenseOverride: false, overrideReason: null, overrideAt: null };
  const license = await tx.employeeLicense.findFirst({ where: { employeeId }, orderBy: { expiryDate: 'desc' } });
  const validStatus = ['active', 'valid'].includes(String(license?.status || '').toLowerCase());
  const validDate = license?.issueDate && license?.expiryDate && license.issueDate <= workDate && license.expiryDate >= workDate;
  if (validStatus && validDate) return { licenseStatus: 'VALID', licenseExpiryDate: license.expiryDate, licenseOverride: false, overrideReason: null, overrideAt: null };
  if (actorRole === 'ADMIN' && override && overrideReason) return { licenseStatus: 'OVERRIDDEN', licenseExpiryDate: license?.expiryDate || null, licenseOverride: true, overrideReason, overrideAt: new Date() };
  throw new HttpError(400, actorRole === 'ADMIN' ? 'Employee license is invalid. Provide an override reason or select OFF/AL.' : 'Employee license is invalid. Select OFF/AL or contact an administrator.');
};
const touchScheduleApproval = async (tx, workDate, actorUserId, changeType) => {
  const month = new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), 1));
  const latestApproved = await tx.scheduleApproval.findFirst({ where: { month, status: 'APPROVED' }, orderBy: { revision: 'desc' }, select: { revision: true } });
  const currentRevision = latestApproved ? latestApproved.revision : 1;
  const existingPending = await tx.scheduleApproval.findFirst({ where: { month, status: 'PENDING' }, orderBy: { updatedAt: 'desc' } });
  if (existingPending) {
    return tx.scheduleApproval.update({ where: { id: existingPending.id }, data: { changedByLegacyRef: actorUserId, changedAt: new Date(), changeType } });
  }
  return tx.scheduleApproval.create({ data: { month, status: 'PENDING', revision: currentRevision, changedByLegacyRef: actorUserId, changedAt: new Date(), changeType, approvedAt: null, approvedByLegacyRef: null, scheduleHash: null } });
};

const createLeaveRequest = async (tx, input, requestUser, file, substitute) => {
  const currentUser = await tx.user.findUniqueOrThrow({ where: { id: requestUser.sub }, select: { role: true, employeeId: true } });
  const employeeId = currentUser.role === 'VIEWER' ? currentUser.employeeId : input.employeeId;
  if (!employeeId) throw new HttpError(400, 'Employee is required.');
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const dayCount = inclusiveDays(input.startDate, input.endDate);
  const overlap = await tx.leaveRequest.findFirst({ where: { employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: input.endDate }, endDate: { gte: input.startDate } } });
  if (overlap) throw new HttpError(409, 'An overlapping leave request already exists.');
  await ensureLeaveAvailable(tx, employeeId, input.leaveType, dayCount);
  if (file && !allowedAttachmentTypes.has(file.mimetype)) throw new HttpError(415, 'Attachment must be PDF, JPEG, or PNG.');
  const safeFileName = file?.originalname.replace(/[\\/\0]/g, '_').slice(0, 255);
  const reasonText = input.reason || '-';
  const reason = substitute ? `[แทน: ${String(substitute).trim().slice(0, 255)}] ${reasonText}` : reasonText;
  const leave = await tx.leaveRequest.create({ data: { ...input, reason, employeeId, dayCount, sourceFingerprint: crypto.createHash('sha256').update(`v3:${crypto.randomUUID()}`).digest('hex'), requestedAt: new Date(), employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department, attachmentMigrationStatus: file ? 'STORED' : 'NONE', status: 'PENDING' } });
  if (file) {
    await tx.leaveAttachment.create({ data: { leaveRequestId: leave.id, fileName: safeFileName || 'attachment', mimeType: file.mimetype, sizeBytes: file.size, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'), content: file.buffer, uploadedByLegacyRef: requestUser.sub } });
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { attachmentUrl: `/api/v1/leave-requests/${leave.id}/attachment` } });
  }
  await audit.log({ actorUserId: requestUser.sub, action: 'CREATE', entityType: 'LeaveRequest', entityId: leave.id, metadata: { after: safeRecord(leave, ['employeeId', 'leaveType', 'startDate', 'endDate', 'dayCount', 'status']), attachment: file ? { present: true, mimeType: file.mimetype, sizeBytes: file.size } : { present: false } } }, tx);
  return {
    id: leave.id, employeeId: leave.employeeId, requestedAt: leave.requestedAt,
    employeeNameSnapshot: leave.employeeNameSnapshot, departmentSnapshot: leave.departmentSnapshot,
    leaveType: leave.leaveType, startDate: leave.startDate, endDate: leave.endDate,
    dayCount: leave.dayCount, reason: leave.reason, status: leave.status,
    attachmentUrl: file ? `/api/v1/leave-requests/${leave.id}/attachment` : null,
    attachment: file ? { fileName: safeFileName, mimeType: file.mimetype, sizeBytes: file.size } : null
  };
};

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

router.get('/dashboard', async (_req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const warningDate = new Date(now); warningDate.setUTCDate(warningDate.getUTCDate() + 60);
    const [totalEmployees, activeEmployees, totalShifts, monthShifts, pendingLeaves, pendingUsers, expiringLicenses, pendingApprovals, hourAggregate] = await prisma.$transaction([
      prisma.employee.count({ where: { deletedAt: null } }),
      prisma.employee.count({ where: { deletedAt: null, isActive: true } }),
      prisma.shiftAssignment.count(),
      prisma.shiftAssignment.count({ where: { workDate: { gte: monthStart, lt: nextMonth } } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      prisma.user.count({ where: { accountStatus: 'PENDING' } }),
      prisma.employeeLicense.count({ where: { expiryDate: { gte: now, lte: warningDate } } }),
      prisma.scheduleApproval.count({ where: { status: { in: ['DRAFT', 'PENDING'] } } }),
      prisma.shiftAssignment.aggregate({ _sum: { hours: true } })
    ]);
    res.json({ data: { totalEmployees, activeEmployees, totalShifts, monthShifts, totalHours: Number(hourAggregate._sum.hours || 0), pendingLeaves, pendingUsers, expiringLicenses, pendingApprovals } });
  } catch (error) { next(error); }
});

router.get('/licenses', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
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
router.post('/licenses', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const input = licenseInput.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.employeeLicense.findFirst({ where: { OR: [{ licenseNumber: { equals: input.licenseNumber, mode: 'insensitive' } }, { employeeId: input.employeeId, licenseType: { equals: input.licenseType, mode: 'insensitive' } }] } });
      if (duplicate) throw new HttpError(409, 'License number or employee license type already exists.');
      const license = await tx.employeeLicense.create({ data: { ...input, legacyLicenseId: `v3:${crypto.randomUUID()}`, documentMigrationStatus: 'NONE' } });
      await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'EmployeeLicense', entityId: license.id, metadata: { after: safeRecord(license, ['employeeId', 'licenseType', 'issueDate', 'expiryDate', 'status']) } }, tx);
      return license;
    });
    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.put('/licenses/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id); const input = licenseUpdateInput.parse(req.body);
    if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.');
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.employeeLicense.findUniqueOrThrow({ where: { id } });
      const issueDate = input.issueDate || before.issueDate;
      const expiryDate = input.expiryDate || before.expiryDate;
      if (issueDate > expiryDate) throw new HttpError(400, 'Issue date must not be after expiry date.');
      if (input.licenseNumber || input.licenseType) {
        const duplicate = await tx.employeeLicense.findFirst({ where: { id: { not: id }, OR: [...(input.licenseNumber ? [{ licenseNumber: { equals: input.licenseNumber, mode: 'insensitive' } }] : []), ...(input.licenseType ? [{ employeeId: before.employeeId, licenseType: { equals: input.licenseType, mode: 'insensitive' } }] : [])] } });
        if (duplicate) throw new HttpError(409, 'License number or employee license type already exists.');
      }
      const after = await tx.employeeLicense.update({ where: { id }, data: input });
      await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'EmployeeLicense', entityId: id, metadata: { before: safeRecord(before, ['licenseType', 'issueDate', 'expiryDate', 'status']), after: safeRecord(after, ['licenseType', 'issueDate', 'expiryDate', 'status']) } }, tx);
      return after;
    }); res.json({ data: result });
  } catch (error) { next(error); }
});
router.delete('/licenses/:id', authorize('ADMIN'), async (req, res, next) => {
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
router.post('/shift-types', authorize('ADMIN'), async (req, res, next) => {
  try {
    const input = shiftTypeInput.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.shiftType.create({ data: input });
      await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'ShiftType', entityId: created.id, metadata: { after: safeRecord(created, ['code', 'name', 'startTime', 'endTime', 'hours', 'color']) } }, tx);
      return created;
    });
    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.delete('/shift-types/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      const before = await tx.shiftType.findUniqueOrThrow({ where: { id } });
      if (['D', 'N', 'OFF', 'AL'].includes(before.code.toUpperCase())) throw new HttpError(400, `Core shift ${before.code} cannot be deleted.`);
      await tx.shiftType.delete({ where: { id } });
      await audit.log({ actorUserId: req.user.sub, action: 'DELETE', entityType: 'ShiftType', entityId: id, metadata: { before: safeRecord(before, ['code', 'name']) } }, tx);
    });
    res.status(204).send();
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
router.get('/schedule-calendar', async (req, res, next) => {
  try {
    const filters = z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
      department: z.string().trim().max(100).optional(),
      search: z.string().trim().max(100).optional()
    }).parse(req.query);
    const [year, monthIndex] = filters.month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(year, monthIndex - 1, 1));
    const nextMonth = new Date(Date.UTC(year, monthIndex, 1));
    const employeeWhere = {
      deletedAt: null,
      ...(filters.department && { department: filters.department }),
      ...(filters.search && { OR: [
        { employeeCode: { contains: filters.search, mode: 'insensitive' } },
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } }
      ] })
    };
    const [total, employees] = await prisma.$transaction([
      prisma.employee.count({ where: employeeWhere }),
      prisma.employee.findMany({
        where: employeeWhere,
        select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true },
        orderBy: [{ employeeCode: 'asc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize
      })
    ]);
    const employeeIds = employees.map((employee) => employee.id);
    const [shifts, approval] = await Promise.all([employeeIds.length ? prisma.shiftAssignment.findMany({
      where: { employeeId: { in: employeeIds }, workDate: { gte: monthStart, lt: nextMonth } },
      select: { id: true, employeeId: true, shiftTypeId: true, workDate: true, startTime: true, endTime: true, hours: true, remark: true, locked: true, licenseStatus: true, licenseOverride: true, shiftType: { select: { id: true, code: true, name: true, color: true } } },
      orderBy: [{ employeeId: 'asc' }, { workDate: 'asc' }]
    }) : Promise.resolve([]), prisma.scheduleApproval.findFirst({ where: { month: monthStart }, orderBy: { revision: 'desc' }, select: { id: true, status: true, revision: true, approvedAt: true, approvalNote: true } })]);
    const dates = Array.from({ length: Math.round((nextMonth - monthStart) / 86400000) }, (_, index) => new Date(Date.UTC(year, monthIndex - 1, index + 1)).toISOString().slice(0, 10));
    res.json({ data: { month: filters.month, dates, approval, employees: employees.map((employee) => ({ ...employee, shifts: shifts.filter((shift) => shift.employeeId === employee.id) })) }, meta: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } });
  } catch (error) { next(error); }
});
router.post('/schedule/auto-preview', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(req.body);
    res.json({ data: await buildAutoSchedulePlan(prisma, month) });
  } catch (error) { next(error); }
});
router.post('/schedule/auto-commit', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(req.body);
    res.json({ data: await commitAutoSchedule(prisma, month, req.user.sub) });
  } catch (error) { next(error); }
});
router.post('/schedule/employee-auto-preview', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { month, employeeId, startPhase, patternType } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), employeeId: uuid, startPhase: z.enum(['AUTO', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'OFF-D', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'OFF-N']).default('AUTO'), patternType: z.enum(['AUTO', 'SUPERVISOR', 'ROTATE']).default('AUTO') }).parse(req.body);
    res.json({ data: await buildEmployeeAutoSchedulePlan(prisma, month, employeeId, startPhase, patternType) });
  } catch (error) { next(error); }
});
router.post('/schedule/employee-auto-commit', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { month, employeeId, startPhase, patternType } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), employeeId: uuid, startPhase: z.enum(['AUTO', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'OFF-D', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'OFF-N']).default('AUTO'), patternType: z.enum(['AUTO', 'SUPERVISOR', 'ROTATE']).default('AUTO') }).parse(req.body);
    res.json({ data: await commitEmployeeAutoSchedule(prisma, month, employeeId, req.user.sub, startPhase, patternType) });
  } catch (error) { next(error); }
});
router.post('/schedule/export.xlsx', async (req, res, next) => {
  try {
    const input = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), scope: z.enum(['selected', 'all']).default('selected'), departments: z.array(z.string().trim().min(1).max(100)).max(100).default([]) }).parse(req.body);
    const { start, end } = monthBounds(input.month);
    const approval = await prisma.scheduleApproval.findFirst({ where: { month: start }, orderBy: { revision: 'desc' }, select: { id: true, status: true, revision: true, approvedAt: true } });
    if (!approval || approval.status !== 'APPROVED') {
      throw new HttpError(409, 'ตารางกะประจำเดือนนี้ต้องได้รับการอนุมัติ (Approve) จาก Admin ก่อนส่งออกไฟล์ Excel');
    }
    const available = await prisma.shiftAssignment.findMany({ where: { workDate: { gte: start, lt: end } }, distinct: ['departmentSnapshot'], select: { departmentSnapshot: true } });
    const availableDepartments = available.map((row) => row.departmentSnapshot).filter(Boolean).sort();
    const selectedDepartments = input.scope === 'all' || !input.departments.length ? availableDepartments : input.departments.filter((department) => availableDepartments.includes(department));
    if (!selectedDepartments.length) throw new HttpError(404, 'No schedule rows were found for the selected departments.');
    const shifts = await prisma.shiftAssignment.findMany({ where: { workDate: { gte: start, lt: end }, departmentSnapshot: { in: selectedDepartments } }, select: { employeeId: true, employeeNameSnapshot: true, departmentSnapshot: true, workDate: true, hours: true, shiftType: { select: { code: true } } }, orderBy: [{ departmentSnapshot: 'asc' }, { employeeNameSnapshot: 'asc' }, { workDate: 'asc' }] });
    if (!shifts.length) throw new HttpError(404, 'No schedule rows were found for export.');
    const employeeIds = [...new Set(shifts.map((shift) => shift.employeeId))];
    const [employees, shiftTypes, actor] = await Promise.all([
      prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, jobTitle: true } }),
      prisma.shiftType.findMany({ select: { code: true, name: true, startTime: true, endTime: true, hours: true }, orderBy: { code: 'asc' } }),
      prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { displayName: true } })
    ]);
    const workbook = buildApprovedScheduleWorkbook({ month: input.month, approval, departments: selectedDepartments, shifts, employees, shiftTypes, exportedBy: actor.displayName });
    await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'ScheduleExport', entityId: `${input.month}-r${approval.revision}`, metadata: { month: input.month, revision: approval.revision, departmentCount: selectedDepartments.length, rowCount: shifts.length, format: 'XLSX' } });
    const [year, monthNumber] = input.month.split('-');
    const fileName = `SMS-ตารางกะ-${Number(year) + 543}-${monthNumber}-R${approval.revision}.xlsx`;
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`, 'Content-Length': workbook.length, 'Cache-Control': 'private, no-store' });
    res.send(workbook);
  } catch (error) { next(error); }
});
router.post('/schedule/approve-month', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { month, approvalNote } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), approvalNote: nullableText(2000) }).parse(req.body);
    const [year, monthIndex] = month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(year, monthIndex - 1, 1));
    const result = await prisma.$transaction(async (tx) => {
      const lastApproved = await tx.scheduleApproval.findFirst({ where: { month: monthStart, status: 'APPROVED' }, orderBy: { revision: 'desc' }, select: { revision: true } });
      const nextRevision = (lastApproved?.revision || 0) + 1;
      const latestPending = await tx.scheduleApproval.findFirst({ where: { month: monthStart, status: 'PENDING' }, orderBy: { updatedAt: 'desc' } });
      let after;
      if (latestPending) {
        after = await tx.scheduleApproval.update({ where: { id: latestPending.id }, data: { status: 'APPROVED', revision: nextRevision, approvedAt: new Date(), approvedByLegacyRef: req.user.sub, ...(approvalNote !== undefined && { approvalNote }) } });
      } else {
        after = await tx.scheduleApproval.create({ data: { month: monthStart, status: 'APPROVED', revision: nextRevision, changedByLegacyRef: req.user.sub, changedAt: new Date(), approvedAt: new Date(), approvedByLegacyRef: req.user.sub, changeType: 'MANUAL_SCHEDULE', approvalNote: approvalNote || 'อนุมัติตารางกะประจำเดือน' } });
      }
      await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'ScheduleApproval', entityId: after.id, metadata: { after: safeRecord(after, ['status', 'revision', 'approvedAt']) } }, tx);
      return after;
    });
    res.json({ data: result });
  } catch (error) { next(error); }
});
router.post('/shifts', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const input = shiftInput.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const [employee, shiftType] = await Promise.all([tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } }), tx.shiftType.findUniqueOrThrow({ where: { id: input.shiftTypeId } })]);
      const licenseState = await licenseStateForShift(tx, { employeeId: input.employeeId, workDate: input.workDate, shiftCode: shiftType.code, override: input.licenseOverride, overrideReason: input.overrideReason, actorRole: req.user.role });
      const shift = await tx.shiftAssignment.create({ data: { ...input, startTime: input.startTime ?? shiftType.startTime, endTime: input.endTime ?? shiftType.endTime, hours: input.hours ?? shiftType.hours, ...licenseState, employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department, source: 'SMS_V3' } });
      await touchScheduleApproval(tx, shift.workDate, req.user.sub, 'CREATE_SHIFT');
      await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'ShiftAssignment', entityId: shift.id, metadata: { after: safeRecord(shift, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']) } }, tx);
      return { ...shift, shiftType: { code: shiftType.code, name: shiftType.name } };
    }); res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.put('/shifts/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id); const input = shiftInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.');
    const result = await prisma.$transaction(async (tx) => { const before = await tx.shiftAssignment.findUniqueOrThrow({ where: { id } }); const employeeId = input.employeeId || before.employeeId; const shiftTypeId = input.shiftTypeId || before.shiftTypeId; const workDate = input.workDate || before.workDate; const [employee, shiftType] = await Promise.all([tx.employee.findUniqueOrThrow({ where: { id: employeeId } }), tx.shiftType.findUniqueOrThrow({ where: { id: shiftTypeId } })]); const licenseState = await licenseStateForShift(tx, { employeeId, workDate, shiftCode: shiftType.code, override: input.licenseOverride, overrideReason: input.overrideReason, actorRole: req.user.role }); const shiftTypeChanged = Boolean(input.shiftTypeId && input.shiftTypeId !== before.shiftTypeId); const after = await tx.shiftAssignment.update({ where: { id }, data: { ...input, ...(shiftTypeChanged && input.startTime === undefined && { startTime: shiftType.startTime }), ...(shiftTypeChanged && input.endTime === undefined && { endTime: shiftType.endTime }), ...(shiftTypeChanged && input.hours === undefined && { hours: shiftType.hours }), ...(input.employeeId && { employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department }), ...licenseState } }); await touchScheduleApproval(tx, after.workDate, req.user.sub, 'UPDATE_SHIFT'); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'ShiftAssignment', entityId: id, metadata: { before: safeRecord(before, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']), after: safeRecord(after, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']) } }, tx); return after; }); res.json({ data: result });
  } catch (error) { next(error); }
});
router.delete('/shifts/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); await prisma.$transaction(async (tx) => { const before = await tx.shiftAssignment.findUnique({ where: { id } }); if (!before) return; await tx.shiftAssignment.delete({ where: { id } }); await touchScheduleApproval(tx, before.workDate, req.user.sub, 'DELETE_SHIFT'); await audit.log({ actorUserId: req.user.sub, action: 'DELETE', entityType: 'ShiftAssignment', entityId: id, metadata: { before: safeRecord(before, ['employeeId', 'shiftTypeId', 'workDate']) } }, tx); }); res.status(204).send(); } catch (error) { next(error); } });

router.get('/schedule-approvals', async (req, res, next) => {
  try {
    res.json(await paged(prisma.scheduleApproval, req.query, {
      select: { id: true, month: true, status: true, revision: true, changeType: true, changedAt: true, approvedAt: true, approvalNote: true },
      orderBy: [{ month: 'desc' }, { revision: 'desc' }]
    }));
  } catch (error) { next(error); }
});
router.put('/schedule-approvals/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const input = z.object({ status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']), approvalNote: nullableText(2000) }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.scheduleApproval.findUniqueOrThrow({ where: { id } });
      const after = await tx.scheduleApproval.update({ where: { id }, data: { ...input, approvedAt: input.status === 'APPROVED' ? new Date() : null, approvedByLegacyRef: input.status === 'APPROVED' ? req.user.sub : null } });
      await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'ScheduleApproval', entityId: id, metadata: { before: safeRecord(before, ['status', 'revision']), after: safeRecord(after, ['status', 'revision', 'approvedAt']) } }, tx);
      return after;
    });

    if (input.status === 'APPROVED') {
      const actor = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { displayName: true } });
      const monthStr = result.month ? new Date(result.month).toISOString().slice(0, 7) : '';
      if (monthStr) {
        const { notifyScheduleApproved } = require('../services/notification-email.service');
        notifyScheduleApproved({ month: monthStr, approvedBy: actor?.displayName || 'Admin', revision: result.revision }).catch(() => undefined);
      }
    }

    res.json({ data: result });
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
router.get('/rule-checks', async (req, res, next) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default(currentMonth) }).parse(req.query);
    const [year, monthIndex] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, monthIndex - 1, 1));
    const end = new Date(Date.UTC(year, monthIndex, 1));
    const [rules, employees, shifts, leaves] = await prisma.$transaction([
      prisma.schedulingRule.findMany({ orderBy: { ruleId: 'asc' }, select: { ruleId: true, name: true, value: true, unit: true, enabled: true } }),
      prisma.employee.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, employeeCode: true, displayName: true, department: true, jobTitle: true } }),
      prisma.shiftAssignment.findMany({ where: { workDate: { gte: start, lt: end } }, select: { employeeId: true, workDate: true, startTime: true, endTime: true, hours: true, remark: true, licenseStatus: true, shiftType: { select: { code: true } } } }),
      prisma.leaveRequest.findMany({ where: { status: 'APPROVED', startDate: { lt: end }, endDate: { gte: start } }, select: { employeeId: true, startDate: true, endDate: true } })
    ]);
    const dates = Array.from({ length: Math.round((end - start) / 86400000) }, (_, index) => new Date(Date.UTC(year, monthIndex - 1, index + 1)).toISOString().slice(0, 10));
    res.json({ data: { month, ...evaluateScheduleRules({ rules, employees, shifts, leaves, dates }) } });
  } catch (error) { next(error); }
});
router.put('/scheduling-rules/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ value: z.string().trim().min(1).max(1000).optional(), unit: nullableText(100), enabled: z.boolean().optional() }).parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.'); const result = await prisma.$transaction(async (tx) => { const before = await tx.schedulingRule.findUniqueOrThrow({ where: { id } }); const after = await tx.schedulingRule.update({ where: { id }, data: input }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'SchedulingRule', entityId: id, metadata: { before: safeRecord(before, ['value', 'unit', 'enabled']), after: safeRecord(after, ['value', 'unit', 'enabled']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });

router.get('/system-settings', authorize('ADMIN'), async (_req, res, next) => {
  try {
    const sensitive = /secret|token|password|credential|database|smtp|webhook|channel|access[_-]?key/i;
    const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' }, select: { key: true, value: true, description: true, updatedAt: true } });
    res.json({ data: settings.map((setting) => ({ key: setting.key, value: sensitive.test(setting.key) ? undefined : setting.value, configured: sensitive.test(setting.key) ? Boolean(setting.value) : undefined, description: setting.description, updatedAt: setting.updatedAt })) });
  } catch (error) { next(error); }
});
router.put('/system-settings/:key', authorize('ADMIN'), async (req, res, next) => {
  try {
    const key = z.string().trim().regex(/^[A-Z0-9_.-]{1,150}$/).parse(req.params.key);
    if (/secret|token|password|credential|database|smtp|webhook|channel|access[_-]?key/i.test(key)) throw new HttpError(400, 'Sensitive settings must be configured through the approved environment-variable workflow.');
    const input = z.object({ value: z.string().max(2000), description: nullableText(2000) }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key } });
      const after = await tx.systemSetting.upsert({ where: { key }, update: input, create: { key, ...input } });
      await audit.log({ actorUserId: req.user.sub, action: before ? 'UPDATE' : 'CREATE', entityType: 'SystemSetting', entityId: key, metadata: { key, configured: Boolean(after.value) } }, tx);
      return { key: after.key, value: after.value, description: after.description, updatedAt: after.updatedAt };
    });
    res.json({ data: result });
  } catch (error) { next(error); }
});

router.get('/leave-requests', async (req, res, next) => {
  try {
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { role: true, employeeId: true } });
    if (currentUser.role === 'VIEWER' && !currentUser.employeeId) throw new HttpError(403, 'This account is not linked to an employee.');
    const response = await paged(prisma.leaveRequest, req.query, {
      where: currentUser.role === 'VIEWER' ? { employeeId: currentUser.employeeId } : {},
      select: {
        id: true, employeeId: true, requestedAt: true, employeeNameSnapshot: true, departmentSnapshot: true,
        leaveType: true, startDate: true, endDate: true, dayCount: true, reason: true,
        attachmentUrl: true, attachmentMigrationStatus: true, status: true, approvedAt: true,
        attachment: { select: { fileName: true, mimeType: true, sizeBytes: true } }
      },
      orderBy: { requestedAt: 'desc' }
    });
    res.json({ ...response, data: response.data.map((row) => ({ ...row, attachmentUrl: row.attachment ? `/api/v1/leave-requests/${row.id}/attachment` : null })) });
  } catch (error) { next(error); }
});
router.get('/leave-summary', async (req, res, next) => {
  try {
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { employeeId: true } });
    if (!currentUser.employeeId) return res.json({ data: { linked: false } });
    const [quota, approved] = await Promise.all([
      prisma.leaveQuota.findFirst({ where: { employeeId: currentUser.employeeId }, select: { sickLeave: true, personalLeave: true, vacationLeave: true } }),
      prisma.leaveRequest.groupBy({ by: ['leaveType'], where: { employeeId: currentUser.employeeId, status: 'APPROVED' }, _sum: { dayCount: true } })
    ]);
    const entitlement = { sickLeave: Number(quota?.sickLeave ?? 30), personalLeave: Number(quota?.personalLeave ?? 6), vacationLeave: Number(quota?.vacationLeave ?? 10) };
    const used = { sickLeave: 0, personalLeave: 0, vacationLeave: 0 };
    approved.forEach((item) => { used[leaveQuotaField(item.leaveType)] += Number(item._sum.dayCount || 0); });
    res.json({ data: { linked: true, entitlement, used, remaining: { sickLeave: Math.max(0, entitlement.sickLeave - used.sickLeave), personalLeave: Math.max(0, entitlement.personalLeave - used.personalLeave), vacationLeave: Math.max(0, entitlement.vacationLeave - used.vacationLeave) } } });
  } catch (error) { next(error); }
});
router.post('/leave-requests', async (req, res, next) => {
  try {
    const input = leaveInput.parse(req.body);
    const result = await prisma.$transaction((tx) => createLeaveRequest(tx, input, req.user));
    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.post('/leave-requests/with-attachment', leaveUpload, async (req, res, next) => {
  try {
    const input = leaveInput.parse({ ...req.body, employeeId: req.body.employeeId || undefined });
    const substitute = z.string().trim().min(1).max(255).optional().parse(req.body.substitute || undefined);
    const result = await prisma.$transaction((tx) => createLeaveRequest(tx, input, req.user, req.file, substitute));
    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.get('/leave-requests/:id/attachment', async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { role: true, employeeId: true } });
    const leave = await prisma.leaveRequest.findUniqueOrThrow({ where: { id }, select: { employeeId: true, attachment: { select: { fileName: true, mimeType: true, sizeBytes: true, content: true } } } });
    if (currentUser.role === 'VIEWER' && currentUser.employeeId !== leave.employeeId) throw new HttpError(403, 'You do not have permission to view this attachment.');
    if (!leave.attachment) throw new HttpError(404, 'Attachment not found.');
    res.set({ 'Content-Type': leave.attachment.mimeType, 'Content-Length': leave.attachment.sizeBytes, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(leave.attachment.fileName)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(leave.attachment.content));
  } catch (error) { next(error); }
});
router.put('/leave-requests/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ status: z.enum(['APPROVED', 'REJECTED']), reason: nullableText(2000) }).parse(req.body); const result = await prisma.$transaction(async (tx) => { const before = await tx.leaveRequest.findUniqueOrThrow({ where: { id } }); if (before.status !== 'PENDING') throw new HttpError(409, 'This leave request has already been reviewed.'); if (req.user.role === 'MANAGER') { const today = new Date(); today.setUTCHours(0, 0, 0, 0); if (before.startDate < today) throw new HttpError(400, 'Managers cannot approve retroactive leave.'); } if (input.status === 'APPROVED') { await ensureLeaveAvailable(tx, before.employeeId, before.leaveType, Number(before.dayCount), before.id); const [employee, leaveShift] = await Promise.all([tx.employee.findUniqueOrThrow({ where: { id: before.employeeId } }), tx.shiftType.findUniqueOrThrow({ where: { code: 'AL' } })]); for (let date = new Date(before.startDate); date <= before.endDate; date.setUTCDate(date.getUTCDate() + 1)) { const workDate = new Date(date); await tx.shiftAssignment.upsert({ where: { workDate_employeeId: { workDate, employeeId: before.employeeId } }, update: { shiftTypeId: leaveShift.id, startTime: leaveShift.startTime, endTime: leaveShift.endTime, hours: leaveShift.hours, remark: `Leave: ${before.leaveType}`, licenseStatus: 'NOT_REQUIRED', licenseOverride: false }, create: { employeeId: before.employeeId, shiftTypeId: leaveShift.id, workDate, employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department, startTime: leaveShift.startTime, endTime: leaveShift.endTime, hours: leaveShift.hours, remark: `Leave: ${before.leaveType}`, source: 'LEAVE_APPROVAL', licenseStatus: 'NOT_REQUIRED' } }); } } const after = await tx.leaveRequest.update({ where: { id }, data: { ...input, approvedAt: new Date(), approvedByLegacyRef: req.user.sub } }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'LeaveRequest', entityId: id, metadata: { before: safeRecord(before, ['status']), after: safeRecord(after, ['status', 'approvedAt']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });

router.get('/leave-quotas', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    res.json(await paged(prisma.leaveQuota, req.query, {
      select: { id: true, employeeNameSnapshot: true, sickLeave: true, personalLeave: true, vacationLeave: true, matchStatus: true, updatedAt: true },
      orderBy: { employeeNameSnapshot: 'asc' }
    }));
  } catch (error) { next(error); }
});
router.put('/leave-quotas/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ sickLeave: z.coerce.number().min(0).max(999).optional(), personalLeave: z.coerce.number().min(0).max(999).optional(), vacationLeave: z.coerce.number().min(0).max(999).optional() }).parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.'); const result = await prisma.$transaction(async (tx) => { const before = await tx.leaveQuota.findUniqueOrThrow({ where: { id } }); const after = await tx.leaveQuota.update({ where: { id }, data: input }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'LeaveQuota', entityId: id, metadata: { before: safeRecord(before, ['sickLeave', 'personalLeave', 'vacationLeave']), after: safeRecord(after, ['sickLeave', 'personalLeave', 'vacationLeave']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });

router.put('/users/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ role: z.enum(['ADMIN', 'MANAGER', 'VIEWER']).optional(), department: nullableText(100), accountStatus: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED']).optional(), isActive: z.boolean().optional() }).parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.'); const result = await prisma.$transaction(async (tx) => { const before = await tx.user.findUniqueOrThrow({ where: { id } }); if (req.user.role === 'MANAGER') { if (before.accountStatus !== 'PENDING') throw new HttpError(403, 'Managers may approve pending accounts only.'); if (input.role && input.role !== 'VIEWER') throw new HttpError(403, 'Managers may assign the Viewer role only.'); if (input.accountStatus && input.accountStatus !== 'ACTIVE') throw new HttpError(403, 'Managers may only approve pending accounts.'); input.role = 'VIEWER'; input.accountStatus = 'ACTIVE'; input.isActive = true; } const after = await tx.user.update({ where: { id }, data: { ...input, approvedAt: input.accountStatus === 'ACTIVE' ? new Date() : undefined, tokenVersion: { increment: 1 } }, select: { id: true, legacyUserId: true, displayName: true, email: true, role: true, department: true, accountStatus: true, isActive: true, passwordResetRequired: true } }); await tx.refreshSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'User', entityId: id, metadata: { before: safeRecord(before, ['role', 'department', 'accountStatus', 'isActive']), after: safeRecord(after, ['role', 'department', 'accountStatus', 'isActive']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });
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

router.get('/reports/summary', authorize('ADMIN', 'MANAGER'), async (_req, res, next) => {
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
