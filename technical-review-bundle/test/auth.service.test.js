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
    update: async ({ where, data }) => { const user = users.find((item) => item.id === where.id); if (data.failedLoginCount?.increment) user.failedLoginCount += data.failedLoginCount.increment; else Object.assign(user, data); return user; }
  },
  refreshSession: { create: async ({ data }) => { sessions.push({ id: `session-${sessions.length}`, ...data }); return sessions.at(-1); } },
  auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  $transaction: async (operations) => Array.isArray(operations) ? Promise.all(operations) : operations(fakePrisma)
};
require.cache[require.resolve('../src/config/prisma')] = { exports: fakePrisma };
const auth = require('../src/services/auth.service');
const { authenticate } = require('../src/middlewares/authenticate');
const env = require('../src/config/env');

test.before(async () => { users.push({ id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.com', passwordHash: await bcrypt.hash('correct-password', 4), displayName: 'Admin', role: 'ADMIN', isActive: true, tokenVersion: 0, failedLoginCount: 0 }); });
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
