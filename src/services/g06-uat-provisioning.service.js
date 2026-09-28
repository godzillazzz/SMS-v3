'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const audit = require('./audit.service');
const personnelMaster = require('./personnel-master.service');
const { verifyPreviewDatabaseTarget } = require('./runtime-database-target-guard.service');
const { haversineMeters } = require('./attendance-site-evidence.service');
const HttpError = require('../utils/http-error');

const G06_UAT_EMPLOYEE_CODE = 'UAT-G06-20260911-01';
const G06_UAT_EMAIL = 'uat-g06-20260911-01@example.invalid';
const G06_UAT_DISPLAY_NAME = 'G06 Preview UAT';
const G06_UAT_PURPOSE = 'G06 Face Diagnostic';
const G06_UAT_ROLE = 'VIEWER';
const PASSWORD_LENGTH = 20;
const G06_UAT_SHIFT_CODE = 'D';
const G06_UAT_ASSIGNMENT_SOURCE = 'G06_PREVIEW_UAT';
const G06_UAT_MAX_LOCATION_ACCURACY_METERS = 50;
const G06_UAT_LOCATION_MAX_AGE_MS = 3 * 60 * 1000;

const employeeSelect = {
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
      email: true,
      displayName: true,
      role: true,
      employeeId: true,
      isActive: true,
      accountStatus: true,
      passwordResetRequired: true
    }
  }
};

function previewOnlyError(code = 'G06_UAT_PREVIEW_ONLY') {
  return new HttpError(403, 'G06 UAT provisioning is available only on a guarded Preview runtime.', { code });
}

function assertPreviewOnly({ environment = process.env, verifyDatabaseTarget = verifyPreviewDatabaseTarget } = {}) {
  const vercelEnvironment = String(environment.VERCEL_ENV || '').trim().toLowerCase();
  const deploymentTarget = String(environment.VERCEL_TARGET_ENV || environment.VERCEL_TARGET || '').trim().toLowerCase();
  const deploymentHost = String(environment.VERCEL_URL || '').trim().toLowerCase();
  if (vercelEnvironment !== 'preview' || deploymentTarget === 'production' || deploymentHost === 'sms-v3-staging-ten.vercel.app') {
    throw previewOnlyError();
  }
  try {
    verifyDatabaseTarget(environment);
  } catch {
    throw previewOnlyError('G06_UAT_PREVIEW_DATABASE_TARGET_REQUIRED');
  }
  return { environment: 'preview', productionDenied: true, databaseTarget: 'verified' };
}

function randomTemporaryPassword(randomBytes = crypto.randomBytes) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = randomBytes(PASSWORD_LENGTH);
  let password = '';
  for (const byte of bytes) password += alphabet[byte % alphabet.length];
  return password;
}

function safeState(employee, { created = false, duplicate = false, temporaryPassword = null } = {}) {
  const user = employee?.user || null;
  return {
    created,
    duplicate,
    employee: employee ? {
      id: employee.id,
      employeeCode: employee.employeeCode,
      displayName: employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      department: employee.department || null,
      jobTitle: employee.jobTitle || null,
      isActive: Boolean(employee.isActive),
      deleted: Boolean(employee.deletedAt),
      accountLinked: Boolean(user)
    } : null,
    account: user ? {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      employeeId: user.employeeId,
      isActive: Boolean(user.isActive),
      accountStatus: user.accountStatus,
      passwordResetRequired: Boolean(user.passwordResetRequired)
    } : null,
    temporaryPassword
  };
}

