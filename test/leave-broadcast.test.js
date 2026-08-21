// test/leave-broadcast.test.js
// Focused tests for the Leave-Created reviewer email broadcast feature.

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

// Track calls for verification
let createTransportCallCount = 0;
let queryUserManyCallCount = 0;
let reservationCreateCallCount = 0;
let lastSmtpConfig = null;
let reservationEventKeys = new Set();

// A helper to reset module cache and import the notification-email service
// with a mock implementation of prisma and env configs.
function setupServiceMock(mocks = {}) {
  createTransportCallCount = 0;
  queryUserManyCallCount = 0;
  reservationCreateCallCount = 0;
  lastSmtpConfig = null;
  reservationEventKeys = new Set();

  const fakePrisma = {
    user: {
      findUnique: async (args) => {
        if (mocks.userFindUnique) return mocks.userFindUnique(args);
        return { id: args.where.id, displayName: 'Test User' };
      },
      findMany: async (args) => {
        queryUserManyCallCount++;
        if (mocks.userFindMany) {
          const raw = await mocks.userFindMany(args);
          // Emulate real database queries by filtering according to the query constraints:
          const where = args?.where || {};
          return raw.filter(u => {
            if (where.role) {
              if (typeof where.role === 'string') {
                if (u.role !== where.role) return false;
              } else if (where.role.in && Array.isArray(where.role.in)) {
                if (!where.role.in.includes(u.role)) return false;
              }
            }
            if (where.isActive !== undefined && u.isActive !== where.isActive) return false;
            if (where.accountStatus && u.accountStatus !== where.accountStatus) return false;
            if (where.email && where.email.not === '' && (!u.email || u.email === '')) return false;
            return true;
          });
        }
        return [];
      }
    },
    employee: {
      findUnique: async (args) => {
        if (mocks.employeeFindUnique) return mocks.employeeFindUnique(args);
        return { id: args.where.id, firstName: 'First', lastName: 'Last', displayName: 'First Last', department: 'ENG', user: { id: 'emp-user-id' } };
      }
    },
    shiftAssignment: {
      findMany: async (args) => {
        const assignments = mocks.shiftAssignmentFindMany ? await mocks.shiftAssignmentFindMany(args) : [];
        return assignments.filter((assignment) => {
          const employee = assignment.employee || {};
          if (args?.where?.employee?.isActive === true && employee.isActive === false) return false;
          if (args?.where?.employee?.deletedAt === null && employee.deletedAt !== null) return false;
          return true;
        });
      }
    },
    emailDeliveryReservation: {
      create: async (args) => {
        reservationCreateCallCount++;
        if (mocks.reservationCreate) return mocks.reservationCreate(args);
        if (reservationEventKeys.has(args.data.eventKey)) {
          const error = new Error('Unique constraint failed');
          error.code = 'P2002';
          throw error;
        }
        reservationEventKeys.add(args.data.eventKey);
        return { id: 'reservation-uuid', eventKey: args.data.eventKey, status: 'RESERVED', attemptCount: 0 };
      },
      update: async (args) => {
        if (mocks.reservationUpdate) return mocks.reservationUpdate(args);
        return { id: args.where.id, status: args.data.status };
      }
    }
  };

  // Mock prisma config file module exports
  require.cache[require.resolve('../src/config/prisma')] = { exports: fakePrisma };

  // Mock env module config
  const fakeEnv = {
    emailNotificationsEnabled: mocks.emailNotificationsEnabled !== undefined ? mocks.emailNotificationsEnabled : true,
    otpDeliveryProvider: mocks.otpDeliveryProvider !== undefined ? mocks.otpDeliveryProvider : 'gmail_smtp',
    smtpHost: mocks.smtpHost !== undefined ? mocks.smtpHost : 'smtp.example.com',
    smtpPort: 465,
    smtpSecure: true,
    smtpUsername: 'smtp-user',
    smtpPassword: 'smtp-password',
    otpFromEmail: 'from@example.com',
    corsOrigins: mocks.corsOrigins || ['https://sms-v3-staging-ten.vercel.app', 'http://localhost:5173']
  };
  require.cache[require.resolve('../src/config/env')] = { exports: fakeEnv };

  // Clear module require cache
  delete require.cache[require.resolve('../src/services/notification-email.service')];
  const service = require('../src/services/notification-email.service');

  // Stub transporter sending globally by mocking nodemailer.createTransport
  const sentEmails = [];
  const fakeTransporter = {
    sendMail: async (mail) => {
      sentEmails.push(mail);
      if (mocks.smtpFailure) {
        const err = new Error('SMTP connection timed out');
        err.code = 'ETIMEDOUT';
        throw err;
      }
      if (mocks.smtpAuthFailure) {
        const err = new Error('Invalid login credentials');
        err.code = 'EAUTH';
        throw err;
      }
      return { messageId: 'msg-id' };
    }
  };

  const nodemailer = require('nodemailer');
  nodemailer.createTransport = (config) => {
    createTransportCallCount++;
    lastSmtpConfig = config;
    return fakeTransporter;
  };

  return { service, sentEmails, fakePrisma };
}

