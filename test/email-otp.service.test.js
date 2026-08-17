process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const {
  AUTO_DUPLICATE_ACCOUNT_REASON,
  createOtpService,
  genericRegistrationSuccess,
  normalizePersonName
} = require('../src/services/email-otp.service');

function applySelect(row, select) {
  if (!row || !select) return row;
  const result = {};
  for (const [key, value] of Object.entries(select)) {
    if (!value) continue;
    if (key === 'user' && value.select) result.user = row.user ? applySelect(row.user, value.select) : null;
    else result[key] = row[key];
  }
  return result;
}

function matchesWhereChallenge(item, where) {
  if (where.emailHash && item.emailHash !== where.emailHash) return false;
  if (where.purpose && item.purpose !== where.purpose) return false;
  if (where.consumedAt === null && item.consumedAt !== null) return false;
  if (where.createdAt?.gte && item.createdAt < where.createdAt.gte) return false;
  if (where.expiresAt?.gt && !(item.expiresAt > where.expiresAt.gt)) return false;
  return true;
}

function fakePrisma({ users: initialUsers = [], requests: initialRequests = [], employees: initialEmployees = [] } = {}) {
  const users = initialUsers.map((row) => ({ ...row }));
  const requests = initialRequests.map((row) => ({ ...row }));
  const employees = initialEmployees.map((row) => ({ ...row }));
  const challenges = [];
  const sessions = [];
  const tx = {
    $executeRaw: async () => 1,
    user: {
      findUnique: async ({ where, select }) => {
        const row = users.find((user) => (where.email && user.email === where.email) || (where.id && user.id === where.id)) || null;
        return applySelect(row, select);
      },
      update: async ({ where, data }) => {
        const row = users.find((user) => user.id === where.id);
        Object.entries(data).forEach(([key, value]) => { row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] || 0) + value.increment : value; });
        return row;
      }
    },
    employee: {
      findUnique: async ({ where, select }) => {
        const employee = employees.find((item) => item.id === where.id) || null;
        if (!employee) return null;
        const linked = users.find((user) => user.employeeId === employee.id) || null;
        return applySelect({ ...employee, user: linked }, select);
      }
    },
    registrationRequest: {
      findUnique: async ({ where }) => requests.find((row) => (where.email && row.email === where.email) || (where.id && row.id === where.id)) || null,
      create: async ({ data }) => {
        const row = { id: `registration-${requests.length + 1}`, createdAt: new Date(), updatedAt: new Date(), emailVerifiedAt: null, matchedEmployeeId: null, reviewedByUserId: null, reviewedAt: null, approvedAt: null, rejectedAt: null, rejectionReason: null, ...data };
        requests.push(row); return row;
      },
      update: async ({ where, data }) => {
        const row = requests.find((item) => item.id === where.id);
        Object.assign(row, data, { updatedAt: new Date() }); return row;
      }
    },
    authOtpChallenge: {
      count: async ({ where }) => challenges.filter((item) => matchesWhereChallenge(item, where)).length,
      create: async ({ data }) => {
        const row = { id: `otp-${challenges.length + 1}`, attempts: 0, consumedAt: null, createdAt: new Date(Date.now() + challenges.length), ...data };
        challenges.push(row); return row;
      },
      update: async ({ where, data }) => {
        const row = challenges.find((item) => item.id === where.id);
        Object.entries(data).forEach(([key, value]) => { row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value; });
        return row;
      },
      updateMany: async ({ where, data }) => {
        const rows = challenges.filter((item) => matchesWhereChallenge(item, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      },
      findFirst: async ({ where }) => challenges.filter((item) => matchesWhereChallenge(item, where)).sort((a, b) => b.createdAt - a.createdAt)[0] || null
    },
    refreshSession: { updateMany: async ({ where, data }) => { sessions.push({ where, data }); return { count: 0 }; } }
  };
  return {
    ...tx,
    $transaction: async (operation) => typeof operation === 'function' ? operation(tx) : Promise.all(operation),
    _users: users,
    _requests: requests,
    _employees: employees,
    _challenges: challenges,
    _sessions: sessions
  };
}

const config = { otpDeliveryProvider: 'gmail_smtp', otpHashSecret: 'otp-test-secret-that-is-at-least-thirty-two-characters', otpCodeExpiresMinutes: 10, otpMaxAttempts: 5, otpRequestLimitPerHour: 5 };

