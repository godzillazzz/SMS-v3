'use strict';

const { performance } = require('node:perf_hooks');
const { logger: defaultLogger } = require('../utils/logger');
const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { leaveTypeDisplayName } = require('./leave-type.service');
const { createAttendanceAdjustmentService } = require('./attendance-adjustment.service');
const { canReview, createApprovalPolicyService, positionClass } = require('./approval-policy.service');
const { approvalIdentity, resolveApprovalActors } = require('./approval-identity.service');

const HOUR_MS = 60 * 60 * 1000;
const PRIORITY = { OVERDUE: 3, DUE_SOON: 2, NEW: 1 };
const APPROVAL_QUERY_CONCURRENCY = 2;
const APPROVAL_TYPES = new Set([
  'EMPLOYEE_MASTER_CHANGE', 'EMPLOYEE_REFERENCE_PHOTO', 'LICENSE_DOCUMENT',
  'ATTENDANCE_DEVICE_REQUEST', 'ATTENDANCE_ADJUSTMENT_REQUEST', 'SCHEDULE_APPROVAL',
  'LEAVE_REQUEST', 'USER_ACCESS', 'REGISTRATION_REQUEST'
]);

async function runApprovalQueries(tasks, maxConcurrency = APPROVAL_QUERY_CONCURRENCY) {
  if (!tasks.length) return [];
  const results = new Array(tasks.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(maxConcurrency) || 1, tasks.length));
  const runNext = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return results;
}
function approvalUrgency(submittedAt, now = new Date(), thresholds = { dueSoonHours: 24, overdueHours: 48 }) {
  const submitted = new Date(submittedAt);
  const ageHours = Number.isFinite(submitted.getTime()) ? Math.max(0, Math.floor((now.getTime() - submitted.getTime()) / HOUR_MS)) : 0;
  const dueSoonHours = Number(thresholds?.dueSoonHours);
  const overdueHours = Number(thresholds?.overdueHours);
  if (ageHours >= overdueHours) return { ageHours, urgency: 'OVERDUE' };
  if (ageHours >= dueSoonHours) return { ageHours, urgency: 'DUE_SOON' };
  return { ageHours, urgency: 'NEW' };
}

async function latestScheduleApprovalConditions(prisma) {
  const latestByMonth = await prisma.scheduleApproval.groupBy({
    by: ['month'],
    _max: { revision: true }
  });
  return latestByMonth
    .filter((row) => row?._max?.revision != null)
    .map((row) => ({ month: row.month, revision: row._max.revision }));
}

function employeeSummary(employee) {
  return employee ? {
    id: employee.id,
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    displayName: employee.displayName,
    department: employee.department,
    jobTitle: employee.jobTitle
  } : null;
}

function actorSummary(actor, fallbackRole) {
  return actor
    ? { id: actor.id || null, displayName: actor.displayName || null, role: actor.role || fallbackRole || null }
    : { id: null, displayName: null, role: fallbackRole || null };
}

function withAge(item, now, policy) {
  const age = approvalUrgency(item.submittedAt, now, policy);
  return {
    ...item,
    ageHours: age.ageHours,
    urgency: age.urgency,
    sla: { dueSoonHours: policy.dueSoonHours, overdueHours: policy.overdueHours }
  };
}