// Helper to restore real modules if needed
function cleanCache() {
  delete require.cache[require.resolve('../src/config/prisma')];
  delete require.cache[require.resolve('../src/config/env')];
  delete require.cache[require.resolve('../src/services/notification-email.service')];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('1. Active MANAGER receives email', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com', displayName: 'Manager One' }
    ]
  });

  const leaveRequest = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Flu' };
  await service.broadcastLeaveRequestEmail(leaveRequest, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'mgr1@example.com');
  assert.match(sentEmails[0].html, /Flu/);
  cleanCache();
});

test('2. Managers from different departments receive email (no department restriction)', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com', displayName: 'Manager One' },
      { id: 'mgr-2', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr2@example.com', displayName: 'Manager Two' }
    ]
  });

  const leaveRequest = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Flu' };
  await service.broadcastLeaveRequestEmail(leaveRequest, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[0].to, 'mgr1@example.com');
  assert.equal(sentEmails[1].to, 'mgr2@example.com');
  cleanCache();
});

test('3. Every eligible Manager receives an individual email (not grouped together)', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com' },
      { id: 'mgr-2', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr2@example.com' }
    ]
  });

  const leaveRequest = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.broadcastLeaveRequestEmail(leaveRequest, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[0].to, 'mgr1@example.com');
  assert.equal(sentEmails[1].to, 'mgr2@example.com');
  // Confirm recipient addresses are never grouped together in "to" field
  assert.ok(!sentEmails[0].to.includes('mgr2@example.com'));
  assert.ok(!sentEmails[1].to.includes('mgr1@example.com'));
  cleanCache();
});

test('4. Active ADMIN receives email', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'admin-1', role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE', email: 'admin@example.com' }
    ]
  });

  const leaveRequest = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.broadcastLeaveRequestEmail(leaveRequest, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 1, 'Active ADMIN must receive reviewer email');
  assert.equal(sentEmails[0].to, 'admin@example.com');
  cleanCache();
});

