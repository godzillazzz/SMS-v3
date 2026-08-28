'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createAttendanceAdjustmentService } = require('./attendance-adjustment.service');

const HOUR_MS = 60 * 60 * 1000;
const PRIORITY = { OVERDUE: 3, DUE_SOON: 2, NEW: 1 };
const ADMIN_ONLY_TYPES = new Set([
  'EMPLOYEE_MASTER_CHANGE',
  'EMPLOYEE_REFERENCE_PHOTO',
  'LICENSE_DOCUMENT',
  'SCHEDULE_APPROVAL',
  'ATTENDANCE_DEVICE_REQUEST',
  'ATTENDANCE_ADJUSTMENT_REQUEST'
]);

function approvalUrgency(submittedAt, now = new Date()) {
  const submitted = new Date(submittedAt);
  const ageHours = Number.isFinite(submitted.getTime()) ? Math.max(0, Math.floor((now.getTime() - submitted.getTime()) / HOUR_MS)) : 0;
  if (ageHours >= 48) return { ageHours, urgency: 'OVERDUE' };
  if (ageHours >= 24) return { ageHours, urgency: 'DUE_SOON' };
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

function withAge(item, now) {
  const age = approvalUrgency(item.submittedAt, now);
  return { ...item, ageHours: age.ageHours, urgency: age.urgency };
}

function dateValue(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthValue(value) {
  const parsed = dateValue(value);
  return parsed ? parsed.toISOString().slice(0, 7) : null;
}

function managerCanApproveLeave(row, actorProfile) {
  if (!row?.employee) return true;
  if (actorProfile?.employeeId && row.employeeId === actorProfile.employeeId) return false;
  const employeePosition = String(row.employee.jobTitle || '').toLowerCase();
  if (/supervisor|หัวหน้า|ซุปเปอร์ไวเซอร์/.test(employeePosition)) return false;
  if (/manager|ผู้จัดการ/.test(employeePosition)) {
    const approverPosition = String(actorProfile?.employee?.jobTitle || '').toLowerCase();
    return /supervisor|หัวหน้า|ซุปเปอร์ไวเซอร์|manager|ผู้จัดการ/.test(approverPosition);
  }
  return true;
}

function createApprovalCenterService({
  prisma = prismaDefault,
  clock = () => new Date(),
  attendanceAdjustmentList
} = {}) {
  const listAttendanceAdjustments = attendanceAdjustmentList || ((input) => createAttendanceAdjustmentService({ prisma }).list(input));

  async function list({ actor, limit = 100 }) {
    const role = String(actor?.role || '').toUpperCase();
    if (!['ADMIN', 'MANAGER'].includes(role)) {
      throw new HttpError(403, 'Approval Center requires Manager or Admin authority.', { code: 'APPROVAL_CENTER_REVIEWER_REQUIRED' });
    }

    const take = Math.max(1, Math.min(Number(limit) || 100, 100));
    const admin = role === 'ADMIN';
    const now = clock();
    const actorProfile = role === 'MANAGER'
      ? await prisma.user.findUnique({
        where: { id: actor.sub },
        select: { id: true, employeeId: true, employee: { select: { jobTitle: true } } }
      })
      : null;

    const commonEmployeeSelect = {
      id: true, employeeCode: true, firstName: true, lastName: true,
      displayName: true, department: true, jobTitle: true
    };

    const employeeChangesPromise = admin ? Promise.all([
      prisma.employeeChangeRequest.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.employeeChangeRequest.findMany({
        where: { status: 'PENDING_APPROVAL' },
        select: {
          id: true, employeeId: true, status: true, currentRevision: true, createdAt: true,
          employee: { select: commonEmployeeSelect },
          requestOwner: { select: { id: true, displayName: true, role: true } },
          revisions: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true, changedFields: true, submittedAt: true } }
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100
      })
    ]) : Promise.resolve([0, []]);

    const referencePhotosPromise = admin ? Promise.all([
      prisma.employeeReferencePhoto.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.employeeReferencePhoto.findMany({
        where: { status: 'PENDING_APPROVAL' },
        select: {
          id: true, employeeId: true, status: true, safeDisplayFileName: true, mimeType: true, fileSize: true,
          imageWidth: true, imageHeight: true, uploadedByRoleSnapshot: true, uploadedAt: true,
          employee: { select: commonEmployeeSelect },
          uploadedBy: { select: { id: true, displayName: true, role: true } }
        },
        orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        take: 100
      })
    ]) : Promise.resolve([0, []]);

    const licenseDocumentsPromise = admin ? Promise.all([
      prisma.employeeLicenseDocument.count({ where: { status: 'PENDING' } }),
      prisma.employeeLicenseDocument.findMany({
        where: { status: 'PENDING' },
        select: {
          id: true, employeeId: true, licenseId: true, status: true, uploadedAt: true, resubmittedAt: true,
          proposedStartDate: true, proposedExpiryDate: true, proposedLicenseNumber: true, version: true,
          safeDisplayFileName: true,
          employee: { select: commonEmployeeSelect },
          uploadedBy: { select: { id: true, displayName: true, role: true } },
          license: { select: { licenseType: true, licenseNumber: true } }
        },
        orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        take: 100
      })
    ]) : Promise.resolve([0, []]);

    const scheduleApprovalsPromise = admin ? Promise.all([
      prisma.scheduleApproval.count({ where: { status: 'PENDING' } }),
      prisma.scheduleApproval.findMany({
        where: { status: 'PENDING' },
        select: { id: true, month: true, status: true, revision: true, changedAt: true, changeType: true, createdAt: true },
        orderBy: [{ month: 'asc' }, { revision: 'asc' }],
        take: 100
      })
    ]) : Promise.resolve([0, []]);

    const attendanceDevicesPromise = admin ? Promise.all([
      prisma.attendanceDeviceChangeRequest.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.attendanceDeviceChangeRequest.findMany({
        where: { status: 'PENDING_APPROVAL' },
        select: {
          id: true, status: true, requestType: true, reason: true, createdAt: true,
          employee: { select: commonEmployeeSelect },
          requestedBy: { select: { id: true, displayName: true, role: true } },
          candidateDevice: { select: { displayName: true, platformHint: true } }
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100
      })
    ]) : Promise.resolve([0, []]);

    const registrationPromise = Promise.all([
      prisma.registrationRequest.count({ where: { status: { in: ['PENDING', 'MATCHED'] } } }),
      prisma.registrationRequest.findMany({
        where: { status: { in: ['PENDING', 'MATCHED'] } },
        select: {
          id: true, submittedName: true, email: true, departmentHint: true, status: true,
          createdAt: true, reviewedAt: true,
          matchedEmployee: { select: commonEmployeeSelect }
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100
      })
    ]);

    const userAccessPromise = Promise.all([
      prisma.user.count({ where: { accountStatus: 'PENDING' } }),
      prisma.user.findMany({
        where: { accountStatus: 'PENDING' },
        select: { id: true, displayName: true, email: true, role: true, department: true, accountStatus: true, requestedAt: true, createdAt: true },
        orderBy: [{ requestedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 100
      })
    ]);

    const leaveWhere = {
      status: 'PENDING',
      ...(role === 'MANAGER' && actorProfile?.employeeId ? { employeeId: { not: actorProfile.employeeId } } : {})
    };
    const leavePromise = Promise.all([
      prisma.leaveRequest.count({ where: leaveWhere }),
      prisma.leaveRequest.findMany({
        where: leaveWhere,
        select: {
          id: true, employeeId: true, status: true, requestedAt: true, createdAt: true, leaveType: true,
          startDate: true, endDate: true, dayCount: true, departmentSnapshot: true, createdByUserId: true,
          employee: { select: commonEmployeeSelect },
          createdByUser: { select: { id: true, displayName: true, role: true } }
        },
        orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
        take: 100
      })
    ]);

    const attendanceAdjustmentsPromise = admin
      ? listAttendanceAdjustments({ actor, status: 'PENDING_APPROVAL', page: 1, pageSize: 100 })
      : Promise.resolve({ data: [], meta: { total: 0 } });

    const [
      [employeeChangeTotal, employeeChanges],
      [referencePhotoTotal, referencePhotos],
      [licenseDocumentTotal, licenseDocuments],
      [scheduleApprovalTotal, scheduleApprovals],
      [attendanceDeviceTotal, attendanceDevices],
      [registrationTotal, registrations],
      [userAccessTotal, users],
      [rawLeaveTotal, rawLeaves],
      attendanceAdjustments
    ] = await Promise.all([
      employeeChangesPromise,
      referencePhotosPromise,
      licenseDocumentsPromise,
      scheduleApprovalsPromise,
      attendanceDevicesPromise,
      registrationPromise,
      userAccessPromise,
      leavePromise,
      attendanceAdjustmentsPromise
    ]);

    const leaves = role === 'MANAGER'
      ? rawLeaves.filter((row) => managerCanApproveLeave(row, actorProfile))
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
      }, now));
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
      }, now));
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
      }, now));
    }

    for (const row of scheduleApprovals) {
      items.push(withAge({
        id: 'schedule-approval:' + row.id,
        requestId: row.id,
        type: 'SCHEDULE_APPROVAL',
        title: 'อนุมัติตารางกะ',
        status: row.status,
        sourcePage: 'schedule',
        employee: null,
        requestedBy: actorSummary(null, 'MANAGER'),
        submittedAt: row.changedAt || row.createdAt,
        metadata: { month: monthValue(row.month), revision: row.revision, changeType: row.changeType || null }
      }, now));
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
      }, now));
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
        metadata: { email: row.email, departmentHint: row.departmentHint || null }
      }, now));
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
      }, now));
    }

    for (const row of leaves) {
      items.push(withAge({
        id: 'leave:' + row.id,
        requestId: row.id,
        type: 'LEAVE_REQUEST',
        title: 'คำขอลา',
        status: row.status,
        sourcePage: 'leavePending',
        employee: employeeSummary(row.employee),
        requestedBy: actorSummary(row.createdByUser, null),
        submittedAt: row.requestedAt || row.createdAt,
        metadata: {
          leaveType: row.leaveType,
          startDate: row.startDate,
          endDate: row.endDate,
          dayCount: row.dayCount == null ? null : String(row.dayCount),
          department: row.departmentSnapshot || row.employee?.department || null
        }
      }, now));
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
      }, now));
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
    if (!admin) {
      for (const type of ADMIN_ONLY_TYPES) byType[type] = 0;
    }

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
        dueSoon24h: items.filter((item) => item.urgency === 'DUE_SOON').length,
        overdue48h: items.filter((item) => item.urgency === 'OVERDUE').length,
        truncated: total > visibleItems.length
      },
      generatedAt: now.toISOString()
    };
  }

  return { list };
}

module.exports = { createApprovalCenterService, approvalUrgency, managerCanApproveLeave };
