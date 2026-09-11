'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const audit = require('./audit.service');
const personnelMaster = require('./personnel-master.service');
const { verifyPreviewDatabaseTarget } = require('./runtime-database-target-guard.service');
const HttpError = require('../utils/http-error');

const G06_UAT_EMPLOYEE_CODE = 'UAT-G06-20260911-01';
const G06_UAT_EMAIL = 'uat-g06-20260911-01@example.invalid';
const G06_UAT_DISPLAY_NAME = 'G06 Preview UAT';
const G06_UAT_PURPOSE = 'G06 Face Diagnostic';
const G06_UAT_ROLE = 'VIEWER';
const PASSWORD_LENGTH = 20;

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

function createG06UatProvisioningService({
  prismaClient = prisma,
  auditService = audit,
  hashPassword = (password) => bcrypt.hash(password, 12),
  generatePassword = randomTemporaryPassword,
  environment = process.env,
  verifyDatabaseTarget = verifyPreviewDatabaseTarget,
  clock = () => new Date()
} = {}) {
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

  return { provision };
}

module.exports = {
  G06_UAT_EMPLOYEE_CODE,
  G06_UAT_EMAIL,
  G06_UAT_DISPLAY_NAME,
  G06_UAT_PURPOSE,
  G06_UAT_ROLE,
  assertPreviewOnly,
  randomTemporaryPassword,
  createG06UatProvisioningService
};