function bangkokWorkDate(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function scheduleMonth(workDate) {
  return new Date(`${workDate.slice(0, 7)}-01T00:00:00.000Z`);
}

function normalizedUatLocation(location, now) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const accuracyMeters = Number(location?.accuracyMeters);
  const capturedAt = new Date(location?.capturedAt);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new HttpError(400, 'Valid GPS coordinates are required.', { code: 'G06_UAT_LOCATION_INVALID' });
  }
  if (!Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > G06_UAT_MAX_LOCATION_ACCURACY_METERS) {
    throw new HttpError(409, 'GPS accuracy is not sufficient for UAT Site authority preparation.', { code: 'G06_UAT_LOCATION_ACCURACY_REQUIRED' });
  }
  if (Number.isNaN(capturedAt.getTime()) || Math.abs(now.getTime() - capturedAt.getTime()) > G06_UAT_LOCATION_MAX_AGE_MS) {
    throw new HttpError(409, 'A fresh GPS sample is required for UAT Site authority preparation.', { code: 'G06_UAT_LOCATION_FRESH_REQUIRED' });
  }
  return { latitude, longitude, accuracyMeters, capturedAt };
}

function safeAttendanceAuthority({ assignment, site, shiftType, approval, idempotent }) {
  return {
    idempotent: Boolean(idempotent),
    workDate: assignment.workDate,
    assignment: { id: assignment.id, source: assignment.source, locked: assignment.locked === true },
    shift: { code: shiftType.code, name: shiftType.name, startTime: assignment.startTime || shiftType.startTime, endTime: assignment.endTime || shiftType.endTime },
    site: { id: site.id, code: site.code, name: site.name, geofenceRadiusMeters: site.geofenceRadiusMeters },
    approval: { status: approval.status, revision: approval.revision, month: approval.month },
    provisioningPath: 'GOVERNED_PREVIEW_ONLY',
    previewDatabaseTarget: 'verified'
  };
}
function createG06UatProvisioningService({
  prismaClient = prisma,
  auditService = audit,
  hashPassword = (password) => bcrypt.hash(password, 12),
  generatePassword = randomTemporaryPassword,
  environment = process.env,
  verifyDatabaseTarget = verifyPreviewDatabaseTarget,
  clock = () => new Date()
} = {}) {
  async function prepareAttendanceAuthority({ actorUserId, location }) {
    assertPreviewOnly({ environment, verifyDatabaseTarget });
    if (!actorUserId) throw new HttpError(401, 'Authenticated ADMIN authority is required.', { code: 'G06_UAT_ACTOR_REQUIRED' });
    const now = clock();
    const sample = normalizedUatLocation(location, now);
    const workDateText = bangkokWorkDate(now);
    const workDate = new Date(`${workDateText}T00:00:00.000Z`);

    return prismaClient.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { employeeCode: G06_UAT_EMPLOYEE_CODE }, select: employeeSelect });
      if (!employee || employee.isActive !== true || employee.deletedAt || !employee.user || employee.user.employeeId !== employee.id || employee.user.isActive !== true || employee.user.accountStatus !== 'ACTIVE') {
        throw new HttpError(409, 'The reserved G06 UAT Employee/Account must exist and be active before preparing Attendance authority.', { code: 'G06_UAT_ACCOUNT_NOT_READY' });
      }

      const approval = await tx.scheduleApproval.findFirst({ where: { month: scheduleMonth(workDateText) }, orderBy: [{ revision: 'desc' }, { updatedAt: 'desc' }] });
      if (!approval || approval.status !== 'APPROVED') {
        throw new HttpError(409, 'The current monthly Schedule must already be APPROVED; UAT preparation will not change Schedule approval.', { code: 'G06_UAT_SCHEDULE_APPROVAL_REQUIRED' });
      }

      const shiftType = await tx.shiftType.findUnique({ where: { code: G06_UAT_SHIFT_CODE } });
      if (!shiftType || shiftType.isActive !== true || !shiftType.startTime || !shiftType.endTime) {
        throw new HttpError(409, 'Active Day Shift D is required for G06 Attendance UAT.', { code: 'G06_UAT_SHIFT_TYPE_REQUIRED' });
      }

      const sites = await tx.securitySite.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
      const candidates = sites.map((site) => {
        const distanceMeters = haversineMeters(sample.latitude, sample.longitude, Number(site.latitude), Number(site.longitude));
        return { site, distanceMeters, confidentlyInside: distanceMeters + sample.accuracyMeters <= Number(site.geofenceRadiusMeters) };
      }).filter((candidate) => candidate.confidentlyInside).sort((a, b) => a.distanceMeters - b.distanceMeters);
      if (!candidates.length) {
        throw new HttpError(409, 'Current GPS is not confidently inside any Active Security Site in Preview.', { code: 'G06_UAT_SITE_NOT_CONFIDENT_INSIDE' });
      }
      const selected = candidates[0];

      const existing = await tx.shiftAssignment.findFirst({ where: { employeeId: employee.id, workDate } });
      if (existing) {
        if (existing.source !== G06_UAT_ASSIGNMENT_SOURCE || existing.securitySiteId !== selected.site.id || existing.shiftTypeId !== shiftType.id) {
          throw new HttpError(409, 'An existing non-G06 Shift Assignment already owns this UAT Employee/date and will not be overwritten.', { code: 'G06_UAT_ASSIGNMENT_CONFLICT' });
        }
        return safeAttendanceAuthority({ assignment: existing, site: selected.site, shiftType, approval, idempotent: true });
      }

      const assignment = await tx.shiftAssignment.create({
        data: {
          employeeId: employee.id,
          shiftTypeId: shiftType.id,
          securitySiteId: selected.site.id,
          workDate,
          employeeNameSnapshot: employee.displayName || `${employee.firstName} ${employee.lastName}`,
          departmentSnapshot: employee.department,
          startTime: shiftType.startTime,
          endTime: shiftType.endTime,
          hours: shiftType.hours,
          remark: 'Preview-only G06 GPS Attendance UAT authority',
          source: G06_UAT_ASSIGNMENT_SOURCE,
          locked: true
        }
      });

      await auditService.log({
        actorUserId,
        action: 'CREATE',
        entityType: 'ShiftAssignment',
        entityId: assignment.id,
        metadata: {
          source: G06_UAT_ASSIGNMENT_SOURCE,
          employeeCode: G06_UAT_EMPLOYEE_CODE,
          workDate: workDateText,
          shiftCode: shiftType.code,
          securitySiteId: selected.site.id,
          securitySiteCode: selected.site.code,
          gpsDistanceMeters: Number(selected.distanceMeters.toFixed(2)),
          gpsAccuracyMeters: sample.accuracyMeters,
          scheduleApprovalStatus: approval.status,
          scheduleApprovalRevision: approval.revision,
          productionChanged: false
        }
      }, tx);

      return safeAttendanceAuthority({ assignment, site: selected.site, shiftType, approval, idempotent: false });
    }, { isolationLevel: 'Serializable' });
  }
  async function provision({ actorUserId }) {
    assertPreviewOnly({ environment, verifyDatabaseTarget });
    if (!actorUserId) throw new HttpError(401, 'Authenticated ADMIN authority is required.', { code: 'G06_UAT_ACTOR_REQUIRED' });

    try {
      const result = await prismaClient.$transaction(async (tx) => {
        const existing = await tx.employee.findUnique({ where: { employeeCode: G06_UAT_EMPLOYEE_CODE }, select: employeeSelect });
        if (existing) return safeState(existing, { duplicate: true });

        const department = await personnelMaster.assertActiveValue(tx, 'department', 'UAT-PREVIEW');
        const jobTitle = await personnelMaster.assertActiveValue(tx, 'position', 'Officer');
        if (!department || !jobTitle) throw new HttpError(409, 'Required Preview UAT Department/Position master is unavailable.', { code: 'G06_UAT_MASTER_AUTHORITY_REQUIRED' });

        const emailConflict = await tx.user.findUnique({ where: { email: G06_UAT_EMAIL }, select: { id: true, employeeId: true } });
        if (emailConflict) throw new HttpError(409, 'The reserved G06 UAT login identifier is already in use.', { code: 'G06_UAT_EMAIL_CONFLICT' });
        const employeeEmailConflict = await tx.employee.findUnique({ where: { email: G06_UAT_EMAIL }, select: { id: true } });
        if (employeeEmailConflict) throw new HttpError(409, 'The reserved G06 UAT email is already linked to another Employee.', { code: 'G06_UAT_EMPLOYEE_EMAIL_CONFLICT' });

        const now = clock();
        const temporaryPassword = generatePassword();
        const passwordHash = await hashPassword(temporaryPassword);
        const employee = await tx.employee.create({
          data: {
            employeeCode: G06_UAT_EMPLOYEE_CODE,
            firstName: 'G06',
            lastName: 'Preview UAT',
            displayName: G06_UAT_DISPLAY_NAME,
            email: G06_UAT_EMAIL,
            department,
            jobTitle,
            hiredAt: now,
            skill: G06_UAT_PURPOSE,
            isActive: true
          },
          select: { id: true, employeeCode: true, firstName: true, lastName: true, displayName: true, department: true, jobTitle: true, isActive: true, deletedAt: true }
        });
        const user = await tx.user.create({
          data: {
            email: G06_UAT_EMAIL,
            passwordHash,
            displayName: G06_UAT_DISPLAY_NAME,
            role: G06_UAT_ROLE,
            isActive: true,
            employeeId: employee.id,
            department,
            accountStatus: 'ACTIVE',
            passwordResetRequired: false,
            requestedAt: now,
            approvedAt: now
          },
          select: { id: true, email: true, displayName: true, role: true, employeeId: true, isActive: true, accountStatus: true, passwordResetRequired: true }
        });

        const metadata = {
          event: 'UAT_PROVISION',
          provisioningPath: 'GOVERNED_PREVIEW_ONLY',
          environment: 'Preview',
          purpose: G06_UAT_PURPOSE,
          employeeCode: employee.employeeCode,
          employeeId: employee.id,
          accountId: user.id,
          role: user.role,
          otpPublicFlowChanged: false
        };
        await auditService.log({ actorUserId, action: 'CREATE', entityType: 'G06UatProvisioning', entityId: employee.id, metadata }, tx);
        await auditService.log({ actorUserId, action: 'CREATE', entityType: 'Employee', entityId: employee.id, metadata: { source: 'G06UatProvisioning', employeeCode: employee.employeeCode, purpose: G06_UAT_PURPOSE } }, tx);
        await auditService.log({ actorUserId, action: 'CREATE', entityType: 'User', entityId: user.id, metadata: { source: 'G06UatProvisioning', employeeId: employee.id, employeeCode: employee.employeeCode, role: user.role, environment: 'Preview' } }, tx);

        return { ...safeState({ ...employee, user }, { created: true }), temporaryPassword };
      }, { isolationLevel: 'Serializable' });
      return { ...result, provisioningPath: 'GOVERNED_PREVIEW_ONLY', otpPublicFlowChanged: false, previewDatabaseTarget: 'verified' };
    } catch (error) {
      if (error?.code === 'P2002' || error?.code === 'P2034') {
        const existing = await prismaClient.employee.findUnique({ where: { employeeCode: G06_UAT_EMPLOYEE_CODE }, select: employeeSelect });
        if (existing) return { ...safeState(existing, { duplicate: true }), provisioningPath: 'GOVERNED_PREVIEW_ONLY', otpPublicFlowChanged: false, previewDatabaseTarget: 'verified' };
      }
      throw error;
    }
  }

  return { provision, prepareAttendanceAuthority };
}

module.exports = {
  G06_UAT_EMPLOYEE_CODE,
  G06_UAT_EMAIL,
  G06_UAT_DISPLAY_NAME,
  G06_UAT_PURPOSE,
  G06_UAT_ROLE,
  G06_UAT_SHIFT_CODE,
  G06_UAT_ASSIGNMENT_SOURCE,
  assertPreviewOnly,
  randomTemporaryPassword,
  createG06UatProvisioningService
};
