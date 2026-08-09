const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { authenticate, authorize } = require('../middlewares/authenticate');
const audit = require('../services/audit.service');
const userAccess = require('../services/user-access.service');
const { evaluateScheduleRules } = require('../services/schedule-rules.service');
const { buildAutoSchedulePlan, buildEmployeeAutoSchedulePlan, commitAutoSchedule, commitEmployeeAutoSchedule, monthBounds } = require('../services/auto-schedule.service');
const { buildApprovedScheduleWorkbook } = require('../services/schedule-export.service');
const { reconcileEmployeeLicenseSchedules, reconcileAllEmployeeLicenseSchedules } = require('../services/license-schedule-reconciliation.service');
const { licenseStateForWorkDate } = require('../services/license-state.service');
const { updateScheduleApprovalState, approveMonthlySchedule } = require('../services/schedule.service');
const { linkLeaveQuota } = require('../services/leave-quota-link.service');
const { createSupabaseLicenseDocumentStorage } = require('../services/license-document-storage.service');
const { createLicenseDocumentService } = require('../services/license-document.service');
const { cleanupDueLicenseDocuments, expireDueLicenseDocuments } = require('../services/license-document-retention.service');
const { normalizeLicenseNumber } = require('../services/license-document.service');
const { parseLeaveMonth, leaveMonthWhere } = require('../utils/leave-month-filter');
const { getDashboardSummary } = require('../services/dashboard.service');
const HttpError = require('../utils/http-error');