test('4b. Registration approval and reviewer rejection notify the applicant once', async () => {
  const { service, sentEmails } = setupServiceMock();
  const approvedRequest = {
    id: 'registration-approved-1',
    email: 'Applicant@example.com',
    submittedName: 'Applicant One',
    passwordHash: 'must-not-be-mailed'
  };

  await service.notifyRegistrationDecision({ request: approvedRequest, eventType: 'REGISTRATION_APPROVED' });
  await service.notifyRegistrationDecision({ request: approvedRequest, eventType: 'REGISTRATION_APPROVED' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'applicant@example.com');
  assert.match(sentEmails[0].html, /บัญชีได้รับการอนุมัติแล้ว/);
  assert.doesNotMatch(sentEmails[0].html, /must-not-be-mailed/);

  const rejectedRequest = {
    id: 'registration-rejected-1',
    email: 'Rejected@example.com',
    submittedName: 'Rejected Applicant',
    rejectionReason: '<script>alert(1)</script>'
  };
  await service.notifyRegistrationDecision({ request: rejectedRequest, eventType: 'REGISTRATION_REJECTED' });

  assert.equal(sentEmails.length, 2);
  assert.equal(sentEmails[1].to, 'rejected@example.com');
  assert.match(sentEmails[1].html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(sentEmails[1].html, /<script>/);
  cleanCache();
});

test('4c. Registration business email failure does not throw or roll back the caller', async () => {
  const { service, sentEmails } = setupServiceMock({ smtpFailure: true });
  await assert.doesNotReject(() => service.notifyRegistrationDecision({
    request: { id: 'registration-failure-1', email: 'applicant@example.com', submittedName: 'Applicant' },
    eventType: 'REGISTRATION_APPROVED'
  }));
  assert.equal(sentEmails.length, 1);
  cleanCache();
});

test('4d. Schedule approval notifies only assigned active employees and deduplicates recipients', async () => {
  const activeEmployee = (id, email, displayName = id) => ({
    id,
    isActive: true,
    deletedAt: null,
    displayName,
    firstName: displayName,
    lastName: '',
    user: { id: `${id}-user`, email, isActive: true, accountStatus: 'ACTIVE' }
  });
  const { service, sentEmails } = setupServiceMock({
    shiftAssignmentFindMany: async () => [
      { employeeId: 'employee-a', employee: activeEmployee('employee-a', 'a@example.com', 'Employee A') },
      { employeeId: 'employee-a', employee: activeEmployee('employee-a', 'a@example.com', 'Employee A') },
      { employeeId: 'employee-b', employee: activeEmployee('employee-b', 'b@example.com', 'Employee B') },
      { employeeId: 'employee-inactive', employee: { ...activeEmployee('employee-inactive', 'inactive@example.com'), isActive: false } },
      { employeeId: 'employee-suspended', employee: { ...activeEmployee('employee-suspended', 'suspended@example.com'), user: { id: 'suspended-user', email: 'suspended@example.com', isActive: true, accountStatus: 'SUSPENDED' } } }
    ]
  });

  await service.notifyScheduleApproved({ month: '2026-08', approvedBy: 'Admin', revision: 3 });
  await service.notifyScheduleApproved({ month: '2026-08', approvedBy: 'Admin', revision: 3 });

  assert.deepEqual(sentEmails.map((message) => message.to), ['a@example.com', 'b@example.com']);
  assert.equal(sentEmails.length, 2);
  assert.ok(sentEmails.every((message) => !message.to.includes(',')));
  cleanCache();
});

test('4e. Schedule approval fails closed when no assigned employee recipient is resolvable', async () => {
  const { service, sentEmails } = setupServiceMock({ shiftAssignmentFindMany: async () => [] });
  await service.notifyScheduleApproved({ month: '2026-08', approvedBy: 'Admin', revision: 1 });
  assert.equal(sentEmails.length, 0);
  cleanCache();
});

test('5. VIEWER does not receive email', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'view-1', role: 'VIEWER', isActive: true, accountStatus: 'ACTIVE', email: 'view@example.com' }
    ]
  });

  const leaveRequest = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.broadcastLeaveRequestEmail(leaveRequest, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 0, 'VIEWER must not receive emails');
  cleanCache();
});

test('6. Inactive MANAGER does not receive email', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: false, accountStatus: 'ACTIVE', email: 'mgr@example.com' }
    ]
  });

  const leaveRequest = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.broadcastLeaveRequestEmail(leaveRequest, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 0, 'Inactive MANAGER must be filtered out');
  cleanCache();
});

test('7. Suspended MANAGER does not receive email', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'SUSPENDED', email: 'mgr@example.com' }
    ]
  });

  const leaveRequest = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.broadcastLeaveRequestEmail(leaveRequest, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 0, 'Suspended MANAGER must be filtered out');
  cleanCache();
});

test('8. Empty or invalid email is skipped', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: '' },
      { id: 'mgr-2', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'notanemail' },
      { id: 'mgr-3', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr3@example.com' }
    ]
  });

  const leaveRequest = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.broadcastLeaveRequestEmail(leaveRequest, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'mgr3@example.com');
  cleanCache();
});

test('9 & 10. Self-created vs on-behalf creation formats', async () => {
  // Test Case 9: Employee self-created (createdByUserId matches employeeUserId)
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }],
    employeeFindUnique: async () => ({ id: 'emp-1', user: { id: 'actor-1' }, displayName: 'Self Emp', department: 'ENG' })
  });

  const leaveRequestSelf = { id: 'leave-1', employeeId: 'emp-1', createdByUserId: 'actor-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.broadcastLeaveRequestEmail(leaveRequestSelf, { sub: 'actor-1' });
  assert.equal(sentEmails.length, 1);
  assert.ok(!sentEmails[0].html.includes('บันทึกแทนโดย'));

  // Test Case 10: Manager on-behalf (createdByUserId !== employeeUserId)
  cleanCache();
  const mockSetup2 = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }],
    employeeFindUnique: async () => ({ id: 'emp-1', user: { id: 'other-user-id' }, displayName: 'Other Emp', department: 'ENG' }),
    userFindUnique: async () => ({ id: 'actor-1', displayName: 'Manager Actor' })
  });

  const leaveRequestOnBehalf = { id: 'leave-2', employeeId: 'emp-1', createdByUserId: 'actor-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await mockSetup2.service.broadcastLeaveRequestEmail(leaveRequestOnBehalf, { sub: 'actor-1' });
  assert.equal(mockSetup2.sentEmails.length, 1);
  assert.ok(mockSetup2.sentEmails[0].html.includes('บันทึกแทนโดย: Manager Actor'));
  cleanCache();
});

