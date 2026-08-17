process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { createOtpService, genericRegistrationSuccess } = require('../src/services/email-otp.service');

function fakePrisma({ users: initialUsers = [], requests: initialRequests = [] } = {}) {
  const users = initialUsers.map((row) => ({ ...row }));
  const requests = initialRequests.map((row) => ({ ...row }));
  const challenges = [];
  const sessions = [];
  const tx = {
    user: {
      findUnique: async ({ where, select }) => {
        const row = users.find((user) => (where.email && user.email === where.email) || (where.id && user.id === where.id)) || null;
        if (!row || !select) return row;
        return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
      },
      update: async ({ where, data }) => {
        const row = users.find((user) => user.id === where.id);
        Object.entries(data).forEach(([key, value]) => { row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] || 0) + value.increment : value; });
        return row;
      }
    },
    registrationRequest: {
      findUnique: async ({ where }) => requests.find((row) => (where.email && row.email === where.email) || (where.id && row.id === where.id)) || null,
      create: async ({ data }) => { const row = { id: `registration-${requests.length + 1}`, createdAt: new Date(), updatedAt: new Date(), emailVerifiedAt: null, matchedEmployeeId: null, ...data }; requests.push(row); return row; },
      update: async ({ where, data }) => { const row = requests.find((item) => item.id === where.id); Object.assign(row, data, { updatedAt: new Date() }); return row; }
    },
    authOtpChallenge: {
      count: async ({ where }) => challenges.filter((item) => item.emailHash === where.emailHash && item.purpose === where.purpose && item.createdAt >= where.createdAt.gte).length,
      create: async ({ data }) => { const row = { id: `otp-${challenges.length + 1}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data }; challenges.push(row); return row; },
      update: async ({ where, data }) => { const row = challenges.find((item) => item.id === where.id); Object.entries(data).forEach(([key, value]) => { row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value; }); return row; },
      findFirst: async ({ where }) => challenges.filter((item) => item.emailHash === where.emailHash && item.purpose === where.purpose && item.consumedAt === null).sort((a, b) => b.createdAt - a.createdAt)[0] || null
    },
    refreshSession: { updateMany: async ({ where, data }) => { sessions.push({ where, data }); return { count: 0 }; } }
  };
  return { ...tx, $transaction: async (operation) => typeof operation === 'function' ? operation(tx) : Promise.all(operation), _users: users, _requests: requests, _challenges: challenges, _sessions: sessions };
}

const config = { otpDeliveryProvider: 'gmail_smtp', otpHashSecret: 'otp-test-secret-that-is-at-least-thirty-two-characters', otpCodeExpiresMinutes: 10, otpMaxAttempts: 5, otpRequestLimitPerHour: 5 };

function serviceFor(prisma, events, onMail) {
  return createOtpService({
    prismaClient: prisma,
    auditService: { log: async (event) => { events.push(event); } },
    configuration: config,
    mailer: { send: async (message) => { if (onMail) onMail(message); } },
    registrationNotifier: async () => undefined
  });
}

test('private registration creates only a RegistrationRequest and OTP, not a User or Employee link', async () => {
  const prisma = fakePrisma(); const events = []; let delivered;
  const service = serviceFor(prisma, events, (message) => { delivered = message; });
  const result = await service.requestRegistration({ submittedName: 'Applicant Name', email: 'NEW.USER@EXAMPLE.TEST', password: 'long-password-for-test', departmentHint: 'Security A' });
  assert.deepEqual(result, genericRegistrationSuccess);
  assert.equal(prisma._users.length, 0);
  assert.equal(prisma._requests.length, 1);
  assert.equal(prisma._requests[0].email, 'new.user@example.test');
  assert.equal(prisma._requests[0].status, 'PENDING');
  assert.equal(prisma._requests[0].matchedEmployeeId, null);
  assert.ok(await bcrypt.compare('long-password-for-test', prisma._requests[0].passwordHash));
  assert.equal(delivered.purpose, 'REGISTRATION');
  assert.equal(prisma._challenges[0].userId, null);
  assert.equal(events.some((event) => event.metadata?.event === 'REGISTRATION_REQUEST_SUBMITTED'), true);
});

test('registration email verification marks only the request verified and still creates no User', async () => {
  const prisma = fakePrisma(); const events = []; let delivered;
  const service = serviceFor(prisma, events, (message) => { delivered = message; });
  await service.requestRegistration({ submittedName: 'Applicant', email: 'applicant@example.test', password: 'long-password-for-test' });
  const result = await service.verifyRegistration({ email: 'applicant@example.test', code: delivered.code });
  assert.deepEqual(result, genericRegistrationSuccess);
  assert.ok(prisma._requests[0].emailVerifiedAt instanceof Date);
  assert.equal(prisma._users.length, 0);
  assert.ok(prisma._challenges[0].consumedAt);
  assert.equal(events.some((event) => event.metadata?.event === 'REGISTRATION_REQUEST_EMAIL_VERIFIED'), true);
});

test('duplicate registration request returns the same generic response and does not disclose account/request existence', async () => {
  const existingRequest = { id: 'registration-1', submittedName: 'Existing', email: 'existing@example.test', passwordHash: 'hash', status: 'PENDING', emailVerifiedAt: null };
  const prisma = fakePrisma({ requests: [existingRequest] }); const events = []; let mailCount = 0;
  const service = serviceFor(prisma, events, () => { mailCount += 1; });
  const result = await service.requestRegistration({ submittedName: 'Other', email: 'existing@example.test', password: 'long-password-for-test' });
  assert.deepEqual(result, genericRegistrationSuccess);
  assert.equal(prisma._requests.length, 1);
  assert.equal(mailCount, 0);
  assert.equal(prisma._challenges.at(-1).deliveryState, 'NOT_DELIVERED');
});

test('registration request for an email already used by a User is also generic and does not create a request', async () => {
  const prisma = fakePrisma({ users: [{ id: 'user-1', email: 'active@example.test', accountStatus: 'ACTIVE', isActive: true }] });
  const service = serviceFor(prisma, []);
  const result = await service.requestRegistration({ submittedName: 'Applicant', email: 'active@example.test', password: 'long-password-for-test' });
  assert.deepEqual(result, genericRegistrationSuccess);
  assert.equal(prisma._requests.length, 0);
});

test('password reset behavior remains isolated to active User credentials and sessions', async () => {
  const oldHash = await bcrypt.hash('old-password-for-test', 4);
  const prisma = fakePrisma({ users: [{ id: 'user-1', email: 'active@example.test', passwordHash: oldHash, isActive: true, accountStatus: 'ACTIVE', tokenVersion: 2, failedLoginCount: 3 }] });
  let delivered; const service = serviceFor(prisma, [], (message) => { delivered = message; });
  await service.requestPasswordReset({ email: 'active@example.test' });
  await service.completePasswordReset({ email: 'active@example.test', code: delivered.code, newPassword: 'new-password-for-test' });
  assert.ok(await bcrypt.compare('new-password-for-test', prisma._users[0].passwordHash));
  assert.equal(prisma._users[0].tokenVersion, 3);
  assert.equal(prisma._sessions.length, 1);
});

test('invalid OTP is rejected without exposing stored code material', async () => {
  const prisma = fakePrisma(); let delivered;
  const service = serviceFor(prisma, [], (message) => { delivered = message; });
  await service.requestRegistration({ submittedName: 'Applicant', email: 'new.user@example.test', password: 'long-password-for-test' });
  await assert.rejects(() => service.verifyRegistration({ email: 'new.user@example.test', code: delivered.code === '000000' ? '111111' : '000000' }), { message: 'Invalid or expired verification code.' });
  assert.equal(prisma._challenges[0].attempts, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(prisma._challenges[0], 'code'), false);
});
