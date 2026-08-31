process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:65432/sms_test';
process.env.JWT_SECRET ||= 'local-test-jwt-secret-only-01234567890123456789';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRegistrationRequestService } = require('../src/services/registration-request.service');

test('registration approval notifies only after commit and does not repeat on retry', async () => {
  let committed = false;
  let transactionActive = false;
  const notifications = [];
  const requestState = {
    id: 'registration-approval-1',
    submittedName: 'Applicant One',
    email: 'applicant@example.invalid',
    departmentHint: 'Operations',
    status: 'MATCHED',
    emailVerifiedAt: new Date('2026-08-21T00:00:00.000Z'),
    matchedEmployeeId: 'employee-1',
    passwordHash: 'credential-hash',
    rejectionReason: null,
    matchedEmployee: null
  };
  const employee = {
    id: 'employee-1',
    employeeCode: 'EMP-001',
    firstName: 'Applicant',
    lastName: 'One',
    displayName: 'Applicant One',
    department: 'Operations',
    jobTitle: 'Officer',
    isActive: true,
    user: null
  };
  const fakeTx = {
    $executeRaw: async () => {},
    registrationRequest: {
      findUnique: async () => ({ ...requestState, matchedEmployee: requestState.matchedEmployee }),
      updateMany: async () => {
        requestState.status = 'APPROVED';
        requestState.passwordHash = null;
        requestState.matchedEmployee = employee;
        return { count: 1 };
      }
    },
    employee: {
      findFirst: async () => employee
    },
    user: {
      findUnique: async () => null,
      create: async ({ data }) => ({
        id: 'user-1',
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        employeeId: data.employeeId,
        department: data.department,
        accountStatus: data.accountStatus,
        isActive: data.isActive
      })
    }
  };
  const fakePrisma = {
    $transaction: async (callback) => {
      transactionActive = true;
      const result = await callback(fakeTx);
      transactionActive = false;
      committed = true;
      return result;
    }
  };
  const service = createRegistrationRequestService({
    prismaClient: fakePrisma,
    auditService: { log: async () => {} },
    approvalPolicyService: {
      assertReviewer: async (type, actor) => {
        assert.equal(type, 'REGISTRATION_REQUEST');
        assert.equal(actor.role, 'ADMIN');
        return { reviewerRoles: ['ADMIN', 'MANAGER'] };
      }
    },
    notificationService: {
      notifyRegistrationDecision: async ({ request, eventType }) => {
        assert.equal(transactionActive, false);
        assert.equal(committed, true);
        notifications.push({ request, eventType });
      }
    }
  });

  const result = await service.approve({ id: requestState.id, actorUserId: 'admin-1', actorRole: 'ADMIN' });
  assert.equal(result.request.status, 'APPROVED');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].eventType, 'REGISTRATION_APPROVED');
  assert.equal(notifications[0].request.email, 'applicant@example.invalid');

  await assert.rejects(
    () => service.approve({ id: requestState.id, actorUserId: 'admin-1', actorRole: 'ADMIN' }),
    (error) => error.statusCode === 409 && error.details?.code === 'REGISTRATION_REQUEST_NOT_ACTIONABLE'
  );
  assert.equal(notifications.length, 1);
});