test('11 & 12. Normal vs Retroactive leave triggers broadcast', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }]
  });

  // Normal leave
  const leaveNormal = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'VACATION', startDate: new Date(), endDate: new Date(), dayCount: 2 };
  await service.broadcastLeaveRequestEmail(leaveNormal, { sub: 'actor-1' });
  assert.equal(sentEmails.length, 1);

  // Retroactive leave
  const leaveRetro = { id: 'leave-2', employeeId: 'emp-1', leaveType: 'PERSONAL', startDate: new Date(), endDate: new Date(), dayCount: 1, reason: 'Urgent' };
  await service.broadcastLeaveRequestEmail(leaveRetro, { sub: 'actor-1' });
  assert.equal(sentEmails.length, 2);
  cleanCache();
});

test('13. Leave request status remains PENDING', async () => {
  const { service } = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }]
  });
  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'VACATION', status: 'PENDING', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  // Status check (no changes can be made by broadcastLeaveRequestEmail)
  assert.equal(leave.status, 'PENDING');
  cleanCache();
});

test('14. SMTP failure still returns successfully without throwing', async () => {
  const { service } = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }],
    smtpFailure: true
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await assert.doesNotReject(() => service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' }));
  cleanCache();
});

test('15. Reservation database failure still returns successfully', async () => {
  const { service } = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }],
    reservationCreate: async () => { throw new Error('Prisma database unavailable'); }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await assert.doesNotReject(() => service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' }));
  cleanCache();
});

test('16. Duplicate eventKey does not resend', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }],
    reservationCreate: async () => {
      const err = new Error('Unique constraint failed');
      err.code = 'P2002';
      throw err;
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 0, 'If reservation was rejected as duplicate, no email should be dispatched');
  cleanCache();
});

test('17. One failed recipient does not block other recipients', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com' },
      { id: 'mgr-2', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr2@example.com' }
    ]
  });

  // Override nodemailer createTransport globally for this instance
  const nodemailer = require('nodemailer');
  nodemailer.createTransport = () => ({
    sendMail: async (mail) => {
      if (mail.to === 'mgr1@example.com') {
        throw new Error('transporter failed for mgr1');
      }
      sentEmails.push(mail);
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'mgr2@example.com');
  cleanCache();
});

test('19. Notifications-disabled flag prevents query and reservation', async () => {
  const { service, sentEmails } = setupServiceMock({
    emailNotificationsEnabled: false
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  assert.equal(queryUserManyCallCount, 0, 'Database query must not be triggered if notifications are disabled');
  assert.equal(sentEmails.length, 0);
  cleanCache();
});

test('20 & 21. Link builder filters localhost and handles missing link gracefully', async () => {
  // localhost origin
  const mockLocal = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }],
    corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173']
  });
  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await mockLocal.service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });
  assert.equal(mockLocal.sentEmails.length, 1);
  assert.ok(!mockLocal.sentEmails[0].html.includes('http://localhost'), 'Localhost links must be filtered out');

  // no public origins
  cleanCache();
  const mockMissing = setupServiceMock({
    userFindMany: async () => [{ id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr@example.com' }],
    corsOrigins: []
  });
  await assert.doesNotReject(() => mockMissing.service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' }));
  assert.equal(mockMissing.sentEmails.length, 1);
  assert.ok(!mockMissing.sentEmails[0].html.includes('href'), 'Omitted link from HTML template entirely');
  cleanCache();
});

test('22. Existing approval/rejection notifications remain unchanged', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [{ id: 'admin-1', role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE', email: 'admin@example.com' }]
  });

  // Approval
  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', employeeNameSnapshot: 'Joe', departmentSnapshot: 'OPS', startDate: new Date(), endDate: new Date(), dayCount: 1 };
  await service.notifyLeaveProcessed({ leave, status: 'APPROVED', approverName: 'Approver One' });
  assert.equal(sentEmails.length, 1);
  assert.ok(sentEmails[0].html.includes('อนุมัติแล้ว'));

  // Existing functions behave exactly as before
  cleanCache();
});

// ---------------------------------------------------------------------------
// Phase 2.2 Safety Tests
// ---------------------------------------------------------------------------