const router = express.Router();
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(100)
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
const leaveInput = z.object({ employeeId: uuid.optional(), leaveType: z.string().trim().min(1).max(100), startDate: z.coerce.date(), endDate: z.coerce.date(), dayCount: z.coerce.number().positive().max(366).optional(), substitute: z.string().trim().min(1).max(255), reason: nullableText(2000) }).refine((value) => value.startDate <= value.endDate, { message: 'Start date must not be after end date.', path: ['endDate'] });
const leaveListQuery = paging.extend({ status: z.string().trim().min(1).max(100).optional(), employeeId: uuid.optional(), department: z.string().trim().max(100).optional(), search: z.string().trim().max(255).optional(), year: z.coerce.number().int().optional(), month: z.coerce.number().int().optional() });
const dashboardDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const date = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value; });
const dashboardMonth = z.string().regex(/^\d{4}-\d{2}$/).refine((value) => { const date = new Date(`${value}-01T00:00:00.000Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 7) === value; });
const dashboardQuery = z.object({
  date: dashboardDate.optional(),
  month: dashboardMonth.optional(),
  department: z.string().trim().max(100).optional()
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 12 } }).single('attachment');
const leaveUpload = (req, res, next) => upload(req, res, (error) => error ? next(new HttpError(400, error.code === 'LIMIT_FILE_SIZE' ? 'Attachment must not exceed 4 MB.' : 'Attachment upload is invalid.')) : next());
const licenseUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 12 } }).single('document');
const licenseDocumentUpload = (req, res, next) => licenseUpload(req, res, (error) => error ? next(new HttpError(400, error.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ต้องมีขนาดไม่เกิน 2 MB' : 'License document upload is invalid.')) : next());
const allowedAttachmentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const authorizedLicenseReconciliationCron = (req) => {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.get('authorization') === `Bearer ${secret}`;
};
const safeRecord = (record, fields) => Object.fromEntries(fields.map((field) => [field, record[field]]));
const normalizeLeaveType = (leaveType) => {
  const value = String(leaveType).trim().toLowerCase();
  if (value.includes('ป่วย') || value.includes('sick')) return 'SICK';
  if (value.includes('กิจ') || value.includes('personal')) return 'PERSONAL';
  if (value.includes('พักร้อน') || value.includes('vacation')) return 'VACATION';
  throw new HttpError(400, 'Unsupported leave type.');
};
const leaveQuotaField = (leaveType) => {
  const value = normalizeLeaveType(leaveType);
  if (value === 'SICK') return 'sickLeave';
  if (value === 'PERSONAL') return 'personalLeave';
  return 'vacationLeave';
};
const inclusiveDays = (startDate, endDate) => Math.floor((Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) - Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())) / 86400000) + 1;
const positionText = (employee) => String(employee?.jobTitle || '').toLowerCase();
const isSupervisorPosition = (employee) => /supervisor|หัวหน้า|ซุปเปอร์ไวเซอร์/.test(positionText(employee));
const isManagerPosition = (employee) => /manager|ผู้จัดการ/.test(positionText(employee));
const licenseStorage = createSupabaseLicenseDocumentStorage();
const licenseDocuments = createLicenseDocumentService({ prisma, storage: licenseStorage, audit, reconcileSchedules: reconcileEmployeeLicenseSchedules });
const getTodayBangkokUTC = () => {
  const now = new Date();
  const bangkokTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  const year = bangkokTime.getUTCFullYear();
  const month = bangkokTime.getUTCMonth();
  const day = bangkokTime.getUTCDate();
  return new Date(Date.UTC(year, month, day));
};
const checkIsRetroactive = (dateInput) => {
  if (!dateInput) return false;
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return false;
  const bkkDate = new Date(d.getTime() + (7 * 60 * 60 * 1000));
  const targetUTC = new Date(Date.UTC(bkkDate.getUTCFullYear(), bkkDate.getUTCMonth(), bkkDate.getUTCDate()));
  return targetUTC < getTodayBangkokUTC();
};
const hasSupervisorApprovalLevel = (user) => user.role === 'ADMIN' || isSupervisorPosition(user.employee) || isManagerPosition(user.employee);
const ensureLeaveApprovalAllowed = async (tx, employeeId, requestUser, options = {}) => {
  if (requestUser.role === 'ADMIN') return;
  // MANAGER has global scope — no department comparison is performed.
  // Position-level escalation rules (supervisor/manager leaves require higher approval)
  // are retained for non-retroactive leaves.
  const [leaveEmployee, approver] = await Promise.all([
    tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { jobTitle: true, department: true } }),
    tx.user.findUniqueOrThrow({ where: { id: requestUser.sub }, select: { role: true, employee: { select: { jobTitle: true, department: true } } } })
  ]);
  if (!options.isRetroactive) {
    if (isSupervisorPosition(leaveEmployee)) throw new HttpError(403, 'Supervisor leave requests require Admin approval.');
    if (isManagerPosition(leaveEmployee) && !hasSupervisorApprovalLevel(approver)) throw new HttpError(403, 'Manager leave requests require Supervisor-level approval or higher.');
  }
};
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
  const licenses = await tx.employeeLicense.findMany({ where: { employeeId }, select: { status: true, issueDate: true, expiryDate: true } });
  const state = licenseStateForWorkDate(licenses, workDate);
  if (state.valid) return { licenseStatus: 'VALID', licenseExpiryDate: state.expiryDate, licenseOverride: false, overrideReason: null, overrideAt: null };
  if (actorRole === 'ADMIN' && override && String(overrideReason || '').trim().length >= 5) return { licenseStatus: 'OVERRIDDEN', licenseExpiryDate: state.expiryDate, licenseOverride: true, overrideReason: String(overrideReason).trim(), overrideAt: new Date() };
  throw new HttpError(400, actorRole === 'ADMIN' ? 'License Block: employee license is invalid for this date. Select OFF/AL or provide an Admin override reason.' : 'License Block: employee license is invalid for this date. Only an Admin may override this restriction.');
};
const touchScheduleApproval = async (tx, workDate, actorUserId, changeType, options = {}) => {
  return updateScheduleApprovalState(tx, { workDate, actorUserId, changeType, ...options });
};

const createLeaveRequest = async (tx, input, requestUser, file, substitute) => {
  const currentUser = await tx.user.findUniqueOrThrow({ where: { id: requestUser.sub }, select: { role: true, employeeId: true } });
  const employeeId = currentUser.role === 'VIEWER' ? currentUser.employeeId : input.employeeId;
  if (!employeeId) throw new HttpError(400, 'Employee is required.');
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const leaveType = normalizeLeaveType(input.leaveType);
  const dayCount = inclusiveDays(input.startDate, input.endDate);

  const isRetroactive = checkIsRetroactive(input.startDate);

  if (isRetroactive) {
    if (currentUser.role === 'VIEWER') {
      throw new HttpError(400, 'พนักงานทั่วไปไม่สามารถบันทึกการลาย้อนหลังได้');
    }
    if (currentUser.role === 'MANAGER' && employeeId === currentUser.employeeId) {
      throw new HttpError(400, 'ผู้จัดการไม่สามารถบันทึกการลาย้อนหลังให้ตนเองได้');
    }
  }

  const onBehalfOf = employeeId !== currentUser.employeeId;
  // MANAGER global scope: department check is removed for on-behalf creation.
  // Retroactive guard (manager cannot key retro for themselves) is enforced above (line 152).
  if (currentUser.role === 'MANAGER' && onBehalfOf) {
    await ensureLeaveApprovalAllowed(tx, employeeId, requestUser, { isRetroactive });
  }

  const overlap = await tx.leaveRequest.findFirst({ where: { employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: input.endDate }, endDate: { gte: input.startDate } } });
  if (overlap) throw new HttpError(409, 'An overlapping leave request already exists.');
  await ensureLeaveAvailable(tx, employeeId, leaveType, dayCount);
  if (file && !allowedAttachmentTypes.has(file.mimetype)) throw new HttpError(415, 'Attachment must be PDF, JPEG, or PNG.');
  if (leaveType === 'SICK' && dayCount > 3 && !file) throw new HttpError(400, 'Sick leave longer than 3 days requires an attachment.');
  const safeFileName = file?.originalname.replace(/[\\/\0]/g, '_').slice(0, 255);
  const substituteText = String(substitute ?? input.substitute ?? '').trim();
  if (!substituteText) throw new HttpError(400, 'Substitute is required.');

  const reasonText = String(input.reason || '').trim();
  if (isRetroactive && !reasonText) {
    throw new HttpError(400, 'ต้องระบุเหตุผลในการบันทึกการลาย้อนหลัง');
  }
  const prefix = onBehalfOf ? `[บันทึกแทนโดย: ${currentUser.role}] ` : '';
  const reason = `${prefix}[แทน: ${substituteText.slice(0, 255)}] ${reasonText || '-'}`;

  const leave = await tx.leaveRequest.create({ data: { employeeId, createdByUserId: requestUser.sub, leaveType, startDate: input.startDate, endDate: input.endDate, reason, dayCount, sourceFingerprint: crypto.createHash('sha256').update(`v3:${crypto.randomUUID()}`).digest('hex'), requestedAt: new Date(), employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department, attachmentMigrationStatus: file ? 'STORED' : 'NONE', status: 'PENDING' } });
  if (file) {
    await tx.leaveAttachment.create({ data: { leaveRequestId: leave.id, fileName: safeFileName || 'attachment', mimeType: file.mimetype, sizeBytes: file.size, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'), content: file.buffer, uploadedByLegacyRef: requestUser.sub } });
    await tx.leaveRequest.update({ where: { id: leave.id }, data: { attachmentUrl: `/api/v1/leave-requests/${leave.id}/attachment` } });
  }
  await audit.log({ actorUserId: requestUser.sub, action: 'CREATE', entityType: 'LeaveRequest', entityId: leave.id, metadata: { after: safeRecord(leave, ['employeeId', 'leaveType', 'startDate', 'endDate', 'dayCount', 'status']), attachment: file ? { present: true, mimeType: file.mimetype, sizeBytes: file.size } : { present: false }, isRetroactive, onBehalfOf } }, tx);
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
const sortByEmployeeCode = (left, right) => {
  const codeCompare = String(left.employee?.employeeCode || '').localeCompare(String(right.employee?.employeeCode || ''), undefined, { numeric: true, sensitivity: 'base' });
  if (codeCompare !== 0) return codeCompare;
  return new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime();
};

router.use(authenticate);

router.get('/dashboard', async (req, res, next) => {
  try {
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { role: true, employeeId: true, department: true } });
    const parsedQuery = dashboardQuery.safeParse(req.query);
    if (!parsedQuery.success) throw new HttpError(400, 'Dashboard filter is invalid.');
    res.json({ data: await getDashboardSummary({ requestUser: currentUser, filters: parsedQuery.data }) });
  } catch (error) { next(error); }
});
router.post('/internal/license-reconciliation', async (req, res, next) => {
  try {
    if (!authorizedLicenseReconciliationCron(req)) throw new HttpError(401, 'Unauthorized.');
    const schedule = await reconcileAllEmployeeLicenseSchedules(prisma);
    const expired = await expireDueLicenseDocuments({ prisma, storage: licenseStorage, audit });
    const cleanup = await cleanupDueLicenseDocuments({ prisma, storage: licenseStorage });
    res.json({ data: { schedule, expired, cleanup } });
  } catch (error) { next(error); }
});

router.get('/licenses', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { page, pageSize } = paging.parse(req.query);
    const [total, licenses] = await prisma.$transaction([
      prisma.employeeLicense.count(),
      prisma.employeeLicense.findMany({
        select: {
          id: true, employeeId: true, licenseType: true, licenseNumber: true, issueDate: true, expiryDate: true,
          status: true, documentMigrationStatus: true, remark: true,
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, department: true } }
        }
      })
    ]);
    const data = licenses.sort(sortByEmployeeCode).slice((page - 1) * pageSize, page * pageSize);
    res.json({ data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  } catch (error) { next(error); }
});
router.post('/licenses', authorize('ADMIN'), async (req, res, next) => {
  try {
    const input = licenseInput.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.employeeLicense.findFirst({ where: { licenseNumber: { equals: input.licenseNumber, mode: 'insensitive' } } });
      if (duplicate) throw new HttpError(409, 'License number already exists.');
      const license = await tx.employeeLicense.create({ data: { ...input, legacyLicenseId: `v3:${crypto.randomUUID()}`, documentMigrationStatus: 'NONE' } });
      await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'EmployeeLicense', entityId: license.id, metadata: { after: safeRecord(license, ['employeeId', 'licenseType', 'issueDate', 'expiryDate', 'status']) } }, tx);
      await reconcileEmployeeLicenseSchedules(tx, license.employeeId, req.user.sub);
      return license;
    });
    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.put('/licenses/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id); const input = licenseUpdateInput.parse(req.body);
    if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.');
    if (['licenseType', 'licenseNumber', 'issueDate', 'expiryDate', 'status', 'documentUrl'].some((field) => Object.prototype.hasOwnProperty.call(input, field))) {
      throw new HttpError(409, 'License number and dates require a new document for review.');
    }
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.employeeLicense.findUniqueOrThrow({ where: { id } });
      const issueDate = input.issueDate || before.issueDate;
      const expiryDate = input.expiryDate || before.expiryDate;
      if (issueDate > expiryDate) throw new HttpError(400, 'Issue date must not be after expiry date.');
      if (input.licenseNumber) {
        const duplicate = await tx.employeeLicense.findFirst({ where: { id: { not: id }, licenseNumber: { equals: input.licenseNumber, mode: 'insensitive' } } });
        if (duplicate) throw new HttpError(409, 'License number already exists.');
      }
      const after = await tx.employeeLicense.update({ where: { id }, data: input });
      await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'EmployeeLicense', entityId: id, metadata: { before: safeRecord(before, ['licenseType', 'issueDate', 'expiryDate', 'status']), after: safeRecord(after, ['licenseType', 'issueDate', 'expiryDate', 'status']) } }, tx);
      await reconcileEmployeeLicenseSchedules(tx, after.employeeId, req.user.sub);
      return after;
    }); res.json({ data: result });
  } catch (error) { next(error); }
});
router.get('/licenses/:id/documents', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const licenseId = uuid.parse(req.params.id);
    res.json({ data: await licenseDocuments.list({ licenseId, requestUser: req.user }) });
  } catch (error) { next(error); }
});
router.post('/licenses/:id/documents', authorize('ADMIN', 'MANAGER'), licenseDocumentUpload, async (req, res, next) => {
  try {
    const licenseId = uuid.parse(req.params.id);
    const input = z.object({ licenseNumber: z.string().transform(normalizeLicenseNumber), proposedStartDate: z.coerce.date(), proposedExpiryDate: z.coerce.date(), note: nullableText(2000) }).refine((value) => value.proposedStartDate <= value.proposedExpiryDate, { message: 'Start date must not be after expiry date.', path: ['proposedExpiryDate'] }).parse(req.body);
    res.status(201).json({ data: await licenseDocuments.upload({ licenseId, requestUser: req.user, file: req.file, input }) });
  } catch (error) { next(error); }
});
router.post('/license-documents/retention-cleanup', authorize('ADMIN'), async (req, res, next) => {
  try { res.json({ data: await cleanupDueLicenseDocuments({ prisma, storage: licenseStorage }) }); }
  catch (error) { next(error); }
});
router.get('/license-documents/:id/view', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    res.json({ data: await licenseDocuments.view({ id, requestUser: req.user }) });
  } catch (error) { next(error); }
});
router.post('/license-documents/:id/approve', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    res.json({ data: await licenseDocuments.approve({ id, requestUser: req.user }) });
  } catch (error) { next(error); }
});
router.post('/license-documents/:id/return-for-correction', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const { correctionReason } = z.object({ correctionReason: z.string().trim().min(1).max(1000) }).parse(req.body);
    res.json({ data: await licenseDocuments.returnForCorrection({ id, requestUser: req.user, correctionReason }) });
  } catch (error) { next(error); }
});
router.post('/license-documents/:id/resubmit', authorize('ADMIN', 'MANAGER'), licenseDocumentUpload, async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const input = z.object({ licenseNumber: z.string().transform(normalizeLicenseNumber), proposedStartDate: z.coerce.date(), proposedExpiryDate: z.coerce.date(), note: nullableText(2000) }).refine((value) => value.proposedStartDate <= value.proposedExpiryDate, { message: 'Start date must not be after expiry date.', path: ['proposedExpiryDate'] }).parse(req.body);
    res.json({ data: await licenseDocuments.resubmit({ id, requestUser: req.user, input, file: req.file }) });
  } catch (error) { next(error); }
});
router.post('/license-documents/:id/reject', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id); const { rejectionReason } = z.object({ rejectionReason: z.string().trim().min(1).max(2000) }).parse(req.body);
    res.json({ data: await licenseDocuments.reject({ id, requestUser: req.user, rejectionReason }) });
  } catch (error) { next(error); }
});
router.delete('/license-documents/:id/permanent', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    res.json({ data: await licenseDocuments.permanentlyDelete({ id, requestUser: req.user }) });
  } catch (error) { next(error); }
});
router.delete('/licenses/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      const before = await tx.employeeLicense.delete({ where: { id } });
      await audit.log({ actorUserId: req.user.sub, action: 'DELETE', entityType: 'EmployeeLicense', entityId: id, metadata: { before: safeRecord(before, ['employeeId', 'licenseType', 'expiryDate', 'status']) } }, tx);
      await reconcileEmployeeLicenseSchedules(tx, before.employeeId, req.user.sub);
    });
    res.status(204).send();
  } catch (error) { next(error); }
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
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(1000).default(100),
      from: z.coerce.date().optional(), to: z.coerce.date().optional()
    }).parse(req.query);
    const where = filters.from || filters.to ? { workDate: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) } } : {};
    res.json(await paged(prisma.shiftAssignment, filters, {
      where,
      select: {
        id: true, employeeId: true, shiftTypeId: true, workDate: true, employeeNameSnapshot: true, departmentSnapshot: true,
        startTime: true, endTime: true, hours: true, remark: true, locked: true,
        licenseStatus: true, licenseOverride: true, licenseBlockedFromShiftTypeId: true, shiftType: { select: { id: true, code: true, name: true, color: true } }
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
      select: { id: true, employeeId: true, shiftTypeId: true, workDate: true, startTime: true, endTime: true, hours: true, remark: true, locked: true, licenseStatus: true, licenseOverride: true, licenseBlockedFromShiftTypeId: true, shiftType: { select: { id: true, code: true, name: true, color: true } } },
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
      return approveMonthlySchedule(tx, { month: monthStart, approvalNote, actorUser: { sub: req.user.sub, role: req.user.role } });
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
      const isAlOnly = String(shiftType.code || '').toUpperCase() === 'AL';
      await updateScheduleApprovalState(tx, { workDate: shift.workDate, actorUserId: req.user.sub, isAlOnly, changeType: 'CREATE_SHIFT' });
      await audit.log({ actorUserId: req.user.sub, action: 'CREATE', entityType: 'ShiftAssignment', entityId: shift.id, metadata: { after: safeRecord(shift, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']) } }, tx);
      return { ...shift, shiftType: { code: shiftType.code, name: shiftType.name } };
    }); res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.put('/shifts/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id); const input = shiftInput.partial().parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.');
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.shiftAssignment.findUniqueOrThrow({ where: { id } });
      const beforeType = await tx.shiftType.findUniqueOrThrow({ where: { id: before.shiftTypeId } });
      const employeeId = input.employeeId || before.employeeId;
      const shiftTypeId = input.shiftTypeId || before.shiftTypeId;
      const workDate = input.workDate || before.workDate;
      const [employee, shiftType] = await Promise.all([tx.employee.findUniqueOrThrow({ where: { id: employeeId } }), tx.shiftType.findUniqueOrThrow({ where: { id: shiftTypeId } })]);
      const licenseState = await licenseStateForShift(tx, { employeeId, workDate, shiftCode: shiftType.code, override: input.licenseOverride, overrideReason: input.overrideReason, actorRole: req.user.role });
      const shiftTypeChanged = Boolean(input.shiftTypeId && input.shiftTypeId !== before.shiftTypeId);
      const after = await tx.shiftAssignment.update({ where: { id }, data: { ...input, ...(shiftTypeChanged && input.startTime === undefined && { startTime: shiftType.startTime }), ...(shiftTypeChanged && input.endTime === undefined && { endTime: shiftType.endTime }), ...(shiftTypeChanged && input.hours === undefined && { hours: shiftType.hours }), ...(input.employeeId && { employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department }), ...licenseState } });

      const codeBefore = String(beforeType.code || '').toUpperCase();
      const codeAfter = String(shiftType.code || '').toUpperCase();
      const hasCodeChanged = Boolean(input.shiftTypeId && input.shiftTypeId !== before.shiftTypeId);
      const hasDateChanged = Boolean(input.workDate && input.workDate.getTime() !== before.workDate.getTime());
      const hasHoursChanged = (input.hours !== undefined && Number(input.hours) !== Number(before.hours));
      const hasTimesChanged = (input.startTime !== undefined && input.startTime !== before.startTime) || (input.endTime !== undefined && input.endTime !== before.endTime);
      const hasRemarkChanged = (input.remark !== undefined && (input.remark || null) !== (before.remark || null));
      const hasEmpChanged = Boolean(input.employeeId && input.employeeId !== before.employeeId);

      const isNoOp = !hasCodeChanged && !hasDateChanged && !hasHoursChanged && !hasTimesChanged && !hasRemarkChanged && !hasEmpChanged;
      const isAlOnly = !isNoOp && !hasDateChanged && !hasEmpChanged && (codeBefore !== 'AL' && codeAfter === 'AL');

      await updateScheduleApprovalState(tx, { workDate: after.workDate, actorUserId: req.user.sub, isAlOnly, isNoOp, changeType: 'UPDATE_SHIFT' });
      await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'ShiftAssignment', entityId: id, metadata: { before: safeRecord(before, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']), after: safeRecord(after, ['employeeId', 'shiftTypeId', 'workDate', 'hours', 'locked']) } }, tx);
      return after;
    }); res.json({ data: result });
  } catch (error) { next(error); }
});
router.delete('/shifts/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); await prisma.$transaction(async (tx) => { const before = await tx.shiftAssignment.findUnique({ where: { id } }); if (!before) return; await tx.shiftAssignment.delete({ where: { id } }); await updateScheduleApprovalState(tx, { workDate: before.workDate, actorUserId: req.user.sub, isAlOnly: false, changeType: 'DELETE_SHIFT' }); await audit.log({ actorUserId: req.user.sub, action: 'DELETE', entityType: 'ShiftAssignment', entityId: id, metadata: { before: safeRecord(before, ['employeeId', 'shiftTypeId', 'workDate']) } }, tx); }); res.status(204).send(); } catch (error) { next(error); } });

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
      let after;
      if (input.status === 'APPROVED') {
        after = await approveMonthlySchedule(tx, { month: before.month, approvalNote: input.approvalNote, actorUser: { sub: req.user.sub, role: req.user.role } });
      } else {
        after = await tx.scheduleApproval.update({ where: { id }, data: { status: input.status, approvedAt: null, approvedByLegacyRef: null, ...(input.approvalNote !== undefined && { approvalNote: input.approvalNote }) } });
      }
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
    const currentUser = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.sub },
      select: {
        role: true,
        employeeId: true,
        employee: { select: { department: true } }
      }
    });
    if (currentUser.role === 'VIEWER' && !currentUser.employeeId) throw new HttpError(403, 'This account is not linked to an employee.');
    const filters = leaveListQuery.parse(req.query);
    let monthFilter;
    try { monthFilter = parseLeaveMonth(filters); } catch (error) { throw new HttpError(400, error.message); }
    const viewerWhere = currentUser.role === 'VIEWER' ? { employeeId: currentUser.employeeId } : {};
    const requestedEmployeeWhere = currentUser.role === 'VIEWER' ? {} : (filters.employeeId ? { employeeId: filters.employeeId } : {});
    const searchWhere = filters.search ? { OR: [{ employeeNameSnapshot: { contains: filters.search, mode: 'insensitive' } }, { departmentSnapshot: { contains: filters.search, mode: 'insensitive' } }, { reason: { contains: filters.search, mode: 'insensitive' } }] } : {};
    
    // MANAGER global scope: no department filter — MANAGER sees all leave requests.
    // VIEWER is scoped to their own employee record (viewerWhere above).
    const baseWhere = {
      ...viewerWhere,
      ...requestedEmployeeWhere,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.department ? { departmentSnapshot: { contains: filters.department, mode: 'insensitive' } } : {}),
      ...searchWhere,
      ...leaveMonthWhere(monthFilter)
    };

    const where = baseWhere;
    const response = await paged(prisma.leaveRequest, req.query, {
      where,
      select: {
        id: true, employeeId: true, requestedAt: true, employeeNameSnapshot: true, departmentSnapshot: true,
        leaveType: true, startDate: true, endDate: true, dayCount: true, reason: true,
        attachmentUrl: true, attachmentMigrationStatus: true, status: true, approvedAt: true, approvedByLegacyRef: true,
        createdByUserId: true,
        attachment: { select: { fileName: true, mimeType: true, sizeBytes: true } }
      },
      orderBy: { requestedAt: 'desc' }
    });
    const statusCounts = await prisma.leaveRequest.groupBy({ by: ['status'], where, _count: { _all: true } });
    response.meta.statusCounts = Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all]));
    const approverIds = [...new Set(response.data.map((row) => row.approvedByLegacyRef).filter((value) => uuid.safeParse(value).success))];
    const approvers = approverIds.length ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, displayName: true, role: true } }) : [];
    const approverById = new Map(approvers.map((user) => [user.id, user]));

    const leaveIds = response.data.map((row) => row.id);
    const auditLogs = leaveIds.length ? await prisma.auditLog.findMany({
      where: { entityType: 'LeaveRequest', entityId: { in: leaveIds }, action: 'CREATE' },
      select: { entityId: true, actorUserId: true, metadata: true }
    }) : [];
    const auditMap = new Map(auditLogs.map((log) => [log.entityId, log]));

    res.json({ ...response, data: response.data.map((row) => {
      const approver = approverById.get(row.approvedByLegacyRef);
      const audit = auditMap.get(row.id);
      const isRetroactive = Boolean(audit?.metadata?.isRetroactive);
      return {
        ...row,
        attachmentUrl: row.attachment ? `/api/v1/leave-requests/${row.id}/attachment` : null,
        approvedByDisplayName: approver?.displayName || null,
        approvedByRole: approver?.role || null,
        isRetroactive,
        createdByUserId: audit?.actorUserId || null
      };
    }) });
  } catch (error) { next(error); }
});
router.get('/leave-summary', async (req, res, next) => {
  try {
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { employeeId: true } });
    if (!currentUser.employeeId) return res.json({ data: { linked: false, employeeId: null } });
    const [quota, approved] = await Promise.all([
      prisma.leaveQuota.findFirst({ where: { employeeId: currentUser.employeeId }, select: { sickLeave: true, personalLeave: true, vacationLeave: true } }),
      prisma.leaveRequest.groupBy({ by: ['leaveType'], where: { employeeId: currentUser.employeeId, status: 'APPROVED' }, _sum: { dayCount: true } })
    ]);
    const entitlement = { sickLeave: Number(quota?.sickLeave ?? 30), personalLeave: Number(quota?.personalLeave ?? 6), vacationLeave: Number(quota?.vacationLeave ?? 10) };
    const used = { sickLeave: 0, personalLeave: 0, vacationLeave: 0 };
    approved.forEach((item) => { used[leaveQuotaField(item.leaveType)] += Number(item._sum.dayCount || 0); });
    res.json({ data: { linked: true, employeeId: currentUser.employeeId, entitlement, used, remaining: { sickLeave: Math.max(0, entitlement.sickLeave - used.sickLeave), personalLeave: Math.max(0, entitlement.personalLeave - used.personalLeave), vacationLeave: Math.max(0, entitlement.vacationLeave - used.vacationLeave) } } });
  } catch (error) { next(error); }
});
router.post('/leave-requests', async (req, res, next) => {
  try {
    // Viewer forms intentionally omit employee selection. Treat an empty HTML
    // value as absent so the authenticated Viewer employee link is used.
    const input = leaveInput.parse({ ...req.body, employeeId: req.body.employeeId || undefined });
    const result = await prisma.$transaction((tx) => createLeaveRequest(tx, input, req.user));

    try {
      const { broadcastLeaveRequestEmail } = require('../services/notification-email.service');
      await broadcastLeaveRequestEmail(result, req.user);
    } catch (emailErr) {
      const { logger } = require('../utils/logger');
      logger.error('Failed to broadcast leave request email notifications', { error: emailErr.message, leaveRequestId: result?.id });
    }

    try {
      const { notifyEmployeeLeaveStatusChange } = require('../services/notification-email.service');
      await notifyEmployeeLeaveStatusChange(result, 'LEAVE_CREATED', req.user);
    } catch (emailErr) {
      const { logger } = require('../utils/logger');
      logger.error('Failed to send employee leave status email notification', { error: emailErr.message, leaveRequestId: result?.id });
    }

    res.status(201).json({ data: result });
  } catch (error) { next(error); }
});
router.post('/leave-requests/with-attachment', leaveUpload, async (req, res, next) => {
  try {
    const input = leaveInput.parse({ ...req.body, employeeId: req.body.employeeId || undefined });
    const result = await prisma.$transaction((tx) => createLeaveRequest(tx, input, req.user, req.file));

    try {
      const { broadcastLeaveRequestEmail } = require('../services/notification-email.service');
      await broadcastLeaveRequestEmail(result, req.user);
    } catch (emailErr) {
      const { logger } = require('../utils/logger');
      logger.error('Failed to broadcast leave request email notifications', { error: emailErr.message, leaveRequestId: result?.id });
    }

    try {
      const { notifyEmployeeLeaveStatusChange } = require('../services/notification-email.service');
      await notifyEmployeeLeaveStatusChange(result, 'LEAVE_CREATED', req.user);
    } catch (emailErr) {
      const { logger } = require('../utils/logger');
      logger.error('Failed to send employee leave status email notification', { error: emailErr.message, leaveRequestId: result?.id });
    }

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
router.put('/leave-requests/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const input = z.object({ status: z.enum(['APPROVED', 'REJECTED']), reason: nullableText(2000) }).parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      if (before.status !== 'PENDING') throw new HttpError(409, 'This leave request has already been reviewed.');
      const isRetroactive = checkIsRetroactive(before.startDate);
      // MANAGER global scope: no department check in any path.
      // Self-approval guard remains enforced regardless of retroactive status.
      await ensureLeaveApprovalAllowed(tx, before.employeeId, req.user, { isRetroactive });
      if (req.user.role === 'MANAGER') {
        const approverUser = await tx.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { employeeId: true } });
        if (before.employeeId === approverUser.employeeId) {
          throw new HttpError(400, 'ไม่สามารถอนุมัติใบลาของตนเองได้', 'LEAVE_OWNER_SELF_APPROVAL_NOT_ALLOWED');
        }
      }
      if (input.status === 'APPROVED') {
        await ensureLeaveAvailable(tx, before.employeeId, before.leaveType, Number(before.dayCount), before.id);
        const [employee, leaveShift] = await Promise.all([tx.employee.findUniqueOrThrow({ where: { id: before.employeeId } }), tx.shiftType.findUniqueOrThrow({ where: { code: 'AL' } })]);
        for (let date = new Date(before.startDate); date <= before.endDate; date.setUTCDate(date.getUTCDate() + 1)) {
          const workDate = new Date(date);
          await tx.shiftAssignment.upsert({
            where: { workDate_employeeId: { workDate, employeeId: before.employeeId } },
            update: { shiftTypeId: leaveShift.id, startTime: leaveShift.startTime, endTime: leaveShift.endTime, hours: leaveShift.hours, remark: `Leave: ${before.leaveType}`, source: 'LEAVE_APPROVAL', licenseStatus: 'NOT_REQUIRED', licenseOverride: false },
            create: { employeeId: before.employeeId, shiftTypeId: leaveShift.id, workDate, employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`, departmentSnapshot: employee.department, startTime: leaveShift.startTime, endTime: leaveShift.endTime, hours: leaveShift.hours, remark: `Leave: ${before.leaveType}`, source: 'LEAVE_APPROVAL', licenseStatus: 'NOT_REQUIRED' }
          });
        }
      }
      const after = await tx.leaveRequest.update({ where: { id }, data: { status: input.status, approvedAt: new Date(), approvedByLegacyRef: req.user.sub } });
      await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'LeaveRequest', entityId: id, metadata: { before: safeRecord(before, ['status']), after: safeRecord(after, ['status', 'approvedAt']) } }, tx);
      return after;
    });
    try {
      const { notifyEmployeeLeaveStatusChange } = require('../services/notification-email.service');
      const eventType = result.status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED';
      await notifyEmployeeLeaveStatusChange(result, eventType, req.user, { reason: input.reason });
    } catch (emailErr) {
      const { logger } = require('../utils/logger');
      logger.error('Failed to send employee leave status change email notification', { error: emailErr.message, leaveRequestId: result?.id, status: result?.status });
    }

    res.json({ data: result });
  } catch (error) { next(error); }
});