function exactNameLookup(prisma) {
  return async (_tx, submittedName) => {
    const normalized = normalizePersonName(submittedName);
    return prisma._employees
      .filter((employee) => employee.isActive !== false && !employee.deletedAt && normalizePersonName(`${employee.firstName || ''} ${employee.lastName || ''}`) === normalized)
      .slice(0, 3)
      .map((employee) => ({ id: employee.id, hasUser: prisma._users.some((user) => user.employeeId === employee.id) }));
  };
}

function serviceFor(prisma, { events = [], mails = [], notifierCalls = [], failMail = false, configuration = config } = {}) {
  return createOtpService({
    prismaClient: prisma,
    auditService: { log: async (event) => { events.push(event); } },
    configuration,
    mailer: { send: async (message) => { mails.push(message); if (failMail) throw new Error('smtp failed'); } },
    registrationNotifier: async (payload) => { notifierCalls.push(payload); },
    duplicatePersonLookup: exactNameLookup(prisma)
  });
}

async function expectInvalid(operation) {
  await assert.rejects(operation, { message: 'Invalid or expired verification code.' });
}

test('new applicant receives one real six-digit registration OTP and becomes actionable after verification', async () => {
  const prisma = fakePrisma(); const events = []; const mails = []; const notifierCalls = [];
  const service = serviceFor(prisma, { events, mails, notifierCalls });
  const result = await service.requestRegistration({ submittedName: 'Applicant Name', email: 'NEW.USER@EXAMPLE.TEST', password: 'long-password-for-test', departmentHint: 'Security A' });
  assert.deepEqual(result, genericRegistrationSuccess);
  assert.equal(mails.length, 1);
  assert.match(mails[0].code, /^\d{6}$/);
  assert.equal(mails[0].purpose, 'REGISTRATION');
  assert.equal(prisma._requests.length, 1);
  assert.equal(prisma._users.length, 0);
  assert.equal(prisma._requests[0].status, 'PENDING');
  assert.equal(prisma._requests[0].matchedEmployeeId, null);
  assert.ok(await bcrypt.compare('long-password-for-test', prisma._requests[0].passwordHash));
  assert.equal(prisma._challenges.length, 1);
  assert.equal(prisma._challenges[0].deliveryState, 'SENT');

  const verified = await service.verifyRegistration({ email: 'new.user@example.test', code: mails[0].code });
  assert.equal(verified.registrationState, 'REQUEST_SUBMITTED');
  assert.ok(prisma._requests[0].emailVerifiedAt instanceof Date);
  assert.equal(notifierCalls.length, 1);
  assert.equal(events.some((event) => event.metadata?.event === 'REGISTRATION_REQUEST_EMAIL_VERIFIED'), true);
});

test('SMTP failure marks challenge FAILED, returns safe 503, and leaves the unverified request recoverable', async () => {
  const prisma = fakePrisma(); const mails = [];
  const service = serviceFor(prisma, { mails, failMail: true });
  await assert.rejects(
    () => service.requestRegistration({ submittedName: 'Applicant', email: 'smtp.fail@example.test', password: 'long-password-for-test' }),
    (error) => error.statusCode === 503 && /ไม่สามารถส่งรหัสยืนยัน/.test(error.message)
  );
  assert.equal(mails.length, 1);
  assert.equal(prisma._requests.length, 1);
  assert.equal(prisma._requests[0].emailVerifiedAt, null);
  assert.equal(prisma._challenges.length, 1);
  assert.equal(prisma._challenges[0].deliveryState, 'FAILED');
});

test('existing unverified request resends OTP without duplicating request or overwriting passwordHash; old OTP stays invalid', async () => {
  const prisma = fakePrisma(); const mails = []; const notifierCalls = [];
  const service = serviceFor(prisma, { mails, notifierCalls });
  await service.requestRegistration({ submittedName: 'Applicant', email: 'resend@example.test', password: 'original-password' });
  const originalHash = prisma._requests[0].passwordHash;
  const oldCode = mails[0].code;
  await service.requestRegistration({ submittedName: 'Changed Name', email: 'resend@example.test', password: 'attacker-password' });
  const newCode = mails[1].code;
  assert.equal(prisma._requests.length, 1);
  assert.equal(prisma._requests[0].passwordHash, originalHash);
  assert.equal(prisma._requests[0].submittedName, 'Applicant');
  assert.equal(mails.length, 2);
  assert.notEqual(prisma._challenges[0].id, prisma._challenges[1].id);
  assert.ok(prisma._challenges[0].expiresAt <= prisma._challenges[1].createdAt);
  assert.equal(prisma._challenges[1].deliveryState, 'SENT');
  await expectInvalid(() => service.verifyRegistration({ email: 'resend@example.test', code: oldCode }));
  const verified = await service.verifyRegistration({ email: 'resend@example.test', code: newCode });
  assert.equal(verified.registrationState, 'REQUEST_SUBMITTED');
  await expectInvalid(() => service.verifyRegistration({ email: 'resend@example.test', code: oldCode }));
  assert.equal(notifierCalls.length, 1);
});