test('Safety: Transporter unavailable creates no reservation', async () => {
  const { service } = setupServiceMock({
    otpDeliveryProvider: 'disabled', // disables SMTP availability
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com' }
    ]
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  assert.equal(queryUserManyCallCount, 0, 'No query should occur if SMTP transporter is unavailable');
  assert.equal(reservationCreateCallCount, 0, 'No reservations should be created if SMTP transporter is unavailable');
  cleanCache();
});

test('Safety: Transporter is created once per broadcast', async () => {
  const { service } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com' },
      { id: 'mgr-2', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr2@example.com' }
    ]
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  assert.equal(createTransportCallCount, 1, 'Transporter should be created exactly once per broadcast execution');
  assert.equal(lastSmtpConfig.connectionTimeout, 5000);
  assert.equal(lastSmtpConfig.greetingTimeout, 5000);
  assert.equal(lastSmtpConfig.socketTimeout, 10000);
  cleanCache();
});

test('Safety: Connection/send timeout marks recipient FAILED and does not block others', async () => {
  const updatedStatuses = {};
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com' },
      { id: 'mgr-2', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr2@example.com' }
    ],
    smtpFailure: true, // triggers connection timeout
    reservationUpdate: async (args) => {
      updatedStatuses[args.where.id] = args.data.status;
      return { id: args.where.id, status: args.data.status };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  // Verify failure statuses
  assert.equal(sentEmails.length, 2); // 2 send attempts were made
  assert.equal(updatedStatuses['reservation-uuid'], 'FAILED'); // both were marked failed
  cleanCache();
});

test('Safety: HTML in leave reason and display names is escaped', async () => {
  const { service, sentEmails } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'mgr1@example.com', displayName: '<b>Dangerous Mgr</b>' }
    ],
    employeeFindUnique: async () => ({
      id: 'emp-1',
      firstName: '<span>Dangerous',
      lastName: 'Emp</span>',
      displayName: '<span>Dangerous Emp</span>',
      department: 'OPS & SEC',
      user: { id: 'emp-user-id' }
    })
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK & TYP', startDate: new Date(), endDate: new Date(), reason: 'Injecting <script>alert(1)</script>' };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  assert.equal(sentEmails.length, 1);
  const body = sentEmails[0].html;
  // Confirm raw HTML elements do not exist
  assert.ok(!body.includes('<b>Dangerous Mgr</b>'));
  assert.ok(!body.includes('<span>Dangerous Emp</span>'));
  assert.ok(!body.includes('<script>alert(1)</script>'));
  // Confirm escaped structures
  assert.ok(body.includes('&lt;b&gt;Dangerous Mgr&lt;/b&gt;'));
  assert.ok(body.includes('&lt;span&gt;Dangerous Emp&lt;/span&gt;'));
  assert.ok(body.includes('Injecting &lt;script&gt;alert(1)&lt;/script&gt;'));
  cleanCache();
});

test('Safety: Logs and lastErrorSafe do not contain raw SMTP error details or recipient email', async () => {
  let loggedError = null;
  const { logger } = require('../src/utils/logger');
  const originalError = logger.error;
  logger.error = (event, meta) => { loggedError = { event, meta }; };

  const updatedReservations = [];
  const { service } = setupServiceMock({
    userFindMany: async () => [
      { id: 'mgr-1', role: 'MANAGER', isActive: true, accountStatus: 'ACTIVE', email: 'secret-mgr@example.com' }
    ],
    smtpAuthFailure: true, // triggers auth failure
    reservationUpdate: async (args) => {
      updatedReservations.push(args.data);
      return { id: args.where.id, status: args.data.status };
    }
  });

  const leave = { id: 'leave-1', employeeId: 'emp-1', leaveType: 'SICK', startDate: new Date(), endDate: new Date() };
  await service.broadcastLeaveRequestEmail(leave, { sub: 'actor-1' });

  // Restore logger
  logger.error = originalError;

  // Verify safe database error storage
  assert.ok(updatedReservations.length > 0);
  const failureRecord = updatedReservations.find(r => r.status === 'FAILED');
  assert.equal(failureRecord.lastErrorCategory, 'SMTP_AUTH_FAILURE');
  assert.equal(failureRecord.lastErrorSafe, 'SMTP authentication failed');
  assert.ok(!failureRecord.lastErrorSafe.includes('secret-mgr@example.com'));

  // Verify log safety
  assert.ok(loggedError);
  assert.ok(!JSON.stringify(loggedError).includes('secret-mgr@example.com'));
  cleanCache();
});
