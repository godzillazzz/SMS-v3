#!/usr/bin/env node
'use strict';

const { PrismaClient } = require('@prisma/client');
const { createOnboardingReadinessService } = require('../../src/services/onboarding-readiness.service');

const EMPLOYEE_CODE = 'UAT-ST-20260902';
const prisma = new PrismaClient();
const iso = (v) => v ? new Date(v).toISOString() : null;
const isoDate = (v) => v ? new Date(v).toISOString().slice(0, 10) : null;

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const employee = await prisma.employee.findUnique({
    where: { employeeCode: EMPLOYEE_CODE },
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      displayName: true,
      department: true,
      jobTitle: true,
      isActive: true,
      deletedAt: true,
      user: {
        select: {
          id: true,
          displayName: true,
          role: true,
          isActive: true,
          accountStatus: true,
          employeeId: true
        }
      },
      referencePhotos: {
        where: { status: 'ACTIVE' },
        select: { id: true, status: true, activatedAt: true },
        orderBy: { activatedAt: 'desc' }
      },
      attendanceDevices: {
        where: { status: 'ACTIVE' },
        select: { id: true, status: true, activatedAt: true, proofVerifiedAt: true, displayName: true },
        orderBy: { activatedAt: 'desc' }
      }
    }
  });

  if (!employee) {
    console.log('G06_UAT_READINESS_BEGIN');
    console.log(JSON.stringify({
      mode: 'READ_ONLY_G06_UAT_READINESS',
      databaseMutationPerformed: false,
      employeeCode: EMPLOYEE_CODE,
      found: false,
      status: 'NOT_READY',
      blocker: 'EMPLOYEE_NOT_FOUND'
    }, null, 2));
    console.log('G06_UAT_READINESS_END');
    return;
  }

  const service = createOnboardingReadinessService({ prisma });
  const readiness = await service.getEmployeeReadiness({ employeeId: employee.id });

  const nextAssignment = await prisma.shiftAssignment.findFirst({
    where: {
      employeeId: employee.id,
      workDate: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) }
    },
    orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
    include: {
      shiftType: { select: { id: true, code: true, name: true, isActive: true } },
      securitySite: { select: { id: true, code: true, name: true, isActive: true } }
    }
  });

  const approvalMonths = ['2026-07', '2026-08', '2026-09'];
  const approvalStatus = [];
  for (const key of approvalMonths) {
    const [year, month] = key.split('-').map(Number);
    const row = await prisma.scheduleApproval.findFirst({
      where: { month: new Date(Date.UTC(year, month - 1, 1)) },
      orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true, status: true, revision: true, month: true, updatedAt: true, approvedAt: true }
    });
    approvalStatus.push({
      month: key,
      status: row?.status || 'MISSING',
      revision: row?.revision || null,
      updatedAt: iso(row?.updatedAt),
      approvedAt: iso(row?.approvedAt)
    });
  }

  const output = {
    mode: 'READ_ONLY_G06_UAT_READINESS',
    databaseMutationPerformed: false,
    found: true,
    checkedAt: iso(readiness.checkedAt),
    employee: {
      id: employee.id,
      employeeCode: employee.employeeCode,
      name: employee.displayName || `${employee.firstName} ${employee.lastName}`.trim(),
      active: employee.isActive && !employee.deletedAt,
      department: employee.department,
      position: employee.jobTitle
    },
    accountLink: {
      linked: Boolean(employee.user),
      linkedToSameEmployee: Boolean(employee.user && employee.user.employeeId === employee.id),
      displayName: employee.user?.displayName || null,
      role: employee.user?.role || null,
      isActive: employee.user?.isActive || false,
      accountStatus: employee.user?.accountStatus || 'MISSING'
    },
    referencePhoto: {
      activeCount: employee.referencePhotos.length,
      active: employee.referencePhotos.map((row) => ({ id: row.id, activatedAt: iso(row.activatedAt) }))
    },
    attendanceDevice: {
      activeCount: employee.attendanceDevices.length,
      proofVerifiedCount: employee.attendanceDevices.filter((row) => Boolean(row.proofVerifiedAt)).length,
      active: employee.attendanceDevices.map((row) => ({ id: row.id, displayName: row.displayName, activatedAt: iso(row.activatedAt), proofVerifiedAt: iso(row.proofVerifiedAt) }))
    },
    nextAssignment: nextAssignment ? {
      id: nextAssignment.id,
      workDate: isoDate(nextAssignment.workDate),
      shiftCode: nextAssignment.shiftType?.code || null,
      shiftName: nextAssignment.shiftType?.name || null,
      shiftActive: nextAssignment.shiftType?.isActive ?? null,
      securitySiteCode: nextAssignment.securitySite?.code || null,
      securitySiteName: nextAssignment.securitySite?.name || null,
      securitySiteActive: nextAssignment.securitySite?.isActive ?? null,
      licenseStatus: nextAssignment.licenseStatus || null
    } : null,
    readiness: {
      status: readiness.status,
      checks: readiness.checks,
      blockers: readiness.blockers
    },
    scheduleApprovalLatest: approvalStatus
  };

  console.log('G06_UAT_READINESS_BEGIN');
  console.log(JSON.stringify(output, null, 2));
  console.log('G06_UAT_READINESS_END');
})()
  .catch((error) => {
    console.error(`G06_UAT_READINESS_FAILED ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });