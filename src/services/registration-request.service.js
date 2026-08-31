'use strict';

const prisma = require('../config/prisma');
const audit = require('./audit.service');
const HttpError = require('../utils/http-error');
const { logger } = require('../utils/logger');
const { createApprovalPolicyService } = require('./approval-policy.service');

const REGISTRATION_REVIEW_LOCK = 746281904;
const ACTIONABLE_STATUSES = ['PENDING', 'MATCHED'];
const candidateSelect = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  displayName: true,
  department: true,
  jobTitle: true,
  isActive: true
};
const requestSelect = {
  id: true,
  submittedName: true,
  email: true,
  departmentHint: true,
  status: true,
  emailVerifiedAt: true,
  matchedEmployeeId: true,
  reviewedByUserId: true,
  reviewedAt: true,
  approvedAt: true,
  rejectedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  matchedEmployee: { select: candidateSelect }
};

function displayName(employee) {
  return employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim();
}

function conflict(code, message) {
  return new HttpError(409, message, { code });
}

function assertReviewable(request) {
  if (!request) throw new HttpError(404, 'Registration request not found.');
  if (!request.emailVerifiedAt) throw conflict('REGISTRATION_EMAIL_NOT_VERIFIED', 'Registration request is not verified.');
  if (!ACTIONABLE_STATUSES.includes(request.status)) throw conflict('REGISTRATION_REQUEST_NOT_ACTIONABLE', 'Registration request is no longer actionable.');
}

function createRegistrationRequestService({ prismaClient = prisma, auditService = audit, notificationService = null, approvalPolicyService } = {}) {
  const policyService = approvalPolicyService || createApprovalPolicyService({ prismaClient, auditService });
  async function list({ page = 1, pageSize = 25, status }) {
    const where = {
      emailVerifiedAt: { not: null },
      ...(status ? { status } : { status: { in: ACTIONABLE_STATUSES } })
    };
    const [total, rows] = await prismaClient.$transaction([
      prismaClient.registrationRequest.count({ where }),
      prismaClient.registrationRequest.findMany({
        where,
        select: requestSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    return { data: rows, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async function getById(id) {
    const request = await prismaClient.registrationRequest.findFirst({ where: { id, emailVerifiedAt: { not: null } }, select: requestSelect });
    if (!request) throw new HttpError(404, 'Registration request not found.');
    return request;
  }

  async function searchCandidates({ id, search, page = 1, pageSize = 20 }) {
    const request = await prismaClient.registrationRequest.findUnique({
      where: { id },
      select: { id: true, submittedName: true, departmentHint: true, status: true, emailVerifiedAt: true }
    });
    assertReviewable(request);
    const query = String(search || request.submittedName || '').trim();
    if (query.length < 2) throw new HttpError(400, 'Search requires at least 2 characters.');
    const where = {
      deletedAt: null,
      isActive: true,
      user: { is: null },
      OR: [
        { displayName: { contains: query, mode: 'insensitive' } },
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } }
      ]
    };
    const [total, employees] = await prismaClient.$transaction([
      prismaClient.employee.count({ where }),
      prismaClient.employee.findMany({
        where,
        select: candidateSelect,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    return {
      data: employees,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        employeeMatchState: total === 0 ? 'EMPLOYEE_NOT_FOUND' : total === 1 ? 'SINGLE_CANDIDATE' : 'MULTIPLE_CANDIDATES',
        departmentHint: request.departmentHint || null
      }
    };
  }

  async function match({ id, employeeId, actorUserId, actorRole }) {
    return prismaClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_REVIEW_LOCK})`;
      await policyService.assertReviewer('REGISTRATION_REQUEST', { role: actorRole, sub: actorUserId }, tx);
      const request = await tx.registrationRequest.findUnique({ where: { id } });
      assertReviewable(request);
      const employee = await tx.employee.findFirst({
        where: { id: employeeId, deletedAt: null, isActive: true },
        select: { ...candidateSelect, user: { select: { id: true } } }
      });
      if (!employee) throw new HttpError(404, 'Employee not found.');
      if (employee.user) throw conflict('REGISTRATION_EMPLOYEE_ALREADY_LINKED', 'Employee is already linked to an account.');
      const existingUser = await tx.user.findUnique({ where: { email: request.email }, select: { id: true } });
      if (existingUser) throw conflict('REGISTRATION_EMAIL_ALREADY_ACTIVE', 'Registration email already belongs to an account.');

      const after = await tx.registrationRequest.update({
        where: { id },
        data: { status: 'MATCHED', matchedEmployeeId: employee.id, reviewedByUserId: actorUserId, reviewedAt: new Date() },
        select: requestSelect
      });
      await auditService.log({
        actorUserId,
        action: 'UPDATE',
        entityType: 'RegistrationRequest',
        entityId: id,
        metadata: { event: 'REGISTRATION_REQUEST_MATCHED', matchedEmployeeId: employee.id, result: 'matched' }
      }, tx);
      return after;
    }, { isolationLevel: 'Serializable' });
  }

  async function approve({ id, actorUserId, actorRole }) {
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_REVIEW_LOCK})`;
        await policyService.assertReviewer('REGISTRATION_REQUEST', { role: actorRole, sub: actorUserId }, tx);
        const request = await tx.registrationRequest.findUnique({ where: { id } });
        assertReviewable(request);
        if (request.status !== 'MATCHED' || !request.matchedEmployeeId) throw conflict('REGISTRATION_MATCH_REQUIRED', 'Match an Employee Master record before approval.');
        if (!request.passwordHash) throw conflict('REGISTRATION_CREDENTIAL_UNAVAILABLE', 'Registration credential is unavailable.');

        const employee = await tx.employee.findFirst({
          where: { id: request.matchedEmployeeId, deletedAt: null, isActive: true },
          select: { ...candidateSelect, department: true, user: { select: { id: true } } }
        });
        if (!employee) throw conflict('REGISTRATION_MATCH_STALE', 'Matched Employee is no longer eligible.');
        if (employee.user) throw conflict('REGISTRATION_EMPLOYEE_ALREADY_LINKED', 'Employee is already linked to an account.');
        if (await tx.user.findUnique({ where: { email: request.email }, select: { id: true } })) throw conflict('REGISTRATION_EMAIL_ALREADY_ACTIVE', 'Registration email already belongs to an account.');

        const claimed = await tx.registrationRequest.updateMany({
          where: { id, status: 'MATCHED', matchedEmployeeId: employee.id, emailVerifiedAt: { not: null } },
          data: { status: 'APPROVED', passwordHash: null, reviewedByUserId: actorUserId, reviewedAt: new Date(), approvedAt: new Date(), rejectedAt: null, rejectionReason: null }
        });
        if (claimed.count !== 1) throw conflict('REGISTRATION_APPROVAL_CONFLICT', 'Registration request changed before approval.');

        const user = await tx.user.create({
          data: {
            email: request.email,
            passwordHash: request.passwordHash,
            displayName: displayName(employee),
            role: 'VIEWER',
            isActive: true,
            employeeId: employee.id,
            department: employee.department || null,
            accountStatus: 'ACTIVE',
            passwordResetRequired: false,
            requestedAt: request.createdAt,
            approvedAt: new Date()
          },
          select: { id: true, email: true, displayName: true, role: true, employeeId: true, department: true, accountStatus: true, isActive: true }
        });
        await auditService.log({
          actorUserId,
          action: 'UPDATE',
          entityType: 'RegistrationRequest',
          entityId: id,
          metadata: { event: 'REGISTRATION_REQUEST_APPROVED', matchedEmployeeId: employee.id, assignedRole: 'VIEWER', userId: user.id }
        }, tx);
        await auditService.log({
          actorUserId,
          action: 'CREATE',
          entityType: 'User',
          entityId: user.id,
          metadata: { source: 'RegistrationRequest', registrationRequestId: id, employeeLinked: true, assignedRole: 'VIEWER' }
        }, tx);
        return { request: await tx.registrationRequest.findUnique({ where: { id }, select: requestSelect }), user };
      }, { isolationLevel: 'Serializable' });
      try {
        const notifier = notificationService || require('./notification-email.service');
        await notifier.notifyRegistrationDecision({ request: result.request, eventType: 'REGISTRATION_APPROVED' });
      } catch (notificationError) {
        logger.error('Registration approval notification failed after commit', { error: notificationError.message, registrationRequestId: result.request?.id });
      }
      return result;
    } catch (error) {
      if (error?.code === 'P2002' || error?.code === 'P2034') throw conflict('REGISTRATION_APPROVAL_CONFLICT', 'Registration approval conflicted with another account operation.');
      throw error;
    }
  }

  async function reject({ id, reason, actorUserId, actorRole }) {
    const result = await prismaClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REGISTRATION_REVIEW_LOCK})`;
      await policyService.assertReviewer('REGISTRATION_REQUEST', { role: actorRole, sub: actorUserId }, tx);
      const request = await tx.registrationRequest.findUnique({ where: { id } });
      assertReviewable(request);
      const after = await tx.registrationRequest.update({
        where: { id },
        data: { status: 'REJECTED', passwordHash: null, reviewedByUserId: actorUserId, reviewedAt: new Date(), rejectedAt: new Date(), rejectionReason: reason },
        select: requestSelect
      });
      await auditService.log({
        actorUserId,
        action: 'UPDATE',
        entityType: 'RegistrationRequest',
        entityId: id,
        metadata: { event: 'REGISTRATION_REQUEST_REJECTED', result: 'rejected' }
      }, tx);
      return after;
    }, { isolationLevel: 'Serializable' });
    try {
      const notifier = notificationService || require('./notification-email.service');
      await notifier.notifyRegistrationDecision({ request: result, eventType: 'REGISTRATION_REJECTED' });
    } catch (notificationError) {
      logger.error('Registration rejection notification failed after commit', { error: notificationError.message, registrationRequestId: result?.id });
    }
    return result;
  }

  return { list, getById, searchCandidates, match, approve, reject };
}

module.exports = { createRegistrationRequestService, REGISTRATION_REVIEW_LOCK, ACTIONABLE_STATUSES };
