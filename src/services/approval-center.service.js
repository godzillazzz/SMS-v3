'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { leaveTypeDisplayName } = require('./leave-type.service');
const { createAttendanceAdjustmentService } = require('./attendance-adjustment.service');
const { canReview, createApprovalPolicyService, positionClass } = require('./approval-policy.service');

const HOUR_MS = 60 * 60 * 1000;
const PRIORITY = { OVERDUE: 3, DUE_SOON: 2, NEW: 1 };
function approvalUrgency(submittedAt, now = new Date(), thresholds = { dueSoonHours: 24, overdueHours: 48 }) {
  const submitted = new Date(submittedAt);
  const ageHours = Number.isFinite(submitted.getTime()) ? Math.max(0, Math.floor((now.getTime() - submitted.getTime()) / HOUR_MS)) : 0;
  const dueSoonHours = Number(thresholds?.dueSoonHours);
  const overdueHours = Number(thresholds?.overdueHours);
  if (ageHours >= overdueHours) return { ageHours, urgency: 'OVERDUE' };
  if (ageHours >= dueSoonHours) return { ageHours, urgency: 'DUE_SOON' };
  return { ageHours, urgency: 'NEW' };
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

function createApprovalCenterService({
  prisma = prismaDefault,
  clock = () => new Date(),
  attendanceAdjustmentList,
  approvalPolicyService
} = {}) {
  const listAttendanceAdjustments = attendanceAdjustmentList || ((input) => createAttendanceAdjustmentService({ prisma }).list(input));
  const policyService = approvalPolicyService || createApprovalPolicyService({ prismaClient: prisma });

  async function summary({ actor }) {
    const role = String(actor?.role || '').toUpperCase();
    if (!['ADMIN', 'MANAGER'].includes(role)) {
      throw new HttpError(403, 'Approval Center requires Manager or Admin authority.', { code: 'APPROVAL_CENTER_REVIEWER_REQUIRED' });
    }

    const policies = await policyService.loadPolicies(prisma);
    const allowed = (type) => canReview(policies.get(type), role);
    const actorProfile = role === 'MANAGER' && allowed('LEAVE_REQUEST')
      ? await prisma.user.findUnique({
        where: { id: actor.sub },
        select: { id: true, employeeId: true, employee: { select: { jobTitle: true } } }
      })
      : null;

    const leaveWhere = {
      status: 'PENDING',
      ...(role === 'MANAGER' && actorProfile?.employeeId ? { employeeId: { not: actorProfile.employeeId } } : {})
    };

    const managerLeavePromise = !allowed('LEAVE_REQUEST')
      ? Promise.resolve(0)
      : role === 'MANAGER'
        ? prisma.leaveRequest.findMany({
          where: leaveWhere,
          select: { employeeId: true, startDate: true, employee: { select: { jobTitle: true } } }
        }).then((rows) => rows.filter((row) => managerCanApproveLeave(row, actorProfile, clock(), policies.get('LEAVE_REQUEST'))).length)
        : prisma.leaveRequest.count({ where: leaveWhere });

    const attendanceAdjustmentPromise = allowed('ATTENDANCE_ADJUSTMENT_REQUEST')
      ? listAttendanceAdjustments({ actor, status: 'PENDING_APPROVAL', page: 1, pageSize: 1 }).then((result) => Number(result?.meta?.total || 0))
      : Promise.resolve(0);

    const [
      employeeMasterChanges,
      referencePhotos,
      licenseDocuments,
      attendanceDeviceRequests,
      registrationRequests,
      userAccessRequests,
      leaveRequests,
      attendanceAdjustmentRequests
    ] = await Promise.all([
      allowed('EMPLOYEE_MASTER_CHANGE') ? prisma.employeeChangeRequest.count({ where: { status: 'PENDING_APPROVAL' } }) : 0,
      allowed('EMPLOYEE_REFERENCE_PHOTO') ? prisma.employeeReferencePhoto.count({ where: { status: 'PENDING_APPROVAL' } }) : 0,
      allowed('LICENSE_DOCUMENT') ? prisma.employeeLicenseDocument.count({ where: { status: 'PENDING' } }) : 0,
      allowed('ATTENDANCE_DEVICE_REQUEST') ? prisma.attendanceDeviceChangeRequest.count({ where: { status: 'PENDING_APPROVAL' } }) : 0,
      allowed('REGISTRATION_REQUEST') ? prisma.registrationRequest.count({ where: { status: { in: ['PENDING', 'MATCHED'] }, emailVerifiedAt: { not: null } } }) : 0,
      allowed('USER_ACCESS') ? prisma.user.count({ where: { accountStatus: 'PENDING' } }) : 0,
      managerLeavePromise,
      attendanceAdjustmentPromise
    ]);

    const byType = {
      EMPLOYEE_MASTER_CHANGE: employeeMasterChanges,
      EMPLOYEE_REFERENCE_PHOTO: referencePhotos,
      LICENSE_DOCUMENT: licenseDocuments,
      SCHEDULE_APPROVAL: 0,
      ATTENDANCE_DEVICE_REQUEST: attendanceDeviceRequests,
      ATTENDANCE_ADJUSTMENT_REQUEST: attendanceAdjustmentRequests,
      REGISTRATION_REQUEST: registrationRequests,
      USER_ACCESS: userAccessRequests,
      LEAVE_REQUEST: leaveRequests
    };
    const total = Object.values(byType).reduce((sum, value) => sum + Number(value || 0), 0);
    return { summary: { total, byType }, generatedAt: clock().toISOString() };
  }

  async function list({ actor, limit = 100 }) {
    const role = String(actor?.role || '').toUpperCase();
    if (!['ADMIN', 'MANAGER'].includes(role)) {
      throw new HttpError(403, 'Approval Center requires Manager or Admin authority.', { code: 'APPROVAL_CENTER_REVIEWER_REQUIRED' });
    }

    const policies = await policyService.loadPolicies(prisma);
    const allowed = (type) => canReview(policies.get(type), role);
    const take = Math.max(1, Math.min(Number(limit) || 100, 100));
    const now = clock();
    const actorProfile = role === 'MANAGER' && allowed('LEAVE_REQUEST')
      ? await prisma.user.findUnique({
        where: { id: actor.sub },
        select: { id: true, employeeId: true, employee: { select: { jobTitle: true } } }
      })
      : null;

    const commonEmployeeSelect = {
      id: true, employeeCode: true, firstName: true, lastName: true,
      displayName: true, department: true, jobTitle: true
    };

    const listWithOverflowCount = async (model, args) => {
      const rows = await model.findMany({ ...args, take: 101 });
      if (rows.length <= 100) return [rows.length, rows];
      const total = await model.count({ where: args.where });
      return [total, rows.slice(0, 100)];
    };

    const employeeChangesPromise = allowed('EMPLOYEE_MASTER_CHANGE') ? listWithOverflowCount(prisma.employeeChangeRequest, {
      where: { status: 'PENDING_APPROVAL' },
      select: {
        id: true, employeeId: true, status: true, currentRevision: true, createdAt: true,
        employee: { select: commonEmployeeSelect },
        requestOwner: { select: { id: true, displayName: true, role: true } },
        revisions: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true, changedFields: true, submittedAt: true } }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const referencePhotosPromise = allowed('EMPLOYEE_REFERENCE_PHOTO') ? listWithOverflowCount(prisma.employeeReferencePhoto, {
      where: { status: 'PENDING_APPROVAL' },
      select: {
        id: true, employeeId: true, status: true, safeDisplayFileName: true, mimeType: true, fileSize: true,
        imageWidth: true, imageHeight: true, uploadedByRoleSnapshot: true, uploadedAt: true,
        employee: { select: commonEmployeeSelect },
        uploadedBy: { select: { id: true, displayName: true, role: true } }
      },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const licenseDocumentsPromise = allowed('LICENSE_DOCUMENT') ? listWithOverflowCount(prisma.employeeLicenseDocument, {
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

    const attendanceDevicesPromise = allowed('ATTENDANCE_DEVICE_REQUEST') ? listWithOverflowCount(prisma.attendanceDeviceChangeRequest, {
      where: { status: 'PENDING_APPROVAL' },
      select: {
        id: true, status: true, requestType: true, reason: true, createdAt: true,
        employee: { select: commonEmployeeSelect },
        requestedBy: { select: { id: true, displayName: true, role: true } },
        candidateDevice: { select: { displayName: true, platformHint: true } }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const registrationPromise = allowed('REGISTRATION_REQUEST') ? listWithOverflowCount(prisma.registrationRequest, {
      where: { status: { in: ['PENDING', 'MATCHED'] }, emailVerifiedAt: { not: null } },
      select: {
        id: true, submittedName: true, email: true, departmentHint: true, status: true,
        createdAt: true, reviewedAt: true,
        matchedEmployee: { select: commonEmployeeSelect }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const userAccessPromise = allowed('USER_ACCESS') ? listWithOverflowCount(prisma.user, {
      where: { accountStatus: 'PENDING' },
      select: { id: true, displayName: true, email: true, role: true, department: true, accountStatus: true, requestedAt: true, createdAt: true },
      orderBy: [{ requestedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    }) : Promise.resolve([0, []]);

    const leaveWhere = {
      status: 'PENDING',
      ...(role === 'MANAGER' && actorProfile?.employeeId ? { employeeId: { not: actorProfile.employeeId } } : {})
    };
    const leaveListArgs = {
      where: leaveWhere,
      select: {
        id: true, employeeId: true, status: true, requestedAt: true, createdAt: true, leaveType: true, leaveTypeNameSnapshot: true,
        startDate: true, endDate: true, dayCount: true, employeeNameSnapshot: true, departmentSnapshot: true, createdByUserId: true,
        employee: { select: commonEmployeeSelect },
        createdByUser: { select: { id: true, displayName: true, role: true } }
      },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }]
    };
    const leavePromise = !allowed('LEAVE_REQUEST')
      ? Promise.resolve([0, []])
      : role === 'ADMIN'
        ? listWithOverflowCount(prisma.leaveRequest, leaveListArgs)
        : Promise.all([
          prisma.leaveRequest.count({ where: leaveWhere }),
          prisma.leaveRequest.findMany({ ...leaveListArgs, take: 100 })
        ]);

    const attendanceAdjustmentsPromise = allowed('ATTENDANCE_ADJUSTMENT_REQUEST')
      ? listAttendanceAdjustments({ actor, status: 'PENDING_APPROVAL', page: 1, pageSize: 100 })
      : Promise.resolve({ data: [], meta: { total: 0 } });

    const [
      [employeeChangeTotal, employeeChanges],
      [referencePhotoTotal, referencePhotos],
      [licenseDocumentTotal, licenseDocuments],
      [attendanceDeviceTotal, attendanceDevices],
      [registrationTotal, registrations],
      [userAccessTotal, users],
      [rawLeaveTotal, rawLeaves],
      attendanceAdjustments
    ] = await Promise.all([
      employeeChangesPromise,
      referencePhotosPromise,
      licenseDocumentsPromise,
      attendanceDevicesPromise,
      registrationPromise,
      userAccessPromise,
      leavePromise,
      attendanceAdjustmentsPromise
    ]);

    const leaves = role === 'MANAGER'
      ? rawLeaves.filter((row) => managerCanApproveLeave(row, actorProfile, now, policies.get('LEAVE_REQUEST')))
      : rawLeaves;
    const leaveTotal = role === 'MANAGER' ? Math.min(rawLeaveTotal, leaves.length) : rawLeaveTotal;

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
        sourcePage: 'attendance',
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

    items.sort((a, b) => {
      const urgency = (PRIORITY[b.urgency] || 0) - (PRIORITY[a.urgency] || 0);
      if (urgency) return urgency;
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });

    const byType = {
      EMPLOYEE_MASTER_CHANGE: employeeChangeTotal,
      EMPLOYEE_REFERENCE_PHOTO: referencePhotoTotal,
      LICENSE_DOCUMENT: licenseDocumentTotal,
      SCHEDULE_APPROVAL: 0,
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
        scheduleApprovals: 0,
        attendanceDeviceRequests: byType.ATTENDANCE_DEVICE_REQUEST,
        attendanceAdjustmentRequests: byType.ATTENDANCE_ADJUSTMENT_REQUEST,
        dueSoon: items.filter((item) => item.urgency === 'DUE_SOON').length,
        overdue: items.filter((item) => item.urgency === 'OVERDUE').length,
        truncated: total > visibleItems.length
      },
      generatedAt: now.toISOString()
    };
  }

  return { list, summary };
}

module.exports = { createApprovalCenterService, approvalUrgency, isRetroactiveLeaveStart, managerCanApproveLeave };
