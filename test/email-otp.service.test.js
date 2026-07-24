process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { createOtpService } = require('../src/services/email-otp.service');

function fakePrisma(initialUsers = []) {
  const users = initialUsers.map((user) => ({ ...user }));
  const challenges = [];
  const sessions = [];
  const tx = {
    user: {
      findUnique: async ({ where }) => users.find((user) => user.email === where.email || user.id === where.id) || null,
      create: async ({ data }) => { const user = { id: `user-${users.length + 1}`, tokenVersion: 0, failedLoginCount: 0, ...data }; users.push(user); return user; },
      update: async ({ where, data }) => { const user = users.find((entry) => entry.id === where.id); Object.entries(data).forEach(([key, value]) => { if (value && typeof value === 'object' && 'increment' in value) user[key] = (user[key] || 0) + value.increment; else user[key] = value; }); return user; }
    },
    authOtpChallenge: {
      count: async ({ where }) => challenges.filter((item) => item.emailHash === where.emailHash && item.purpose === where.purpose && item.createdAt >= where.createdAt.gte).length,
      create: async ({ data }) => { const challenge = { id: `otp-${challenges.length + 1}`, attempts: 0, consumedAt: null, createdAt: new Date(), ...data }; challenges.push(challenge); return challenge; },
      update: async ({ where, data }) => { const challenge = challenges.find((item) => item.id === where.id); Object.entries(data).forEach(([key, value]) => { if (value && typeof value === 'object' && 'increment' in value) challenge[key] += value.increment; else challenge[key] = value; }); return challenge; },
      findFirst: async ({ where }) => challenges.filter((item) => item.emailHash === where.emailHash && item.purpose === where.purpose && item.consumedAt === null).sort((a, b) => b.createdAt - a.createdAt)[0] || null
    },
    refreshSession: { updateMany: async ({ where, data }) => { sessions.push({ where, data }); return { count: 0 }; } }
  };
  return { ...tx, $transaction: async (operation) => typeof operation === 'function' ? operation(tx) : Promise.all(operation), _users: users, _challenges: challenges, _sessions: sessions };
}

const config = { otpDeliveryProvider: 'gmail_smtp', otpHashSecret: 'otp-test-secret-that-is-at-least-thirty-two-characters', otpCodeExpiresMinutes: 10, otpMaxAttempts: 5, otpRequestLimitPerHour: 5 };
const auditService = { log: async () => undefined };

test('registration sends a one-time email code and leaves the account pending after verification', async () => {
  const prisma = fakePrisma(); let delivered;
  const service = createOtpService({ prismaClient: prisma, auditService, configuration: config, mailer: { send: async (message) => { delivered = message; } } });
  await service.requestRegistration({ displayName: 'New User', email: 'new.user@example.test', password: 'long-password-for-test', department: 'Operations' });
  assert.equal(delivered.purpose, 'REGISTRATION'); assert.match(delivered.code, /^\d{6}$/);
  assert.equal(prisma._users[0].accountStatus, 'PENDING'); assert.equal(prisma._users[0].isActive, false);
  assert.equal(Object.prototype.hasOwnProperty.call(prisma._challenges[0], 'code'), false);
  await service.verifyRegistration({ email: 'new.user@example.test', code: delivered.code });
  assert.ok(prisma._challenges[0].consumedAt);
});

test('password reset consumes the email OTP, rotates token version, and revokes sessions', async () => {
  const oldHash = await bcrypt.hash('old-password-for-test', 10);
  const prisma = fakePrisma([{ id: 'user-1', email: 'active@example.test', passwordHash: oldHash, isActive: true, accountStatus: 'ACTIVE', tokenVersion: 2, failedLoginCount: 3 }]); let delivered;
  const service = createOtpService({ prismaClient: prisma, auditService, configuration: config, mailer: { send: async (message) => { delivered = message; } } });
  await service.requestPasswordReset({ email: 'active@example.test' });
  await service.completePasswordReset({ email: 'active@example.test', code: delivered.code, newPassword: 'new-password-for-test' });
  assert.ok(await bcrypt.compare('new-password-for-test', prisma._users[0].passwordHash));
  assert.equal(prisma._users[0].tokenVersion, 3); assert.equal(prisma._users[0].failedLoginCount, 0);
  assert.equal(prisma._sessions.length, 1); assert.ok(prisma._challenges[0].consumedAt);
});

test('invalid OTP codes are rejected without exposing stored code material', async () => {
  const prisma = fakePrisma(); let delivered;
  const service = createOtpService({ prismaClient: prisma, auditService, configuration: config, mailer: { send: async (message) => { delivered = message; } } });
  await service.requestRegistration({ displayName: 'New User', email: 'new.user@example.test', password: 'long-password-for-test' });
  await assert.rejects(() => service.verifyRegistration({ email: 'new.user@example.test', code: delivered.code === '000000' ? '111111' : '000000' }), { message: 'Invalid or expired verification code.' });
  assert.equal(prisma._challenges[0].attempts, 1);
});
