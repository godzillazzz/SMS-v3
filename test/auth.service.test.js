process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const users = [];
const audits = [];
const sessions = [];
const fakePrisma = {
  user: {
    findUnique: async ({ where }) => users.find((user) => user.email === where.email || user.id === where.id) || null,
    update: async ({ where, data }) => { const user = users.find((item) => item.id === where.id); if (data.failedLoginCount?.increment) user.failedLoginCount += data.failedLoginCount.increment; else if (data.tokenVersion?.increment) user.tokenVersion += data.tokenVersion.increment; else Object.assign(user, data); return user; }
  },
  refreshSession: {
    create: async ({ data }) => { sessions.push({ id: `session-${sessions.length}`, revokedAt: null, lastUsedAt: null, ...data }); return sessions.at(-1); },
    findUnique: async ({ where }) => { const session = sessions.find((item) => item.refreshTokenHash === where.refreshTokenHash); return session ? { ...session, user: users.find((item) => item.id === session.userId) } : null; },
    update: async ({ where, data }) => { const session = sessions.find((item) => item.id === where.id); Object.assign(session, data); return session; },
    updateMany: async ({ where, data }) => { const matches = sessions.filter((item) => item.userId === where.userId && (where.revokedAt !== null || item.revokedAt === null)); matches.forEach((item) => Object.assign(item, data)); return { count: matches.length }; }
  },
  auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  $transaction: async (operations) => Array.isArray(operations) ? Promise.all(operations) : operations(fakePrisma)
};
require.cache[require.resolve('../src/config/prisma')] = { exports: fakePrisma };
const auth = require('../src/services/auth.service');
const audit = require('../src/services/audit.service');
const { authenticate } = require('../src/middlewares/authenticate');
const env = require('../src/config/env');

test.before(async () => { users.push({ id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.com', passwordHash: await bcrypt.hash('correct-password', 4), displayName: 'Admin', role: 'ADMIN', accountStatus: 'ACTIVE', passwordResetRequired: false, isActive: true, tokenVersion: 0, failedLoginCount: 0 }); });
test('successful login issues constrained access/refresh tokens and creates an audit record', async () => {
  const result = await auth.login('admin@example.com', 'correct-password', 'req-1');
  const claims = jwt.verify(result.accessToken, env.jwtSecret, { algorithms: [env.jwtAlgorithm], issuer: env.jwtIssuer, audience: env.jwtAudience });
  assert.equal(claims.tokenVersion, 0); assert.equal(users[0].failedLoginCount, 0); assert.equal(audits.at(-1).action, 'LOGIN'); assert.equal(result.user.passwordHash, undefined); assert.ok(result.refreshToken); assert.equal(sessions[0].refreshTokenHash.includes(result.refreshToken), false);
});
test('failed and inactive login share one public error and are audited', async () => {
  await assert.rejects(() => auth.login('admin@example.com', 'wrong', 'req-2'), { message: auth.genericFailure });
  users[0].isActive = false;
  await assert.rejects(() => auth.login('admin@example.com', 'correct-password', 'req-3'), { message: auth.genericFailure });
  users[0].isActive = true;
  assert.equal(audits.filter((entry) => entry.action === 'LOGIN_FAILED').length, 2);
});
test('an imported account requiring password reset cannot log in', async () => {
  users[0].passwordResetRequired = true;
  await assert.rejects(() => auth.login('admin@example.com', 'correct-password', 'req-reset'), { message: auth.genericFailure });
  users[0].passwordResetRequired = false;
});
test('refresh, logout, and logout-all create sanitized audit records', async () => {
  const first = await auth.login('admin@example.com', 'correct-password', 'req-session-1');
  const refreshed = await auth.refresh(first.refreshToken, 'req-session-2');
  await auth.logout(refreshed.refreshToken, 'req-session-3');
  const second = await auth.login('admin@example.com', 'correct-password', 'req-session-4');
  await auth.logoutAll(users[0].id, 'req-session-5');
  assert.ok(second.refreshToken);
  assert.deepEqual(audits.slice(-5).map((entry) => entry.action), ['LOGIN', 'REFRESH', 'LOGOUT', 'LOGIN', 'LOGOUT_ALL']);
  const sanitized = audit.safeMetadata({ requestId: 'safe-request', nested: { password: 'fixture', refreshToken: 'fixture', cookie: 'fixture', allowed: true } });
  assert.deepEqual(sanitized, { requestId: 'safe-request', nested: { allowed: true } });
});
test('middleware rejects expired, tampered, and token-version-mismatched JWTs', async () => {
  const run = (token) => new Promise((resolve) => authenticate({ headers: { authorization: `Bearer ${token}` } }, {}, (error) => resolve(error)));
  const base = { sub: users[0].id, email: users[0].email, role: users[0].role, tokenVersion: 0 };
  const expired = jwt.sign(base, env.jwtSecret, { algorithm: env.jwtAlgorithm, expiresIn: -1, issuer: env.jwtIssuer, audience: env.jwtAudience });
  assert.equal((await run(expired)).statusCode, 401);
  const valid = jwt.sign(base, env.jwtSecret, { algorithm: env.jwtAlgorithm, expiresIn: '1h', issuer: env.jwtIssuer, audience: env.jwtAudience });
  assert.equal((await run(`${valid}x`)).statusCode, 401);
  users[0].tokenVersion = 1;
  assert.equal((await run(valid)).statusCode, 401);
  users[0].tokenVersion = 0;
});
test('View As tokens require an active Admin and reject every mutation', async () => {
  const viewer = { id: '22222222-2222-4222-8222-222222222222', email: 'viewer@example.com', displayName: 'Sample Viewer', role: 'VIEWER', accountStatus: 'ACTIVE', passwordResetRequired: false, isActive: true, tokenVersion: 0 };
  users.push(viewer);
  const token = auth.accessTokenFor(viewer, { impersonatorSub: users[0].id, impersonatorTokenVersion: users[0].tokenVersion, expiresIn: '10m' });
  const run = (method) => new Promise((resolve) => { const req = { method, headers: { authorization: `Bearer ${token}` } }; authenticate(req, {}, (error) => resolve({ error, req })); });
  const read = await run('GET');
  assert.equal(read.error, undefined);
  assert.equal(read.req.user.impersonation, true);
  const mutation = await run('POST');
  assert.equal(mutation.error.statusCode, 403);
  users[0].tokenVersion += 1;
  assert.equal((await run('GET')).error.statusCode, 401);
  users[0].tokenVersion -= 1;
});