router.post('/leave-requests/:id/cancel', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const input = z.object({ reason: nullableText(2000) }).parse(req.body || {});
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      if (before.status !== 'APPROVED') throw new HttpError(409, 'Only approved leave requests can be cancelled for quota restoration.');
      // MANAGER global scope: no department check for cancel.
      await ensureLeaveApprovalAllowed(tx, before.employeeId, req.user, { isRetroactive: true });
      const alShift = await tx.shiftType.findUnique({ where: { code: 'AL' }, select: { id: true } });
      const removedLeaveShifts = alShift ? await tx.shiftAssignment.deleteMany({
        where: {
          employeeId: before.employeeId,
          shiftTypeId: alShift.id,
          workDate: { gte: before.startDate, lte: before.endDate },
          OR: [{ source: 'LEAVE_APPROVAL' }, { remark: `Leave: ${before.leaveType}` }]
        }
      }) : { count: 0 };
      const after = await tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', approvedAt: null, approvedByLegacyRef: null }
      });
      await audit.log({
        actorUserId: req.user.sub,
        action: 'UPDATE',
        entityType: 'LeaveRequest',
        entityId: id,
        metadata: {
          before: safeRecord(before, ['status', 'leaveType', 'startDate', 'endDate', 'dayCount']),
          after: safeRecord(after, ['status']),
          quotaRestored: true,
          removedLeaveShifts: removedLeaveShifts.count,
          reason: input.reason ? 'provided' : 'not_provided'
        }
      }, tx);
      return { ...after, removedLeaveShifts: removedLeaveShifts.count };
    });
    try {
      const { notifyEmployeeLeaveStatusChange } = require('../services/notification-email.service');
      await notifyEmployeeLeaveStatusChange(result, 'LEAVE_CANCELLED', req.user, { reason: input.reason });
    } catch (emailErr) {
      const { logger } = require('../utils/logger');
      logger.error('Failed to send employee leave status change email notification', { error: emailErr.message, leaveRequestId: result?.id, status: result?.status });
    }

    res.json({ data: result });
  } catch (error) { next(error); }
});

