#!/usr/bin/env node
'use strict';

const { PrismaClient } = require('@prisma/client');
const { verifyPreviewDatabaseTarget } = require('../../src/services/runtime-database-target-guard.service');

const EMPLOYEE_CODE = 'UAT-G06-20260911-01';
const prisma = new PrismaClient();
const dateText = (value) => value ? new Date(value).toISOString().slice(0, 10) : null;
const iso = (value) => value ? new Date(value).toISOString() : null;

function bangkokDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  process.env.VERCEL_ENV = 'preview';
  verifyPreviewDatabaseTarget(process.env);

  const today = bangkokDateParts();
  const month = `${today.slice(0, 7)}-01`;
  const employee = await prisma.employee.findUnique({
    where: { employeeCode: EMPLOYEE_CODE },
    select: {
      id: true, employeeCode: true, displayName: true, department: true, jobTitle: true, isActive: true, deletedAt: true,
      user: { select: { id: true, email: true, role: true, employeeId: true, isActive: true, accountStatus: true } },
      attendanceDevices: { where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' }, take: 3, select: { id: true, status: true, activatedAt: true, proofVerifiedAt: true, revokedAt: true } },
      referencePhotos: { where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' }, take: 3, select: { id: true, status: true, activatedAt: true, reviewedAt: true, supersededAt: true } }
    }
  });

  const assignments = employee ? await prisma.shiftAssignment.findMany({
    where: {
      employeeId: employee.id,
      workDate: {
        gte: new Date(`${today}T00:00:00.000Z`),
        lt: new Date(new Date(`${today}T00:00:00.000Z`).getTime() + 86400000)
      }
    },
    include: { shiftType: true, securitySite: true },
    orderBy: { workDate: 'asc' }
  }) : [];

  const approval = await prisma.scheduleApproval.findFirst({
    where: { month: new Date(`${month}T00:00:00.000Z`) },
    orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }]
  });

  const departmentMaster = employee?.department ? await prisma.departmentMaster.findFirst({
    where: { name: employee.department },
    select: { id: true, code: true, name: true, isActive: true }
  }) : null;

  const defaultSites = departmentMaster ? await prisma.$queryRawUnsafe(`
    SELECT s.id, s.code, s.name, s.geofence_radius_meters AS "geofenceRadiusMeters", s.is_active AS "isActive", ssd.is_default AS "isDefault"
    FROM security_site_departments ssd
    JOIN security_sites s ON s.id = ssd.security_site_id
    WHERE ssd.department_master_id = $1::uuid
    ORDER BY ssd.is_default DESC, s.code ASC
  `, departmentMaster.id) : [];

  const dayShift = await prisma.shiftType.findFirst({
    where: { code: 'D' },
    select: { id: true, code: true, name: true, startTime: true, endTime: true, hours: true, isActive: true }
  });
  const diagnosticNow = new Date();
  const activeSites = await prisma.securitySite.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      geofenceRadiusMeters: true,
      qrCredentials: {
        where: {
          revokedAt: null,
          validFrom: { lte: diagnosticNow },
          OR: [{ validUntil: null }, { validUntil: { gt: diagnosticNow } }]
        },
        orderBy: { version: 'desc' },
        take: 1,
        select: { id: true, version: true, validFrom: true, validUntil: true }
      }
    }
  });

  console.log('G06_CURRENT_FIXTURE_PREVIEW_READONLY_BEGIN');
  console.log(JSON.stringify({
    mode: 'READ_ONLY_G06_CURRENT_FIXTURE_PREVIEW',
    databaseMutationPerformed: false,
    previewDatabaseTarget: 'verified',
    todayBangkok: today,
    employee: employee ? {
      employeeCode: employee.employeeCode,
      displayName: employee.displayName,
      department: employee.department,
      jobTitle: employee.jobTitle,
      isActive: employee.isActive,
      deletedAt: iso(employee.deletedAt),
      account: employee.user ? {
        email: employee.user.email,
        role: employee.user.role,
        linked: employee.user.employeeId === employee.id,
        isActive: employee.user.isActive,
        accountStatus: employee.user.accountStatus
      } : null,
      facePrerequisites: {
        activeAttendanceDeviceCount: employee.attendanceDevices.length,
        attendanceDevices: employee.attendanceDevices.map((row) => ({
          id: row.id,
          status: row.status,
          activatedAt: iso(row.activatedAt),
          proofVerified: Boolean(row.proofVerifiedAt),
          proofVerifiedAt: iso(row.proofVerifiedAt),
          revokedAt: iso(row.revokedAt)
        })),
        activeReferencePhotoCount: employee.referencePhotos.length,
        referencePhotos: employee.referencePhotos.map((row) => ({
          id: row.id,
          status: row.status,
          activatedAt: iso(row.activatedAt),
          reviewedAt: iso(row.reviewedAt),
          supersededAt: iso(row.supersededAt)
        })),
        attendanceDeviceReady: employee.attendanceDevices.length === 1 && Boolean(employee.attendanceDevices[0]?.proofVerifiedAt),
        referencePhotoReady: employee.referencePhotos.length === 1
      }
    } : null,
    todayAssignments: assignments.map((row) => ({
      id: row.id,
      workDate: dateText(row.workDate),
      source: row.source,
      locked: row.locked,
      shiftType: row.shiftType ? {
        code: row.shiftType.code,
        name: row.shiftType.name,
        startTime: row.startTime || row.shiftType.startTime,
        endTime: row.endTime || row.shiftType.endTime,
        active: row.shiftType.isActive
      } : null,
      securitySite: row.securitySite ? {
        code: row.securitySite.code,
        name: row.securitySite.name,
        active: row.securitySite.isActive,
        geofenceRadiusMeters: row.securitySite.geofenceRadiusMeters
      } : null
    })),
    currentMonthApproval: approval ? {
      month: dateText(approval.month),
      status: approval.status,
      revision: approval.revision,
      approvedAt: iso(approval.approvedAt),
      changeType: approval.changeType
    } : null,
    departmentMaster,
    activeSecuritySiteCount: activeSites.length,
    activeSecuritySites: activeSites.map((site) => ({
      code: site.code,
      name: site.name,
      geofenceRadiusMeters: site.geofenceRadiusMeters,
      validQrReady: site.qrCredentials.length === 1,
      currentQrVersion: site.qrCredentials[0]?.version || null,
      currentQrValidFrom: iso(site.qrCredentials[0]?.validFrom),
      currentQrValidUntil: iso(site.qrCredentials[0]?.validUntil)
    })),
    departmentSites: defaultSites.map((row) => ({
      code: row.code,
      name: row.name,
      geofenceRadiusMeters: Number(row.geofenceRadiusMeters),
      active: row.isActive === true,
      isDefault: row.isDefault === true
    })),
    dayShift: dayShift ? {
      code: dayShift.code,
      name: dayShift.name,
      startTime: dayShift.startTime,
      endTime: dayShift.endTime,
      hours: String(dayShift.hours),
      active: dayShift.isActive
    } : null
  }, null, 2));
  console.log('G06_CURRENT_FIXTURE_PREVIEW_READONLY_END');
})()
  .catch((error) => {
    console.error(`G06_CURRENT_FIXTURE_PREVIEW_READONLY_FAILED ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