test('verified pending request may resend ownership OTP but returns REQUEST_PENDING and does not duplicate reviewer notification', async () => {
  const prisma = fakePrisma(); const mails = []; const notifierCalls = [];
  const service = serviceFor(prisma, { mails, notifierCalls });
  await service.requestRegistration({ submittedName: 'Applicant', email: 'pending@example.test', password: 'long-password-for-test' });
  assert.equal((await service.verifyRegistration({ email: 'pending@example.test', code: mails[0].code })).registrationState, 'REQUEST_SUBMITTED');
  assert.equal(notifierCalls.length, 1);
  await service.requestRegistration({ submittedName: 'Other', email: 'pending@example.test', password: 'different-password' });
  const result = await service.verifyRegistration({ email: 'pending@example.test', code: mails[1].code });
  assert.equal(result.registrationState, 'REQUEST_PENDING');
  assert.equal(prisma._requests.length, 1);
  assert.equal(notifierCalls.length, 1);
});

test('existing User same email receives ownership OTP, then EXISTING_ACCOUNT, with no request or User mutation', async () => {
  const user = { id: 'user-1', email: 'active@example.test', accountStatus: 'ACTIVE', isActive: true, displayName: 'Existing', tokenVersion: 2 };
  const prisma = fakePrisma({ users: [user] }); const mails = [];
  const before = JSON.stringify(prisma._users);
  const service = serviceFor(prisma, { mails });
  const requested = await service.requestRegistration({ submittedName: 'Applicant', email: 'active@example.test', password: 'long-password-for-test' });
  assert.deepEqual(requested, genericRegistrationSuccess);
  assert.equal(mails.length, 1);
  assert.equal(prisma._requests.length, 0);
  const verified = await service.verifyRegistration({ email: 'active@example.test', code: mails[0].code });
  assert.equal(verified.registrationState, 'EXISTING_ACCOUNT');
  assert.equal(prisma._requests.length, 0);
  assert.equal(JSON.stringify(prisma._users), before);
});

test('unique exact normalized Employee name already linked to User blocks new-email duplicate before Admin review without auto-link or email takeover', async () => {
  const employee = { id: 'employee-1', firstName: 'สมชาย', lastName: 'ใจดี', displayName: 'ชื่อแสดงผลอื่น', isActive: true, deletedAt: null };
  const user = { id: 'user-1', email: 'old@example.test', employeeId: 'employee-1', isActive: true, accountStatus: 'ACTIVE' };
  const prisma = fakePrisma({ users: [user], employees: [employee] }); const mails = []; const notifierCalls = []; const events = [];
  const userBefore = JSON.stringify(prisma._users); const employeeBefore = JSON.stringify(prisma._employees);
  const service = serviceFor(prisma, { mails, notifierCalls, events });
  await service.requestRegistration({ submittedName: '  สมชาย ใจดี  ', email: 'new@example.test', password: 'new-password-for-test' });
  const result = await service.verifyRegistration({ email: 'new@example.test', code: mails[0].code });
  assert.equal(result.registrationState, 'EMPLOYEE_ALREADY_HAS_ACCOUNT');
  assert.equal(prisma._users.length, 1);
  assert.equal(JSON.stringify(prisma._users), userBefore);
  assert.equal(JSON.stringify(prisma._employees), employeeBefore);
  assert.equal(prisma._requests.length, 1);
  assert.equal(prisma._requests[0].status, 'REJECTED');
  assert.equal(prisma._requests[0].passwordHash, null);
  assert.equal(prisma._requests[0].matchedEmployeeId, null);
  assert.equal(prisma._requests[0].rejectionReason, AUTO_DUPLICATE_ACCOUNT_REASON);
  assert.equal(notifierCalls.length, 0);
  assert.equal(events.some((event) => event.metadata?.event === 'REGISTRATION_DUPLICATE_ACCOUNT_BLOCKED' && event.actorUserId === null), true);
});