function dateValue(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isRetroactiveLeaveStart(dateInput, now = new Date()) {
  if (!dateInput) return false;
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return false;
  const bangkokNow = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  const todayUtc = new Date(Date.UTC(bangkokNow.getUTCFullYear(), bangkokNow.getUTCMonth(), bangkokNow.getUTCDate()));
  const bangkokDate = new Date(date.getTime() + (7 * 60 * 60 * 1000));
  const targetUtc = new Date(Date.UTC(bangkokDate.getUTCFullYear(), bangkokDate.getUTCMonth(), bangkokDate.getUTCDate()));
  return targetUtc < todayUtc;
}

function managerCanApproveLeave(row, actorProfile, now = new Date(), policy = {}) {
  if (!row?.employee) return true;
  if (actorProfile?.employeeId && row.employeeId === actorProfile.employeeId) return false;
  // Keep the queue aligned with ensureLeaveApprovalAllowed in operations.routes.js:
  // retroactive leave bypasses position escalation; non-retroactive Supervisor leave is Admin-only.
  if (isRetroactiveLeaveStart(row.startDate, now)) return true;
  const employeePosition = positionClass(row.employee.jobTitle, policy);
  if (employeePosition === 'SUPERVISOR') return false;
  if (employeePosition === 'MANAGER') {
    return ['SUPERVISOR', 'MANAGER'].includes(positionClass(actorProfile?.employee?.jobTitle, policy));
  }
  return true;
}


function supervisorCanApproveLeave(row, actorProfile, policy = {}) {
  if (!row?.employee || !actorProfile?.employeeId) return false;
  if (row.employeeId === actorProfile.employeeId) return false;
  if (actorProfile.employee?.isActive !== true || actorProfile.employee?.deletedAt) return false;
  return row.employee.user?.role === 'SUPERVISOR';
}

function reviewerCanApproveLeave(role, row, actorProfile, now = new Date(), policy = {}) {
  if (role === 'ADMIN') return true;
  if (role === 'SUPERVISOR') return managerCanApproveLeave(row, actorProfile, now, policy) || supervisorCanApproveLeave(row, actorProfile, policy);
  if (role === 'MANAGER') return managerCanApproveLeave(row, actorProfile, now, policy);
  return false;
}

function createApprovalCenterService({
  prisma = prismaDefault,
  clock = () => new Date(),
  attendanceAdjustmentList,
  approvalPolicyService,
  logger = defaultLogger,
  measured = false
} = {}) {
  // Each request gets its own proxy/counter, including nested policy and raw queries.
  if (!measured) {
    const measure = (operation) => async (input) => {
      let queryCount = 0;
      const delegates = new WeakMap();
      const queryMethods = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
      const count = () => { queryCount = Math.min(queryCount + 1, 1000); };
      const client = new Proxy(prisma, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value === 'function') {
            return (...args) => {
              if (['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].includes(key)) count();
              return value.apply(target, args);
            };
          }
          if (!value || typeof value !== 'object') return value;
          if (!delegates.has(value)) delegates.set(value, new Proxy(value, {
            get(delegate, method) {
              const fn = Reflect.get(delegate, method);
              if (typeof fn !== 'function') return fn;
              return (...args) => { if (queryMethods.has(method)) count(); return fn.apply(delegate, args); };
            }
          }));
          return delegates.get(value);
        }
      });
      const startedAt = performance.now();
      let status = 'success';
      try {
        return await createApprovalCenterService({ prisma: client, clock, attendanceAdjustmentList,
          approvalPolicyService, logger, measured: true })[operation](input);
      } catch (error) {
        status = 'error';
        throw error;
      } finally {
        const correlationId = input.correlationId || (operation !== 'getItem' ? input.requestId : null);
        if (correlationId) logger.info('performance_stage', {
          requestId: correlationId, operation: 'approval-center', stage: operation,
          durationMs: Number((performance.now() - startedAt).toFixed(2)), queryCount,
          role: ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'].includes(String(input.actor?.role).toUpperCase())
            ? String(input.actor.role).toUpperCase() : 'UNKNOWN', status
        });
      }
    };
    return { summary: measure('summary'), list: measure('list'), getItem: measure('getItem') };
  }
  const listAttendanceAdjustments = attendanceAdjustmentList || ((input) => createAttendanceAdjustmentService({ prisma }).list(input));
  const policyService = approvalPolicyService || createApprovalPolicyService({ prismaClient: prisma });
  // The zero response is a public indistinguishability contract. Keep every
  // field stable across requests so callers cannot distinguish clocks or paths.
  const zeroEnvelopeGeneratedAt = '1970-01-01T00:00:00.000Z';

  async function summary({ actor }) {
    const role = String(actor?.role || '').toUpperCase();
    if (!['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role)) {
      throw new HttpError(403, 'Approval Center requires Supervisor, Manager, or Admin authority.', { code: 'APPROVAL_CENTER_REVIEWER_REQUIRED' });
    }

    const policies = await policyService.loadPolicies(prisma);
    const allowed = (type) => canReview(policies.get(type), role);
    const actorProfile = ['MANAGER', 'SUPERVISOR'].includes(role) && allowed('LEAVE_REQUEST')
      ? await prisma.user.findUnique({
        where: { id: actor.sub },
        select: { id: true, employeeId: true, employee: { select: { jobTitle: true, isActive: true, deletedAt: true } } }
      })
      : null;

    const leaveWhere = {
      status: 'PENDING',
      ...(['MANAGER', 'SUPERVISOR'].includes(role) && actorProfile?.employeeId ? { employeeId: { not: actorProfile.employeeId } } : {})
    };

    const managerLeaveTask = async () => {
      if (!allowed('LEAVE_REQUEST')) return 0;
      if (role === 'ADMIN') return prisma.leaveRequest.count({ where: leaveWhere });
      const rows = await prisma.leaveRequest.findMany({
        where: leaveWhere,
        select: { employeeId: true, startDate: true, employee: { select: { jobTitle: true, user: { select: { role: true } } } } }
      });
      return rows.filter((row) => reviewerCanApproveLeave(role, row, actorProfile, clock(), policies.get('LEAVE_REQUEST'))).length;
    };

    const attendanceAdjustmentTask = async () => {
      if (!allowed('ATTENDANCE_ADJUSTMENT_REQUEST')) return 0;
      // OWNER policy (18 Oct 2026): staged approval chain — the badge must count the stage the
      // current role can act on, and the ADMIN sees every stage that still needs a decision.
      const actorRole = String(actor?.role || '').toUpperCase();
      const statuses = actorRole === 'ADMIN'
        ? ['PENDING_SUPERVISOR', 'PENDING_MANAGER', 'PENDING_ADMIN', 'PENDING_APPROVAL']
        : actorRole === 'MANAGER' ? ['PENDING_MANAGER']
          : actorRole === 'SUPERVISOR' ? ['PENDING_SUPERVISOR']
            : [];
      if (!statuses.length) return 0;
      const result = await listAttendanceAdjustments({ actor, statuses, page: 1, pageSize: 1 }, prisma);
      return Number(result?.meta?.total || 0);
    };

    const scheduleApprovalTask = async () => {
      if (!allowed('SCHEDULE_APPROVAL')) return 0;
      const latestRevisions = await latestScheduleApprovalConditions(prisma);
      if (!latestRevisions.length) return 0;
      return prisma.scheduleApproval.count({
        where: { status: 'PENDING', OR: latestRevisions }
      });
    };

    const [
      employeeMasterChanges,
      referencePhotos,
      licenseDocuments,
      attendanceDeviceRequests,
      registrationRequests,
      userAccessRequests,
      leaveRequests,
      attendanceAdjustmentRequests,
      scheduleApprovals
    ] = await runApprovalQueries([
      () => allowed('EMPLOYEE_MASTER_CHANGE') ? prisma.employeeChangeRequest.count({ where: { status: 'PENDING_APPROVAL' } }) : 0,
      () => allowed('EMPLOYEE_REFERENCE_PHOTO') ? prisma.employeeReferencePhoto.count({ where: { status: 'PENDING_APPROVAL' } }) : 0,
      () => allowed('LICENSE_DOCUMENT') ? prisma.employeeLicenseDocument.count({ where: { status: 'PENDING' } }) : 0,
      () => allowed('ATTENDANCE_DEVICE_REQUEST') ? prisma.attendanceDeviceChangeRequest.count({ where: { status: 'PENDING_APPROVAL' } }) : 0,
      () => allowed('REGISTRATION_REQUEST') ? prisma.registrationRequest.count({ where: { status: { in: ['PENDING', 'MATCHED'] }, emailVerifiedAt: { not: null } } }) : 0,
      () => allowed('USER_ACCESS') ? prisma.user.count({ where: { accountStatus: 'PENDING' } }) : 0,
      managerLeaveTask,
      attendanceAdjustmentTask,
      scheduleApprovalTask
    ]);

    const byType = {
      EMPLOYEE_MASTER_CHANGE: employeeMasterChanges,
      EMPLOYEE_REFERENCE_PHOTO: referencePhotos,
      LICENSE_DOCUMENT: licenseDocuments,
      SCHEDULE_APPROVAL: scheduleApprovals,
      ATTENDANCE_DEVICE_REQUEST: attendanceDeviceRequests,
      ATTENDANCE_ADJUSTMENT_REQUEST: attendanceAdjustmentRequests,
      REGISTRATION_REQUEST: registrationRequests,
      USER_ACCESS: userAccessRequests,
      LEAVE_REQUEST: leaveRequests
    };
    const total = Object.values(byType).reduce((sum, value) => sum + Number(value || 0), 0);
    return { summary: { total, byType }, generatedAt: clock().toISOString() };
  }

  function zeroListEnvelope() {
    const emptyByType = {
      EMPLOYEE_MASTER_CHANGE: 0,
      EMPLOYEE_REFERENCE_PHOTO: 0,
      LICENSE_DOCUMENT: 0,
      SCHEDULE_APPROVAL: 0,
      ATTENDANCE_DEVICE_REQUEST: 0,
      ATTENDANCE_ADJUSTMENT_REQUEST: 0,
      REGISTRATION_REQUEST: 0,
      USER_ACCESS: 0,
      LEAVE_REQUEST: 0
    };
    return {
      data: [],
      summary: {
        total: 0,
        byType: emptyByType,
        employeeMasterChanges: 0,
        referencePhotos: 0,
        leaveRequests: 0,
        registrationRequests: 0,
        userAccessRequests: 0,
        licenseDocuments: 0,
        scheduleApprovals: 0,
        attendanceDeviceRequests: 0,
        attendanceAdjustmentRequests: 0,
        dueSoon: 0,
        overdue: 0,
        truncated: false
      },
      generatedAt: zeroEnvelopeGeneratedAt
    };
  }

  async function list({ actor, limit = 100, onlyType = null, onlyRequestId = null }) {
    const role = String(actor?.role || '').toUpperCase();
    if (!['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role)) {
      throw new HttpError(403, 'Approval Center requires Supervisor, Manager, or Admin authority.', { code: 'APPROVAL_CENTER_REVIEWER_REQUIRED' });
    }

    const policies = await policyService.loadPolicies(prisma);
    const allowed = (type) => canReview(policies.get(type), role);
    if (onlyType && !allowed(onlyType)) {
      if (onlyRequestId) return zeroListEnvelope();
      const error = new HttpError(403, 'Approval type review is forbidden.');
      error.publicCode = 'APPROVAL_TYPE_REVIEW_FORBIDDEN';
      throw error;
    }
    const take = Math.max(1, Math.min(Number(limit) || 100, 100));
    const now = clock();
    const actorProfile = ['MANAGER', 'SUPERVISOR'].includes(role) && allowed('LEAVE_REQUEST')
      ? await prisma.user.findUnique({
        where: { id: actor.sub },
        select: { id: true, employeeId: true, employee: { select: { jobTitle: true, isActive: true, deletedAt: true } } }
      })
      : null;

    const commonEmployeeSelect = {
      id: true, employeeCode: true, firstName: true, lastName: true,
      displayName: true, department: true, jobTitle: true, user: { select: { role: true } }
    };

    const listWithOverflowCount = async (model, args) => {
      const scopedArgs = onlyRequestId ? { ...args, where: { ...args.where, id: onlyRequestId } } : args;
      const rows = onlyRequestId && typeof model.findFirst === 'function'
        ? await model.findFirst({ ...scopedArgs })
        : (typeof model.findMany === 'function'
          ? await model.findMany({ ...scopedArgs, take: 101 })
          : null);
      const normalizedRows = (Array.isArray(rows) ? rows : (rows ? [rows] : []))
        .filter((row) => !onlyRequestId || row?.id === onlyRequestId);
      if (normalizedRows.length <= 100) return [normalizedRows.length, normalizedRows];
      const total = await model.count({ where: scopedArgs.where });
      return [total, normalizedRows.slice(0, 100)];
    };

    const employeeChangesTask = () => onlyType && onlyType !== 'EMPLOYEE_MASTER_CHANGE' ? Promise.resolve([0, []]) : allowed('EMPLOYEE_MASTER_CHANGE') ? listWithOverflowCount(prisma.employeeChangeRequest, {
      where: { status: 'PENDING_APPROVAL' },
      select: {
        id: true, employeeId: true, status: true, currentRevision: true, createdAt: true,
        employee: { select: commonEmployeeSelect },
        requestOwner: { select: { id: true, displayName: true, role: true } },
        revisions: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true, changedFields: true, submittedAt: true } }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const referencePhotosTask = () => onlyType && onlyType !== 'EMPLOYEE_REFERENCE_PHOTO' ? Promise.resolve([0, []]) : allowed('EMPLOYEE_REFERENCE_PHOTO') ? listWithOverflowCount(prisma.employeeReferencePhoto, {
      where: { status: 'PENDING_APPROVAL' },
      select: {
        id: true, employeeId: true, status: true, safeDisplayFileName: true, mimeType: true, fileSize: true,
        imageWidth: true, imageHeight: true, uploadedByRoleSnapshot: true, uploadedAt: true,
        employee: { select: commonEmployeeSelect },
        uploadedBy: { select: { id: true, displayName: true, role: true } }
      },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const licenseDocumentsTask = () => onlyType && onlyType !== 'LICENSE_DOCUMENT' ? Promise.resolve([0, []]) : allowed('LICENSE_DOCUMENT') ? listWithOverflowCount(prisma.employeeLicenseDocument, {
      where: { status: 'PENDING' },
      select: {
        id: true, employeeId: true, licenseId: true, status: true, uploadedAt: true, resubmittedAt: true,
        proposedStartDate: true, proposedExpiryDate: true, proposedLicenseNumber: true, version: true,
        safeDisplayFileName: true,
        employee: { select: commonEmployeeSelect },
        uploadedBy: { select: { id: true, displayName: true, role: true } },
        license: { select: { licenseType: true, licenseNumber: true } }
      },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const attendanceDevicesTask = () => onlyType && onlyType !== 'ATTENDANCE_DEVICE_REQUEST' ? Promise.resolve([0, []]) : allowed('ATTENDANCE_DEVICE_REQUEST') ? listWithOverflowCount(prisma.attendanceDeviceChangeRequest, {
      where: { status: 'PENDING_APPROVAL' },
      select: {
        id: true, status: true, requestType: true, reason: true, createdAt: true,
        employee: { select: commonEmployeeSelect },
        requestedBy: { select: { id: true, displayName: true, role: true } },
        candidateDevice: { select: { displayName: true, platformHint: true } }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const registrationTask = () => onlyType && onlyType !== 'REGISTRATION_REQUEST' ? Promise.resolve([0, []]) : allowed('REGISTRATION_REQUEST') ? listWithOverflowCount(prisma.registrationRequest, {
      where: { status: { in: ['PENDING', 'MATCHED'] }, emailVerifiedAt: { not: null } },
      select: {
        id: true, submittedName: true, email: true, departmentHint: true, status: true,
        createdAt: true, reviewedAt: true,
        matchedEmployee: { select: commonEmployeeSelect }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const userAccessTask = () => onlyType && onlyType !== 'USER_ACCESS' ? Promise.resolve([0, []]) : allowed('USER_ACCESS') ? listWithOverflowCount(prisma.user, {
      where: { accountStatus: 'PENDING' },
      select: { id: true, displayName: true, email: true, role: true, department: true, accountStatus: true, requestedAt: true, createdAt: true },
      orderBy: [{ requestedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const leaveWhere = {
      status: 'PENDING',
      ...(['MANAGER', 'SUPERVISOR'].includes(role) && actorProfile?.employeeId ? { employeeId: { not: actorProfile.employeeId } } : {})
    };
    const leaveListArgs = {
      where: onlyRequestId ? { ...leaveWhere, id: onlyRequestId } : leaveWhere,
      select: {
        id: true, employeeId: true, status: true, requestedAt: true, createdAt: true, leaveType: true, leaveTypeNameSnapshot: true,
        startDate: true, endDate: true, dayCount: true, employeeNameSnapshot: true, departmentSnapshot: true, createdByUserId: true,
        employee: { select: commonEmployeeSelect },
        createdByUser: { select: { id: true, displayName: true, role: true } }
      },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }]
    };
    const leaveTask = async () => {
      if (onlyType && onlyType !== 'LEAVE_REQUEST') return [0, []];
      if (!allowed('LEAVE_REQUEST')) return [0, []];
      if (role === 'ADMIN') return listWithOverflowCount(prisma.leaveRequest, leaveListArgs);
      const total = await prisma.leaveRequest.count({ where: leaveWhere });
      const rows = await prisma.leaveRequest.findMany({ ...leaveListArgs, take: 100 });
      return [total, rows];
    };

    const attendanceAdjustmentsTask = () => onlyType && onlyType !== 'ATTENDANCE_ADJUSTMENT_REQUEST' ? Promise.resolve({ data: [], meta: { total: 0 } }) : allowed('ATTENDANCE_ADJUSTMENT_REQUEST')
      ? listAttendanceAdjustments({ actor, statuses: ['PENDING_SUPERVISOR', 'PENDING_MANAGER', 'PENDING_ADMIN', 'PENDING_APPROVAL'], requestId: onlyRequestId, page: 1, pageSize: 100 }, prisma)
      : Promise.resolve({ data: [], meta: { total: 0 } });
    const scheduleApprovalsTask = async () => {
      if (onlyType && onlyType !== 'SCHEDULE_APPROVAL') return [0, []];
      if (!allowed('SCHEDULE_APPROVAL')) return [0, []];
      const latestRevisions = await latestScheduleApprovalConditions(prisma);
      if (!latestRevisions.length) return [0, []];
      return listWithOverflowCount(prisma.scheduleApproval, {
        where: { status: 'PENDING', OR: latestRevisions },
        select: { id: true, month: true, status: true, revision: true, changedByLegacyRef: true, changedAt: true, changeType: true, createdAt: true, approvalNote: true },
        orderBy: [{ changedAt: 'asc' }, { month: 'asc' }, { revision: 'asc' }]
      });
    };

    const [
      [employeeChangeTotal, employeeChanges],
      [referencePhotoTotal, referencePhotos],
      [licenseDocumentTotal, licenseDocuments],
      [attendanceDeviceTotal, attendanceDevices],
      [registrationTotal, registrations],
      [userAccessTotal, users],
      [rawLeaveTotal, rawLeaves],
      attendanceAdjustments,
      [scheduleApprovalTotal, scheduleApprovals]
    ] = await runApprovalQueries([
      employeeChangesTask,
      referencePhotosTask,
      licenseDocumentsTask,
      attendanceDevicesTask,
      registrationTask,
      userAccessTask,
      leaveTask,
      attendanceAdjustmentsTask,
      scheduleApprovalsTask
    ]);

    const leaves = role === 'ADMIN'
      ? rawLeaves
      : rawLeaves.filter((row) => reviewerCanApproveLeave(role, row, actorProfile, now, policies.get('LEAVE_REQUEST')));
    const leaveTotal = role === 'ADMIN' ? rawLeaveTotal : Math.min(rawLeaveTotal, leaves.length);

    const items = [];

    for (const row of employeeChanges) {
      const revision = row.revisions?.[0];
      items.push(withAge({
        id: 'employee-change:' + row.id,
        requestId: row.id,
        type: 'EMPLOYEE_MASTER_CHANGE',
        title: 'แก้ไขข้อมูลพนักงาน',
        status: row.status,
        sourcePage: 'employees',
        employee: employeeSummary(row.employee),
        requestedBy: actorSummary(row.requestOwner, 'MANAGER'),
        submittedAt: revision?.submittedAt || row.createdAt,
        revision: row.currentRevision,
        changedFields: Array.isArray(revision?.changedFields) ? revision.changedFields : []
      }, now, policies.get('EMPLOYEE_MASTER_CHANGE')));
    }

    for (const row of referencePhotos) {
      items.push(withAge({
        id: 'reference-photo:' + row.id,
        requestId: row.id,
        type: 'EMPLOYEE_REFERENCE_PHOTO',
        title: 'รูปอ้างอิงพนักงาน',
        status: row.status,
        sourcePage: 'employees',
        employee: employeeSummary(row.employee),
        requestedBy: actorSummary(row.uploadedBy, row.uploadedByRoleSnapshot),
        submittedAt: row.uploadedAt,
        photo: {
          fileName: row.safeDisplayFileName,
          mimeType: row.mimeType,
          fileSize: row.fileSize,
          imageWidth: row.imageWidth,
          imageHeight: row.imageHeight
        }
      }, now, policies.get('EMPLOYEE_REFERENCE_PHOTO')));
    }

    for (const row of licenseDocuments) {
      items.push(withAge({
        id: 'license-document:' + row.id,
        requestId: row.id,
        type: 'LICENSE_DOCUMENT',
        title: 'เอกสารใบอนุญาต รปภ.',
        status: row.status,
        sourcePage: 'licenses',
        employee: employeeSummary(row.employee),
        requestedBy: actorSummary(row.uploadedBy, null),
        submittedAt: row.resubmittedAt || row.uploadedAt,
        metadata: {
          licenseId: row.licenseId,
          documentId: row.id,
          licenseType: row.license?.licenseType || null,
          currentLicenseNumber: row.license?.licenseNumber || null,
          proposedLicenseNumber: row.proposedLicenseNumber || null,
          proposedStartDate: row.proposedStartDate || null,
          proposedExpiryDate: row.proposedExpiryDate || null,
          version: row.version,
          fileName: row.safeDisplayFileName
        }
      }, now, policies.get('LICENSE_DOCUMENT')));
    }

    for (const row of attendanceDevices) {
      items.push(withAge({
        id: 'attendance-device:' + row.id,
        requestId: row.id,
        type: 'ATTENDANCE_DEVICE_REQUEST',
        title: 'อุปกรณ์ลงเวลา',
        status: row.status,
        sourcePage: 'attendanceDevice',
        employee: employeeSummary(row.employee),
        requestedBy: actorSummary(row.requestedBy, null),
        submittedAt: row.createdAt,
        metadata: {
          requestType: row.requestType,
          reason: row.reason || null,
          deviceName: row.candidateDevice?.displayName || null,
          platformHint: row.candidateDevice?.platformHint || null
        }
      }, now, policies.get('ATTENDANCE_DEVICE_REQUEST')));
    }

    for (const row of registrations) {
      items.push(withAge({
        id: 'registration:' + row.id,
        requestId: row.id,
        type: 'REGISTRATION_REQUEST',
        title: row.status === 'MATCHED' ? 'คำขอลงทะเบียนพร้อมอนุมัติ' : 'คำขอลงทะเบียนรอจับคู่พนักงาน',
        status: row.status,
        sourcePage: 'users',
        employee: employeeSummary(row.matchedEmployee),
        requestedBy: { id: null, displayName: row.submittedName, role: 'REQUESTER' },
        submittedAt: row.createdAt,
        metadata: {
          email: row.email,
          departmentHint: row.departmentHint || null,
          matchedEmployeeCode: row.matchedEmployee?.employeeCode || null,
          matchedEmployeeName: row.matchedEmployee
            ? (row.matchedEmployee.displayName || [row.matchedEmployee.firstName, row.matchedEmployee.lastName].filter(Boolean).join(' ') || null)
            : null
        }
      }, now, policies.get('REGISTRATION_REQUEST')));
    }

    for (const row of users) {
      items.push(withAge({
        id: 'user-access:' + row.id,
        requestId: row.id,
        type: 'USER_ACCESS',
        title: 'บัญชีผู้ใช้รอเปิดสิทธิ์',
        status: row.accountStatus,
        sourcePage: 'users',
        employee: null,
        requestedBy: { id: row.id, displayName: row.displayName, role: row.role || 'VIEWER' },
        submittedAt: row.requestedAt || row.createdAt,
        metadata: { email: row.email, department: row.department || null }
      }, now, policies.get('USER_ACCESS')));
    }

    for (const row of leaves) {
      items.push(withAge({
        id: 'leave:' + row.id,
        requestId: row.id,
        type: 'LEAVE_REQUEST',
        title: 'คำขอลา',
        status: row.status,
        sourcePage: 'leavePending',
        employee: {
          ...employeeSummary(row.employee),
          displayName: row.employeeNameSnapshot || employeeSummary(row.employee)?.displayName || null,
          department: row.departmentSnapshot || row.employee?.department || null
        },
        requestedBy: actorSummary(row.createdByUser, null),
        submittedAt: row.requestedAt || row.createdAt,
        metadata: {
          leaveType: leaveTypeDisplayName(row.leaveType, row.leaveTypeNameSnapshot),
          leaveTypeCode: row.leaveType,
          startDate: row.startDate,
          endDate: row.endDate,
          dayCount: row.dayCount == null ? null : String(row.dayCount),
          department: row.departmentSnapshot || row.employee?.department || null
        }
      }, now, policies.get('LEAVE_REQUEST')));
    }

    for (const row of (attendanceAdjustments?.data || [])) {
      items.push(withAge({
        id: 'attendance-adjustment:' + row.id,
        requestId: row.id,
        type: 'ATTENDANCE_ADJUSTMENT_REQUEST',
        title: 'คำขอปรับปรุงเวลา Attendance',
        status: row.status,
        sourcePage: 'attendanceSupervisor',
        employee: row.employeeId ? {
          id: row.employeeId,
          employeeCode: row.employeeCode || null,
          displayName: row.employeeName || null,
          department: row.department || null
        } : null,
        requestedBy: { id: row.makerUserId || null, displayName: row.makerDisplayName || null, role: row.makerRoleSnapshot || null },
        submittedAt: row.updatedAt || row.createdAt,
        metadata: {
          requestType: row.requestType,
          workDate: row.workDate || null,
          revision: row.currentRevision,
          reason: row.reason || null
        }
      }, now, policies.get('ATTENDANCE_ADJUSTMENT_REQUEST')));
    }

    const scheduleApprovalActors = await resolveApprovalActors(prisma, scheduleApprovals.flatMap((row) => [row.changedByLegacyRef]).filter(Boolean));
    for (const row of scheduleApprovals) {
      const monthLabel = new Intl.DateTimeFormat('th-TH', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Bangkok'
      }).format(new Date(row.month));
      items.push(withAge({
        id: 'schedule-approval:' + row.id,
        requestId: row.id,
        type: 'SCHEDULE_APPROVAL',
        title: `ตารางกะ ${monthLabel} ฉบับที่ ${row.revision}`,
        status: row.status,
        sourcePage: 'schedule',
        requestedBy: approvalIdentity(row.changedByLegacyRef, scheduleApprovalActors) || { id: null, displayName: null, role: null },
        submittedAt: row.changedAt || row.createdAt,
        revision: row.revision,
        metadata: { month: row.month, revision: row.revision, changeType: row.changeType || null, approvalNote: row.approvalNote || null }
      }, now, policies.get('SCHEDULE_APPROVAL')));
    }

    items.sort((a, b) => {
      const urgency = (PRIORITY[b.urgency] || 0) - (PRIORITY[a.urgency] || 0);
      if (urgency) return urgency;
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });

    const byType = {
      EMPLOYEE_MASTER_CHANGE: employeeChangeTotal,
      EMPLOYEE_REFERENCE_PHOTO: referencePhotoTotal,
      LICENSE_DOCUMENT: licenseDocumentTotal,
      SCHEDULE_APPROVAL: scheduleApprovalTotal,
      ATTENDANCE_DEVICE_REQUEST: attendanceDeviceTotal,
      ATTENDANCE_ADJUSTMENT_REQUEST: Number(attendanceAdjustments?.meta?.total || 0),
      REGISTRATION_REQUEST: registrationTotal,
      USER_ACCESS: userAccessTotal,
      LEAVE_REQUEST: leaveTotal
    };
    const total = Object.values(byType).reduce((sum, value) => sum + Number(value || 0), 0);
    const visibleItems = items.slice(0, take);
    return {
      data: visibleItems,
      summary: {
        total,
        byType,
        employeeMasterChanges: byType.EMPLOYEE_MASTER_CHANGE,
        referencePhotos: byType.EMPLOYEE_REFERENCE_PHOTO,
        leaveRequests: byType.LEAVE_REQUEST,
        registrationRequests: byType.REGISTRATION_REQUEST,
        userAccessRequests: byType.USER_ACCESS,
        licenseDocuments: byType.LICENSE_DOCUMENT,
        scheduleApprovals: byType.SCHEDULE_APPROVAL,
        attendanceDeviceRequests: byType.ATTENDANCE_DEVICE_REQUEST,
        attendanceAdjustmentRequests: byType.ATTENDANCE_ADJUSTMENT_REQUEST,
        dueSoon: items.filter((item) => item.urgency === 'DUE_SOON').length,
        overdue: items.filter((item) => item.urgency === 'OVERDUE').length,
        truncated: total > visibleItems.length
      },
      generatedAt: now.toISOString()
    };
  }

  async function getItem({ actor, type, requestId, correlationId }) {
    // Detail reads deliberately reuse the list predicate/mapper and fail closed
    // with the same zero envelope for every non-visible target. This prevents
    // request existence, scope, queue state, and View-As enumeration oracles.
    if (actor?.impersonation || actor?.isViewingAs || actor?.viewAs || actor?.viewingAs) return zeroListEnvelope();
    if (!APPROVAL_TYPES.has(type) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId || ''))) {
      return zeroListEnvelope();
    }
    const listed = await list({ actor, limit: 100, onlyType: type, onlyRequestId: requestId, correlationId });
    const item = listed.data.find((candidate) => candidate.type === type && candidate.requestId === requestId);
    return item ? { ...listed, data: [item] } : zeroListEnvelope();
  }

  return { list, summary, getItem };
}

module.exports = { createApprovalCenterService, approvalUrgency, isRetroactiveLeaveStart, managerCanApproveLeave, supervisorCanApproveLeave, reviewerCanApproveLeave };
