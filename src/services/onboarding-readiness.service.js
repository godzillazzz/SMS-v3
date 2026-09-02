'use strict';

const prismaDefault = require('../config/prisma');
const HttpError = require('../utils/http-error');
const { createSecuritySiteAuthorityService } = require('./security-site-authority.service');

function blocker(code, label, detail) { return { code, label, detail }; }
function monthStart(value) { const d = new Date(value); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function bangkokWorkDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function createOnboardingReadinessService({ prisma = prismaDefault, siteAuthorityService = null, clock = () => new Date() } = {}) {
  const siteAuthority = siteAuthorityService || createSecuritySiteAuthorityService({ prisma });
  async function getEmployeeReadiness({ employeeId }) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: {
        user: { select: { id: true, role: true, isActive: true, accountStatus: true } },
        referencePhotos: { where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' }, take: 1, select: { id: true, activatedAt: true } },
        attendanceDevices: { where: { status: 'ACTIVE' }, orderBy: { activatedAt: 'desc' }, take: 2, select: { id: true, status: true, activatedAt: true, proofVerifiedAt: true } }
      }
    });
    if (!employee) throw new HttpError(404, 'Employee not found.');

    const now = clock();
    const assignment = await prisma.shiftAssignment.findFirst({
      where: { employeeId, workDate: { gte: new Date(bangkokWorkDate(now) + 'T00:00:00.000Z') } },
      orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
      include: { shiftType: true, securitySite: true }
    });
    const approval = assignment ? await prisma.scheduleApproval.findFirst({ where: { month: monthStart(assignment.workDate) }, orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }] }) : null;
    let site = null;
    let siteError = null;
    if (assignment) {
      try { site = await siteAuthority.resolve({ assignment, employee }); }
      catch (error) { siteError = error; }
    }

    const blockers = [];
    if (!employee.isActive) blockers.push(blocker('EMPLOYEE_INACTIVE', 'Employee', 'พนักงานไม่ได้อยู่ในสถานะปฏิบัติงาน'));
    if (!employee.department) blockers.push(blocker('DEPARTMENT_REQUIRED', 'Department', 'ยังไม่ได้กำหนด Department จาก Master'));
    if (!employee.jobTitle) blockers.push(blocker('POSITION_REQUIRED', 'Position', 'ยังไม่ได้กำหนด Position จาก Master'));
    if (!employee.user) blockers.push(blocker('ACCOUNT_REQUIRED', 'User Account', 'ยังไม่มีบัญชีผู้ใช้ที่เชื่อมกับ Employee'));
    else if (!employee.user.isActive || employee.user.accountStatus !== 'ACTIVE') blockers.push(blocker('ACCOUNT_NOT_ACTIVE', 'User Account', 'บัญชีผู้ใช้ยังไม่ Active'));
    if (!employee.referencePhotos.length) blockers.push(blocker('REFERENCE_PHOTO_REQUIRED', 'Reference Photo', 'ยังไม่มี Reference Photo ที่ ACTIVE'));
    if (!assignment) blockers.push(blocker('SCHEDULE_REQUIRED', 'Schedule', 'ยังไม่มี Shift Assignment ปัจจุบันหรือในอนาคต'));
    else {
      if (!assignment.shiftType) blockers.push(blocker('SHIFT_REQUIRED', 'Shift', 'Shift Assignment ไม่มี Shift authority'));
      if (!approval || approval.status !== 'APPROVED') blockers.push(blocker('SCHEDULE_NOT_APPROVED', 'Schedule Approval', 'เดือนของ Shift Assignment ยังไม่ได้รับอนุมัติ'));
      if (siteError || !site) blockers.push(blocker(siteError?.details?.code || 'SITE_REQUIRED', 'Security Site', siteError?.message || 'ยังไม่มี Security Site authority สำหรับ Shift Assignment'));
    }
    if (employee.attendanceDevices.length !== 1 || !employee.attendanceDevices[0]?.proofVerifiedAt) blockers.push(blocker('ATTENDANCE_DEVICE_REQUIRED', 'Attendance Device', employee.attendanceDevices.length > 1 ? 'พบ Active Attendance Device มากกว่าหนึ่งเครื่อง ต้องแก้ authority conflict' : 'ยังไม่มี Active cryptographic Attendance Device ที่ผ่าน proof'));

    const checks = {
      employee: { ready: employee.isActive, status: employee.isActive ? 'ACTIVE' : 'INACTIVE' },
      structure: { ready: Boolean(employee.department && employee.jobTitle), department: employee.department, position: employee.jobTitle },
      account: { ready: Boolean(employee.user?.isActive && employee.user?.accountStatus === 'ACTIVE'), status: employee.user?.accountStatus || 'MISSING', role: employee.user?.role || null },
      referencePhoto: { ready: employee.referencePhotos.length === 1, status: employee.referencePhotos.length ? 'ACTIVE' : 'MISSING' },
      schedule: { ready: Boolean(assignment && approval?.status === 'APPROVED'), workDate: assignment?.workDate || null, approvalStatus: approval?.status || 'MISSING', shiftCode: assignment?.shiftType?.code || null, shiftName: assignment?.shiftType?.name || null },
      site: { ready: Boolean(site), id: site?.site?.id || null, code: site?.site?.code || null, name: site?.site?.name || null, source: site?.source || null },
      device: { ready: employee.attendanceDevices.length === 1 && Boolean(employee.attendanceDevices[0]?.proofVerifiedAt), activeCount: employee.attendanceDevices.length }
    };
    return { employeeId, status: blockers.length ? 'NOT_READY' : 'READY', checkedAt: now, checks, blockers };
  }
  async function listEmployeeReadiness({ search = '', limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 50));
    const term = String(search || '').trim();
    const employees = await prisma.employee.findMany({
      where: { deletedAt: null, ...(term ? { OR: [{ employeeCode: { contains: term, mode: 'insensitive' } }, { firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }] } : {}) },
      orderBy: [{ employeeCode: 'asc' }],
      take: safeLimit,
      select: { id: true, employeeCode: true, firstName: true, lastName: true, department: true, jobTitle: true, isActive: true }
    });
    const rows = [];
    for (const employee of employees) {
      const readiness = await getEmployeeReadiness({ employeeId: employee.id });
      rows.push({ employee, status: readiness.status, checks: readiness.checks, blockers: readiness.blockers, checkedAt: readiness.checkedAt });
    }
    const ready = rows.filter((row) => row.status === 'READY').length;
    const blockerCounts = {};
    for (const row of rows) for (const item of row.blockers) blockerCounts[item.code] = (blockerCounts[item.code] || 0) + 1;
    return { data: rows, summary: { total: rows.length, ready, notReady: rows.length - ready, blockerCounts }, limitedTo: safeLimit };
  }
  return { getEmployeeReadiness, listEmployeeReadiness };
}

module.exports = { createOnboardingReadinessService, bangkokWorkDate };