test('multiple Employees with same normalized name do not auto-reject or auto-match and proceed to Admin review', async () => {
  const employees = [
    { id: 'employee-1', firstName: 'Same', lastName: 'Name', displayName: 'Alias One', isActive: true, deletedAt: null },
    { id: 'employee-2', firstName: 'Same', lastName: 'Name', isActive: true, deletedAt: null }
  ];
  const users = [{ id: 'user-1', email: 'old@example.test', employeeId: 'employee-1' }];
  const prisma = fakePrisma({ users, employees }); const mails = []; const notifierCalls = [];
  const service = serviceFor(prisma, { mails, notifierCalls });
  await service.requestRegistration({ submittedName: 'same   name', email: 'ambiguous@example.test', password: 'long-password-for-test' });
  const result = await service.verifyRegistration({ email: 'ambiguous@example.test', code: mails[0].code });
  assert.equal(result.registrationState, 'REQUEST_SUBMITTED');
  assert.equal(prisma._requests[0].status, 'PENDING');
  assert.equal(prisma._requests[0].matchedEmployeeId, null);
  assert.equal(notifierCalls.length, 1);
});

test('unique exact Employee with no User and no exact Employee match both remain normal explicit Admin Match flows', async () => {
  for (const employees of [
    [{ id: 'employee-1', firstName: 'Unique', lastName: 'Person', displayName: 'Alias Unique', isActive: true, deletedAt: null }],
    []
  ]) {
    const prisma = fakePrisma({ employees }); const mails = []; const notifierCalls = [];
    const service = serviceFor(prisma, { mails, notifierCalls });
    await service.requestRegistration({ submittedName: employees.length ? 'Unique Person' : 'No Match Person', email: `${employees.length ? 'unique' : 'none'}@example.test`, password: 'long-password-for-test' });
    const result = await service.verifyRegistration({ email: `${employees.length ? 'unique' : 'none'}@example.test`, code: mails[0].code });
    assert.equal(result.registrationState, 'REQUEST_SUBMITTED');
    assert.equal(prisma._requests[0].status, 'PENDING');
    assert.equal(prisma._requests[0].matchedEmployeeId, null);
    assert.equal(notifierCalls.length, 1);
  }
});

test('REJECTED request may prove ownership again but remains rejected and creates no second request', async () => {
  const request = { id: 'registration-1', submittedName: 'Rejected', email: 'rejected@example.test', passwordHash: null, status: 'REJECTED', emailVerifiedAt: new Date(), rejectedAt: new Date(), rejectionReason: 'manual rejection' };
  const prisma = fakePrisma({ requests: [request] }); const mails = [];
  const service = serviceFor(prisma, { mails });
  await service.requestRegistration({ submittedName: 'Changed', email: 'rejected@example.test', password: 'new-password-for-test' });
  const result = await service.verifyRegistration({ email: 'rejected@example.test', code: mails[0].code });
  assert.equal(result.registrationState, 'REQUEST_REJECTED');
  assert.equal(prisma._requests.length, 1);
  assert.equal(prisma._requests[0].rejectionReason, 'manual rejection');
});

test('APPROVED request without corresponding User returns REGISTRATION_SUPPORT_REQUIRED and does not reconstruct User', async () => {
  const request = { id: 'registration-1', submittedName: 'Approved', email: 'approved@example.test', passwordHash: null, status: 'APPROVED', emailVerifiedAt: new Date(), matchedEmployeeId: null, approvedAt: new Date() };
  const prisma = fakePrisma({ requests: [request] }); const mails = [];
  const service = serviceFor(prisma, { mails });
  await service.requestRegistration({ submittedName: 'Approved', email: 'approved@example.test', password: 'new-password-for-test' });
  const result = await service.verifyRegistration({ email: 'approved@example.test', code: mails[0].code });
  assert.equal(result.registrationState, 'REGISTRATION_SUPPORT_REQUIRED');
  assert.equal(prisma._users.length, 0);
});

test('OTP backend rate limit remains authoritative and every resend counts', async () => {
  const prisma = fakePrisma(); const mails = [];
  const service = serviceFor(prisma, { mails, configuration: { ...config, otpRequestLimitPerHour: 2 } });
  await service.requestRegistration({ submittedName: 'Rate Limit', email: 'rate@example.test', password: 'long-password-for-test' });
  await service.requestRegistration({ submittedName: 'Rate Limit', email: 'rate@example.test', password: 'long-password-for-test' });
  await assert.rejects(
    () => service.requestRegistration({ submittedName: 'Rate Limit', email: 'rate@example.test', password: 'long-password-for-test' }),
    (error) => error.statusCode === 429 && /ส่งรหัสยืนยันบ่อยเกินไป/.test(error.message)
  );
  assert.equal(mails.length, 2);
  assert.equal(prisma._requests.length, 1);
});