router.get('/leave-quotas', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { page, pageSize } = paging.parse(req.query);
    const [total, quotas] = await prisma.$transaction([
      prisma.leaveQuota.count(),
      prisma.leaveQuota.findMany({
        select: { id: true, employeeId: true, employeeNameSnapshot: true, sickLeave: true, personalLeave: true, vacationLeave: true, matchStatus: true, updatedAt: true },
        orderBy: { employeeNameSnapshot: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    const employeeIds = quotas.map((quota) => quota.employeeId).filter(Boolean);
    const approved = employeeIds.length ? await prisma.leaveRequest.groupBy({
      by: ['employeeId', 'leaveType'],
      where: { employeeId: { in: employeeIds }, status: 'APPROVED' },
      _sum: { dayCount: true }
    }) : [];
    const usedByEmployee = new Map();
    approved.forEach((row) => {
      const current = usedByEmployee.get(row.employeeId) || { sickLeave: 0, personalLeave: 0, vacationLeave: 0 };
      current[leaveQuotaField(row.leaveType)] += Number(row._sum.dayCount || 0);
      usedByEmployee.set(row.employeeId, current);
    });
    const data = quotas.map((quota) => {
      const used = usedByEmployee.get(quota.employeeId) || { sickLeave: 0, personalLeave: 0, vacationLeave: 0 };
      const entitlement = { sickLeave: Number(quota.sickLeave), personalLeave: Number(quota.personalLeave), vacationLeave: Number(quota.vacationLeave) };
      return {
        ...quota,
        sickLeave: entitlement.sickLeave,
        personalLeave: entitlement.personalLeave,
        vacationLeave: entitlement.vacationLeave,
        sickLeaveUsed: used.sickLeave,
        personalLeaveUsed: used.personalLeave,
        vacationLeaveUsed: used.vacationLeave,
        sickLeaveRemaining: Math.max(0, entitlement.sickLeave - used.sickLeave),
        personalLeaveRemaining: Math.max(0, entitlement.personalLeave - used.personalLeave),
        vacationLeaveRemaining: Math.max(0, entitlement.vacationLeave - used.vacationLeave)
      };
    });
    res.json({ data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  } catch (error) { next(error); }
});
router.put('/leave-quotas/:id/link', authorize('ADMIN'), async (req, res, next) => {
  try {
    const id = uuid.parse(req.params.id);
    const input = z.object({ employeeId: uuid }).parse(req.body);
    const result = await linkLeaveQuota({ quotaId: id, employeeId: input.employeeId, actorUserId: req.user.sub });
    res.json({ data: result });
  } catch (error) { next(error); }
});
router.put('/leave-quotas/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ sickLeave: z.coerce.number().min(0).max(999).optional(), personalLeave: z.coerce.number().min(0).max(999).optional(), vacationLeave: z.coerce.number().min(0).max(999).optional() }).parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.'); const result = await prisma.$transaction(async (tx) => { const before = await tx.leaveQuota.findUniqueOrThrow({ where: { id } }); const after = await tx.leaveQuota.update({ where: { id }, data: input }); await audit.log({ actorUserId: req.user.sub, action: 'UPDATE', entityType: 'LeaveQuota', entityId: id, metadata: { before: safeRecord(before, ['sickLeave', 'personalLeave', 'vacationLeave']), after: safeRecord(after, ['sickLeave', 'personalLeave', 'vacationLeave']) } }, tx); return after; }); res.json({ data: result }); } catch (error) { next(error); } });

router.put('/users/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => { try { const id = uuid.parse(req.params.id); const input = z.object({ role: z.enum(['ADMIN', 'MANAGER', 'VIEWER']).optional(), department: nullableText(100), accountStatus: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED', 'REJECTED']).optional(), isActive: z.boolean().optional() }).parse(req.body); if (!Object.keys(input).length) throw new HttpError(400, 'Update body cannot be empty.'); const result = await userAccess.updateUserAccount({ id, input, actorUserId: req.user.sub, actorRole: req.user.role }); res.json({ data: result }); } catch (error) { next(error); } });
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
