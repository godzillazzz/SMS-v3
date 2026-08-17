process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

if (process.env.RUN_INTEGRATION_TESTS !== 'true') {
  test('G04.1 registration OTP integration suite is disabled unless RUN_INTEGRATION_TESTS=true', { skip: true }, () => {});
} else {
  if (!process.env.DATABASE_URL?.includes('sms_v3_test')) throw new Error('G04.1 integration tests require an isolated sms_v3_test database.');

  const prisma = require('../../src/config/prisma');
  const { createOtpService, AUTO_DUPLICATE_ACCOUNT_REASON } = require('../../src/services/email-otp.service');

  const configuration = {
    otpDeliveryProvider: 'gmail_smtp',
    otpHashSecret: 'g04-1-integration-otp-hash-secret-32-characters-minimum',
    otpCodeExpiresMinutes: 10,
    otpMaxAttempts: 5,
    otpRequestLimitPerHour: 20
  };

  async function cleanup() {
    await prisma.authOtpChallenge.deleteMany({});
    await prisma.refreshSession.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.registrationRequest.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.employeeLifecycleEvent.deleteMany({});
    await prisma.employeeLicenseDocument.deleteMany({});
    await prisma.employeeLicense.deleteMany({});
    await prisma.shiftAssignment.deleteMany({});
    await prisma.leaveRequest.deleteMany({});
    await prisma.leaveQuota.deleteMany({});
    await prisma.employee.deleteMany({});
  }

  function createService({ mails = [], notifications = [] } = {}) {
    return createOtpService({
      prismaClient: prisma,
      auditService: { log: async () => undefined },
      configuration,
      mailer: { send: async (message) => { mails.push(message); } },
      registrationNotifier: async (payload) => { notifications.push(payload); }
    });
  }

  async function expectInvalid(operation) {
    await assert.rejects(operation, { message: 'Invalid or expired verification code.' });
  }

  test.beforeEach(cleanup);
  test.after(async () => { await cleanup(); await prisma.$disconnect(); });

  test('PostgreSQL: registration resend keeps one request/password and enforces one active OTP permanently', { concurrency: false }, async () => {
    const mails = []; const notifications = [];
    const service = createService({ mails, notifications });
    const email = `g041-resend-${crypto.randomUUID()}@example.test`;

    await service.requestRegistration({ submittedName: 'Integration Applicant', email, password: 'original-password-for-test' });
    const requestBefore = await prisma.registrationRequest.findUniqueOrThrow({ where: { email } });
    const originalHash = requestBefore.passwordHash;
    const oldCode = mails[0].code;

    await service.requestRegistration({ submittedName: 'Changed Name', email, password: 'attacker-password-for-test' });
    const newCode = mails[1].code;
    const requestAfterResend = await prisma.registrationRequest.findUniqueOrThrow({ where: { email } });
    const challenges = await prisma.authOtpChallenge.findMany({ where: { purpose: 'REGISTRATION' }, orderBy: { createdAt: 'asc' } });

    assert.equal(await prisma.registrationRequest.count({ where: { email } }), 1);
    assert.equal(requestAfterResend.passwordHash, originalHash);
    assert.equal(requestAfterResend.submittedName, 'Integration Applicant');
    assert.equal(challenges.length, 2);
    assert.equal(challenges[0].deliveryState, 'SENT');
    assert.equal(challenges[1].deliveryState, 'SENT');
    assert.ok(challenges[0].expiresAt <= challenges[1].createdAt);

    await expectInvalid(() => service.verifyRegistration({ email, code: oldCode }));
    const verified = await service.verifyRegistration({ email, code: newCode });
    assert.equal(verified.registrationState, 'REQUEST_SUBMITTED');
    await expectInvalid(() => service.verifyRegistration({ email, code: oldCode }));
    assert.equal(notifications.length, 1);
  });

  test('PostgreSQL: exact first+last name with one linked User blocks new-email duplicate without auto-link or takeover', { concurrency: false }, async () => {
    const employee = await prisma.employee.create({ data: {
      employeeCode: `LOCAL-${crypto.randomUUID()}`,
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'ชื่อแสดงผลที่ไม่ใช้เป็นตัวตน',
      department: 'Security',
      isActive: true
    } });
    const existingUser = await prisma.user.create({ data: {
      email: `g041-old-${crypto.randomUUID()}@example.test`,
      passwordHash: 'existing-password-hash',
      displayName: 'Existing Account',
      role: 'VIEWER',
      employeeId: employee.id,
      isActive: true,
      accountStatus: 'ACTIVE'
    } });
    const existingEmail = existingUser.email;
    const mails = []; const notifications = [];
    const service = createService({ mails, notifications });
    const newEmail = `g041-new-${crypto.randomUUID()}@example.test`;

    await service.requestRegistration({ submittedName: '  สมชาย   ใจดี  ', email: newEmail, password: 'new-password-for-test' });
    const result = await service.verifyRegistration({ email: newEmail, code: mails[0].code });
    const request = await prisma.registrationRequest.findUniqueOrThrow({ where: { email: newEmail } });
    const existingAfter = await prisma.user.findUniqueOrThrow({ where: { id: existingUser.id } });
    const employeeAfter = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });

    assert.equal(result.registrationState, 'EMPLOYEE_ALREADY_HAS_ACCOUNT');
    assert.equal(request.status, 'REJECTED');
    assert.equal(request.passwordHash, null);
    assert.equal(request.matchedEmployeeId, null);
    assert.equal(request.rejectionReason, AUTO_DUPLICATE_ACCOUNT_REASON);
    assert.equal(existingAfter.email, existingEmail);
    assert.equal(employeeAfter.id, employee.id);
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.registrationRequest.count({ where: { emailVerifiedAt: { not: null }, status: { in: ['PENDING', 'MATCHED'] } } }), 0);
    assert.equal(notifications.length, 0);
  });

  test('PostgreSQL: same exact name on multiple Employees remains ambiguous and goes to Admin review', { concurrency: false }, async () => {
    const first = await prisma.employee.create({ data: { employeeCode: `LOCAL-${crypto.randomUUID()}`, firstName: 'Same', lastName: 'Person', displayName: 'Alias A', isActive: true } });
    await prisma.employee.create({ data: { employeeCode: `LOCAL-${crypto.randomUUID()}`, firstName: 'Same', lastName: 'Person', displayName: 'Alias B', isActive: true } });
    await prisma.user.create({ data: {
      email: `g041-linked-${crypto.randomUUID()}@example.test`, passwordHash: 'hash', displayName: 'Linked', role: 'VIEWER', employeeId: first.id, isActive: true, accountStatus: 'ACTIVE'
    } });
    const mails = []; const notifications = [];
    const service = createService({ mails, notifications });
    const email = `g041-ambiguous-${crypto.randomUUID()}@example.test`;

    await service.requestRegistration({ submittedName: 'same   person', email, password: 'long-password-for-test' });
    const result = await service.verifyRegistration({ email, code: mails[0].code });
    const request = await prisma.registrationRequest.findUniqueOrThrow({ where: { email } });

    assert.equal(result.registrationState, 'REQUEST_SUBMITTED');
    assert.equal(request.status, 'PENDING');
    assert.equal(request.matchedEmployeeId, null);
    assert.ok(request.emailVerifiedAt);
    assert.equal(notifications.length, 1);
  });

  test('PostgreSQL: existing User same email gets ownership OTP and no RegistrationRequest', { concurrency: false }, async () => {
    const email = `g041-existing-${crypto.randomUUID()}@example.test`;
    const user = await prisma.user.create({ data: { email, passwordHash: 'existing-hash', displayName: 'Existing User', role: 'VIEWER', isActive: true, accountStatus: 'ACTIVE' } });
    const mails = [];
    const service = createService({ mails });

    const requested = await service.requestRegistration({ submittedName: 'Any Name', email: email.toUpperCase(), password: 'ignored-password-for-test' });
    assert.equal(requested.verificationRequired, true);
    assert.equal(mails.length, 1);
    assert.equal(await prisma.registrationRequest.count({ where: { email } }), 0);
    const result = await service.verifyRegistration({ email, code: mails[0].code });
    assert.equal(result.registrationState, 'EXISTING_ACCOUNT');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email, email);
  });

  test('PostgreSQL: PASSWORD_RESET resend invalidates old OTP before and after newest OTP is consumed', { concurrency: false }, async () => {
    const email = `g041-reset-${crypto.randomUUID()}@example.test`;
    const oldHash = await bcrypt.hash('old-password-for-test', 4);
    await prisma.user.create({ data: { email, passwordHash: oldHash, displayName: 'Reset User', role: 'VIEWER', isActive: true, accountStatus: 'ACTIVE' } });
    const mails = [];
    const service = createService({ mails });

    await service.requestPasswordReset({ email });
    const oldCode = mails[0].code;
    await service.requestPasswordReset({ email });
    const newCode = mails[1].code;
    await expectInvalid(() => service.completePasswordReset({ email, code: oldCode, newPassword: 'should-not-apply' }));
    await service.completePasswordReset({ email, code: newCode, newPassword: 'new-password-for-test' });
    await expectInvalid(() => service.completePasswordReset({ email, code: oldCode, newPassword: 'still-should-not-apply' }));
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.ok(await bcrypt.compare('new-password-for-test', user.passwordHash));
  });

  test('PostgreSQL: concurrent same-email registration OTP requests leave one request and exactly one active challenge', { concurrency: false }, async () => {
    const mails = [];
    const service = createService({ mails });
    const email = `g041-concurrent-${crypto.randomUUID()}@example.test`;
    await Promise.all([
      service.requestRegistration({ submittedName: 'Concurrent Person', email, password: 'first-password' }),
      service.requestRegistration({ submittedName: 'Concurrent Person', email, password: 'second-password' })
    ]);
    const now = new Date();
    const requests = await prisma.registrationRequest.findMany({ where: { email } });
    const challenges = await prisma.authOtpChallenge.findMany({ where: { purpose: 'REGISTRATION' }, orderBy: { createdAt: 'asc' } });
    const active = challenges.filter((row) => row.consumedAt === null && row.deliveryState === 'SENT' && row.expiresAt > now);
    assert.equal(requests.length, 1);
    assert.equal(challenges.length, 2);
    assert.equal(active.length, 1);
    assert.equal(mails.length, 2);
  });
}