test('PASSWORD_RESET uses the same single-active OTP invariant: old code invalid after resend and after newest consume', async () => {
  const oldHash = await bcrypt.hash('old-password-for-test', 4);
  const prisma = fakePrisma({ users: [{ id: 'user-1', email: 'reset@example.test', passwordHash: oldHash, isActive: true, accountStatus: 'ACTIVE', tokenVersion: 2, failedLoginCount: 3 }] });
  const mails = []; const service = serviceFor(prisma, { mails });
  await service.requestPasswordReset({ email: 'reset@example.test' });
  const oldCode = mails[0].code;
  await service.requestPasswordReset({ email: 'reset@example.test' });
  const newCode = mails[1].code;
  await expectInvalid(() => service.completePasswordReset({ email: 'reset@example.test', code: oldCode, newPassword: 'ignored-password' }));
  await service.completePasswordReset({ email: 'reset@example.test', code: newCode, newPassword: 'new-password-for-test' });
  assert.ok(await bcrypt.compare('new-password-for-test', prisma._users[0].passwordHash));
  await expectInvalid(() => service.completePasswordReset({ email: 'reset@example.test', code: oldCode, newPassword: 'another-password' }));
});

test('OTP audit metadata contains no OTP digits, codeHash, password, SMTP password, or token material', async () => {
  const prisma = fakePrisma(); const events = []; const mails = [];
  const service = serviceFor(prisma, { events, mails });
  await service.requestRegistration({ submittedName: 'Audit Applicant', email: 'audit@example.test', password: 'secret-password' });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes(mails[0].code), false);
  assert.equal(/codeHash|secret-password|smtpPassword|token/i.test(serialized), false);
  assert.equal(events.some((event) => event.metadata?.event === 'OTP_CHALLENGE_CREATED'), true);
});


test('verified MATCHED request resend preserves matchedEmployeeId/review state and returns REQUEST_PENDING', async () => {
  const matchedAt = new Date('2026-08-01T00:00:00Z');
  const request = { id: 'registration-1', submittedName: 'Matched', email: 'matched@example.test', passwordHash: 'preserved-hash', status: 'MATCHED', emailVerifiedAt: new Date(), matchedEmployeeId: 'employee-1', reviewedByUserId: 'manager-1', reviewedAt: matchedAt };
  const prisma = fakePrisma({ requests: [request] }); const mails = []; const notifierCalls = [];
  const service = serviceFor(prisma, { mails, notifierCalls });
  await service.requestRegistration({ submittedName: 'Changed', email: 'matched@example.test', password: 'new-password-for-test' });
  const result = await service.verifyRegistration({ email: 'matched@example.test', code: mails[0].code });
  assert.equal(result.registrationState, 'REQUEST_PENDING');
  assert.equal(prisma._requests.length, 1);
  assert.equal(prisma._requests[0].status, 'MATCHED');
  assert.equal(prisma._requests[0].matchedEmployeeId, 'employee-1');
  assert.equal(prisma._requests[0].reviewedByUserId, 'manager-1');
  assert.equal(prisma._requests[0].reviewedAt, matchedAt);
  assert.equal(prisma._requests[0].passwordHash, 'preserved-hash');
  assert.equal(notifierCalls.length, 0);
});

test('APPROVED request with corresponding linked Employee User returns EXISTING_ACCOUNT without reconstructing or mutating User', async () => {
  const request = { id: 'registration-1', submittedName: 'Approved', email: 'historic-approved@example.test', passwordHash: null, status: 'APPROVED', emailVerifiedAt: new Date(), matchedEmployeeId: 'employee-1', approvedAt: new Date() };
  const user = { id: 'user-1', email: 'current-account@example.test', employeeId: 'employee-1', role: 'VIEWER' };
  const employee = { id: 'employee-1', displayName: 'Approved Person', isActive: true, deletedAt: null };
  const prisma = fakePrisma({ requests: [request], users: [user], employees: [employee] }); const mails = [];
  const before = JSON.stringify(prisma._users);
  const service = serviceFor(prisma, { mails });
  await service.requestRegistration({ submittedName: 'Approved', email: 'historic-approved@example.test', password: 'ignored-password' });
  const result = await service.verifyRegistration({ email: 'historic-approved@example.test', code: mails[0].code });
  assert.equal(result.registrationState, 'EXISTING_ACCOUNT');
  assert.equal(JSON.stringify(prisma._users), before);
});
