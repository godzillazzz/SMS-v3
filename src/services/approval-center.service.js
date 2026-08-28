'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');

const HOUR_MS = 60 * 60 * 1000;

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
  return actor ? { id: actor.id, displayName: actor.displayName, role: actor.role || fallbackRole || null } : { id: null, displayName: null, role: fallbackRole || null };
}

function createApprovalCenterService({ prisma = prismaDefault, clock = () => new Date() } = {}) {
  async function list({ actor, limit = 100 }) {
    if (actor?.role !== 'ADMIN') throw new HttpError(403, 'Approval Center requires Admin authority.', { code: 'APPROVAL_CENTER_ADMIN_REQUIRED' });
    const take = Math.max(1, Math.min(Number(limit) || 100, 100));
    const [employeeMasterTotal, referencePhotoTotal, employeeChanges, referencePhotos] = await Promise.all([
      prisma.employeeChangeRequest.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.employeeReferencePhoto.count({ where: { status: 'PENDING_APPROVAL' } }),
      prisma.employeeChangeRequest.findMany({
        where: { status: 'PENDING_APPROVAL' },
        select: {
          id: true, employeeId: true, status: true, currentRevision: true, createdAt: true,
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true } },
          requestOwner: { select: { id: true, displayName: true, role: true } },
          revisions: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true, changedFields: true, submittedAt: true } }
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100
      }),
      prisma.employeeReferencePhoto.findMany({
        where: { status: 'PENDING_APPROVAL' },
        select: {
          id: true, employeeId: true, status: true, safeDisplayFileName: true, mimeType: true, fileSize: true,
          imageWidth: true, imageHeight: true, uploadedByRoleSnapshot: true, uploadedAt: true,
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true } },
          uploadedBy: { select: { id: true, displayName: true, role: true } }
        },
        orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
        take: 100
      })
    ]);

    const now = clock();
    const changeItems = employeeChanges.map((row) => {
      const revision = row.revisions?.[0];
      const submittedAt = revision?.submittedAt || row.createdAt;
      const age = approvalUrgency(submittedAt, now);
      return {
        id: 'employee-change:' + row.id,
        requestId: row.id,
        type: 'EMPLOYEE_MASTER_CHANGE',
        title: 'แก้ไขข้อมูลพนักงาน',
        status: row.status,
        employee: employeeSummary(row.employee),
        requestedBy: actorSummary(row.requestOwner, 'MANAGER'),
        submittedAt,
        ageHours: age.ageHours,
        urgency: age.urgency,
        revision: row.currentRevision,
        changedFields: Array.isArray(revision?.changedFields) ? revision.changedFields : []
      };
    });

    const photoItems = referencePhotos.map((row) => {
      const age = approvalUrgency(row.uploadedAt, now);
      return {
        id: 'reference-photo:' + row.id,
        requestId: row.id,
        type: 'EMPLOYEE_REFERENCE_PHOTO',
        title: 'รูปอ้างอิงพนักงาน',
        status: row.status,
        employee: employeeSummary(row.employee),
        requestedBy: actorSummary(row.uploadedBy, row.uploadedByRoleSnapshot),
        submittedAt: row.uploadedAt,
        ageHours: age.ageHours,
        urgency: age.urgency,
        photo: {
          fileName: row.safeDisplayFileName,
          mimeType: row.mimeType,
          fileSize: row.fileSize,
          imageWidth: row.imageWidth,
          imageHeight: row.imageHeight
        }
      };
    });

    const priority = { OVERDUE: 3, DUE_SOON: 2, NEW: 1 };
    const all = [...changeItems, ...photoItems].sort((a, b) => {
      const urgency = (priority[b.urgency] || 0) - (priority[a.urgency] || 0);
      if (urgency) return urgency;
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });
    const total = employeeMasterTotal + referencePhotoTotal;
    const items = all.slice(0, take);
    return {
      data: items,
      summary: {
        total,
        employeeMasterChanges: employeeMasterTotal,
        referencePhotos: referencePhotoTotal,
        dueSoon24h: all.filter((item) => item.urgency === 'DUE_SOON').length,
        overdue48h: all.filter((item) => item.urgency === 'OVERDUE').length,
        truncated: total > items.length
      },
      generatedAt: now.toISOString()
    };
  }

  return { list };
}

module.exports = { createApprovalCenterService, approvalUrgency };
