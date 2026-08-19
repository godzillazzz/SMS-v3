const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const HttpError = require('../src/utils/http-error');
const { createWebAuthnService, challengeHash, expectedChallenge } = require('../src/services/webauthn.service');

const UUID_USER = '11111111-1111-4111-8111-111111111111';
const UUID_CRED = '22222222-2222-4222-8222-222222222222';
const UUID_CHALLENGE = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-08-19T04:30:00.000Z');
const config = {
  webAuthnEnabled: true,
  webAuthnRpName: 'SMS',
  webAuthnRpId: 'localhost',
  webAuthnOrigin: 'http://localhost:5173',
  webAuthnChallengeTtlSeconds: 300
};

function fakeDb(overrides = {}) {
  const state = {
    challenges: [], credentials: [], audits: [],
    user: { id: UUID_USER, email: 'uat@example.test', displayName: 'UAT User', passwordHash: overrides.passwordHash || '$2a$04$abcdefghijklmnopqrstuuPfeGafcpKdfu5tVZ5Qfofd9S8nqgZ2', isActive: true, accountStatus: 'ACTIVE', passwordResetRequired: false },
    ...overrides.state
  };
  let challengeIndex = 0;
  const tx = {};
  const prisma = {
    user: {
      findUnique: async ({ where, select }) => {
        if (where.id !== state.user.id) return null;
        if (select?.passwordHash) return { passwordHash: state.user.passwordHash };
        return { ...state.user };
      }
    },
    webAuthnChallenge: {
      create: async ({ data }) => { const row = { id: challengeIndex++ ? '44444444-4444-4444-8444-444444444444' : UUID_CHALLENGE, ...data, consumedAt: null, createdAt: now }; state.challenges.push(row); return { id: row.id }; },
      findUnique: async ({ where }) => state.challenges.find((item) => item.id === where.id) || null,
      updateMany: async ({ where, data }) => { const row = state.challenges.find((item) => item.id === where.id); if (!row || row.consumedAt || row.expiresAt <= now) return { count: 0 }; row.consumedAt = data.consumedAt; return { count: 1 }; }
    },
    webAuthnCredential: {
      findMany: async ({ where }) => state.credentials.filter((item) => item.userId === where.userId && !item.revokedAt).map((item) => ({ ...item })),
      findUnique: async ({ where }) => { const row = state.credentials.find((item) => item.credentialId === where.credentialId); return row ? { ...row, user: { ...state.user } } : null; },
      create: async ({ data }) => { if (state.credentials.some((item) => item.credentialId === data.credentialId)) { const error = new Error('unique'); error.code = 'P2002'; throw error; } const row = { id: UUID_CRED, createdAt: now, lastUsedAt: null, revokedAt: null, ...data }; state.credentials.push(row); return { id: row.id, displayName: row.displayName, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt }; },
      update: async ({ where, data }) => { const row = state.credentials.find((item) => item.id === where.id); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => { const row = state.credentials.find((item) => item.id === where.id && item.userId === where.userId && !item.revokedAt); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }
    },
    $transaction: async (callback) => callback(tx)
  };
  Object.assign(tx, prisma);
  const auditService = { log: async (event) => { state.audits.push(event); } };
  return { prisma, state, auditService };
}

function fakeServer(overrides = {}) {
  const calls = { registrationOptions: [], registrationVerify: [], authenticationOptions: [], authenticationVerify: [] };
  return {
    calls,
    generateRegistrationOptions: async (options) => { calls.registrationOptions.push(options); return { challenge: 'register-challenge', rp: { id: options.rpID }, user: { id: 'u', name: options.userName, displayName: options.userDisplayName }, pubKeyCredParams: [], authenticatorSelection: options.authenticatorSelection, excludeCredentials: options.excludeCredentials }; },
    verifyRegistrationResponse: async (options) => { calls.registrationVerify.push(options); if (overrides.registrationError) throw overrides.registrationError; return overrides.registrationResult || { verified: true, registrationInfo: { userVerified: true, credential: { id: 'credential-one', publicKey: Uint8Array.from([1, 2, 3]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'multiDevice', credentialBackedUp: true } }; },
    generateAuthenticationOptions: async (options) => { calls.authenticationOptions.push(options); return { challenge: 'auth-challenge', rpId: options.rpID, allowCredentials: options.allowCredentials, userVerification: options.userVerification }; },
    verifyAuthenticationResponse: async (options) => { calls.authenticationVerify.push(options); if (overrides.authenticationError) throw overrides.authenticationError; return overrides.authenticationResult || { verified: true, authenticationInfo: { userVerified: true, newCounter: 4, credentialDeviceType: 'multiDevice', credentialBackedUp: true } }; }
  };
}

async function passwordHash(value = 'CorrectPassword!9') { return bcrypt.hash(value, 4); }
function serviceWith(db, server, authService = { loginVerifiedUser: async () => ({ accessToken: 'token', refreshToken: 'refresh', user: { id: UUID_USER } }) }) {
  return createWebAuthnService({ prismaClient: db.prisma, auditService: db.auditService, webAuthnServer: server, authService, config, clock: () => now });
}

async function expectHttp(promise, status) {
  await assert.rejects(promise, (error) => error instanceof HttpError && error.statusCode === status);
}

test('challenge matcher stores/compares only SHA-256 form', () => {
  const hash = challengeHash('secret-challenge');
  assert.equal(hash.length, 64);
  assert.equal(expectedChallenge(hash)('secret-challenge'), true);
  assert.equal(expectedChallenge(hash)('wrong'), false);
  assert.equal(hash.includes('secret-challenge'), false);
});

test('registration options require authenticated user password step-up and user verification', async () => {
  const db = fakeDb({ passwordHash: await passwordHash() });
  const server = fakeServer();
  const service = serviceWith(db, server);
  const result = await service.registrationOptions({ userId: UUID_USER, currentPassword: 'CorrectPassword!9', displayName: 'iPhone' });
  assert.equal(result.challengeId, UUID_CHALLENGE);
  assert.equal(db.state.challenges.length, 1);
  assert.equal(db.state.challenges[0].challengeHash, challengeHash('register-challenge'));
  assert.equal(db.state.challenges[0].userId, UUID_USER);
  assert.equal(server.calls.registrationOptions[0].rpID, 'localhost');
  assert.equal(server.calls.registrationOptions[0].authenticatorSelection.userVerification, 'required');
  assert.equal(server.calls.registrationOptions[0].authenticatorSelection.residentKey, 'required');
  assert.equal(db.state.challenges[0].challenge, undefined);
  await expectHttp(service.registrationOptions({ userId: UUID_USER, currentPassword: 'wrong', displayName: 'x' }), 401);
});

test('registration challenge expires and is single-use', async () => {
  const db = fakeDb({ passwordHash: await passwordHash() });
  const server = fakeServer();
  const service = serviceWith(db, server);
  const options = await service.registrationOptions({ userId: UUID_USER, currentPassword: 'CorrectPassword!9', displayName: 'Laptop' });
  db.state.challenges[0].expiresAt = new Date(now.getTime() - 1);
  await expectHttp(service.verifyRegistration({ userId: UUID_USER, challengeId: options.challengeId, response: {}, displayName: 'Laptop' }), 400);
  db.state.challenges[0].expiresAt = new Date(now.getTime() + 10000);
  await service.verifyRegistration({ userId: UUID_USER, challengeId: options.challengeId, response: { response: { transports: ['internal'] } }, displayName: 'Laptop' });
  await expectHttp(service.verifyRegistration({ userId: UUID_USER, challengeId: options.challengeId, response: {}, displayName: 'Laptop' }), 400);
});

test('registration verifier pins origin, RP ID, and user verification and stores no biometric/private material', async () => {
  const db = fakeDb({ passwordHash: await passwordHash() });
  const server = fakeServer();
  const service = serviceWith(db, server);
  const options = await service.registrationOptions({ userId: UUID_USER, currentPassword: 'CorrectPassword!9', displayName: 'Phone' });
  await service.verifyRegistration({ userId: UUID_USER, challengeId: options.challengeId, response: { response: { transports: ['internal'] } }, displayName: 'Phone' });
  const verify = server.calls.registrationVerify[0];
  assert.equal(verify.expectedOrigin, 'http://localhost:5173');
  assert.equal(verify.expectedRPID, 'localhost');
  assert.equal(verify.requireUserVerification, true);
  assert.equal(verify.expectedChallenge('register-challenge'), true);
  assert.equal(verify.expectedChallenge('replay-or-wrong'), false);
  const stored = db.state.credentials[0];
  assert.deepEqual([...stored.publicKey], [1, 2, 3]);
  for (const forbidden of ['face', 'photo', 'biometric', 'privateKey', 'signature', 'challenge']) assert.equal(Object.hasOwn(stored, forbidden), false);
  assert.equal(db.state.audits[0].action, 'PASSKEY_REGISTERED');
  assert.equal(JSON.stringify(db.state.audits).includes('register-challenge'), false);
});

test('wrong origin/RP/invalid registration verification fails closed', async () => {
  for (const message of ['Unexpected origin', 'Unexpected RP ID hash', 'Invalid signature']) {
    const db = fakeDb({ passwordHash: await passwordHash() });
    const server = fakeServer({ registrationError: new Error(message) });
    const service = serviceWith(db, server);
    const options = await service.registrationOptions({ userId: UUID_USER, currentPassword: 'CorrectPassword!9', displayName: 'Phone' });
    await expectHttp(service.verifyRegistration({ userId: UUID_USER, challengeId: options.challengeId, response: {}, displayName: 'Phone' }), 400);
    assert.ok(db.state.challenges[0].consumedAt, 'failed verification consumes the registration challenge');
    const verifyCallCount = server.calls.registrationVerify.length;
    await expectHttp(service.verifyRegistration({ userId: UUID_USER, challengeId: options.challengeId, response: {}, displayName: 'Phone' }), 400);
    assert.equal(server.calls.registrationVerify.length, verifyCallCount, 'replay is rejected before cryptographic verification');
    assert.equal(db.state.credentials.length, 0);
  }
});

test('credential ID is unique while multiple distinct passkeys per user are supported', async () => {
  const db = fakeDb({ passwordHash: await passwordHash() });
  let index = 0;
  const server = fakeServer();
  server.verifyRegistrationResponse = async () => ({ verified: true, registrationInfo: { userVerified: true, credential: { id: index++ ? 'credential-two' : 'credential-one', publicKey: Uint8Array.from([1]), counter: 0 }, credentialDeviceType: 'singleDevice', credentialBackedUp: false } });
  const service = serviceWith(db, server);
  for (const name of ['Phone', 'Laptop']) {
    const o = await service.registrationOptions({ userId: UUID_USER, currentPassword: 'CorrectPassword!9', displayName: name });
    await service.verifyRegistration({ userId: UUID_USER, challengeId: o.challengeId, response: {}, displayName: name });
  }
  assert.equal(db.state.credentials.length, 2);
  assert.deepEqual((await service.listCredentials(UUID_USER)).map((row) => row.displayName), ['Phone', 'Laptop']);
});

test('discoverable authentication options contain no email/user enumeration and require UV', async () => {
  const db = fakeDb(); const server = fakeServer(); const service = serviceWith(db, server);
  const result = await service.authenticationOptions();
  assert.equal(result.challengeId, UUID_CHALLENGE);
  const input = server.calls.authenticationOptions[0];
  assert.deepEqual(input.allowCredentials, []);
  assert.equal(input.userVerification, 'required');
  assert.equal(JSON.stringify(result).includes('uat@example.test'), false);
  assert.equal(db.state.challenges[0].userId, null);
});

test('unknown and revoked credentials fail with minimal public error', async () => {
  const db = fakeDb(); const server = fakeServer(); const service = serviceWith(db, server);
  const options = await service.authenticationOptions();
  await assert.rejects(service.verifyAuthentication({ challengeId: options.challengeId, response: { id: 'unknown' }, requestId: 'r1', request: {} }), (error) => error.statusCode === 401 && error.message === 'ไม่สามารถเข้าสู่ระบบด้วย Passkey ได้');
  db.state.credentials.push({ id: UUID_CRED, userId: UUID_USER, credentialId: 'revoked', publicKey: Buffer.from([1]), counter: 0n, revokedAt: now });
  const next = await service.authenticationOptions();
  await assert.rejects(service.verifyAuthentication({ challengeId: next.challengeId, response: { id: 'revoked' }, requestId: 'r2', request: {} }), (error) => error.statusCode === 401 && error.message === 'ไม่สามารถเข้าสู่ระบบด้วย Passkey ได้');
});

test('successful passkey authentication verifies origin/RP/UV, advances counter, and uses normal SMS session path', async () => {
  const db = fakeDb();
  db.state.credentials.push({ id: UUID_CRED, userId: UUID_USER, credentialId: 'credential-one', publicKey: Buffer.from([9, 8]), counter: 2n, transports: ['internal'], revokedAt: null });
  const server = fakeServer();
  const calls = [];
  const authService = { loginVerifiedUser: async (...args) => { calls.push(args); return { accessToken: 'token', refreshToken: 'refresh', user: { id: UUID_USER } }; } };
  const service = serviceWith(db, server, authService);
  const options = await service.authenticationOptions();
  const result = await service.verifyAuthentication({ challengeId: options.challengeId, response: { id: 'credential-one' }, requestId: 'request-1', request: { userAgent: 'test' } });
  assert.equal(result.accessToken, 'token');
  const verify = server.calls.authenticationVerify[0];
  assert.equal(verify.expectedOrigin, 'http://localhost:5173');
  assert.equal(verify.expectedRPID, 'localhost');
  assert.equal(verify.requireUserVerification, true);
  assert.equal(verify.advancedFIDOConfig.userVerification, 'required');
  assert.equal(verify.expectedChallenge('auth-challenge'), true);
  assert.equal(db.state.credentials[0].counter, 4n);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], UUID_USER);
  assert.equal(calls[0][3].auditAction, 'PASSKEY_LOGIN_SUCCESS');
});

test('invalid assertion signature/origin/RP is rejected and sanitized audit contains no signature/challenge', async () => {
  const db = fakeDb();
  db.state.credentials.push({ id: UUID_CRED, userId: UUID_USER, credentialId: 'credential-one', publicKey: Buffer.from([9]), counter: 0n, revokedAt: null });
  const server = fakeServer({ authenticationError: new Error('Invalid signature / wrong origin') });
  const service = serviceWith(db, server);
  const options = await service.authenticationOptions();
  await expectHttp(service.verifyAuthentication({ challengeId: options.challengeId, response: { id: 'credential-one', response: { signature: 'secret-signature' } }, requestId: 'r', request: {} }), 401);
  assert.ok(db.state.challenges[0].consumedAt, 'failed assertion consumes the authentication challenge');
  const verifyCallCount = server.calls.authenticationVerify.length;
  await expectHttp(service.verifyAuthentication({ challengeId: options.challengeId, response: { id: 'credential-one', response: { signature: 'secret-signature' } }, requestId: 'r2', request: {} }), 400);
  assert.equal(server.calls.authenticationVerify.length, verifyCallCount, 'replayed assertion never reaches signature verification');
  const auditText = JSON.stringify(db.state.audits);
  assert.equal(auditText.includes('secret-signature'), false);
  assert.equal(auditText.includes('auth-challenge'), false);
  assert.equal(db.state.audits.at(-1).action, 'PASSKEY_LOGIN_FAILED');
});

test('inactive/non-ACTIVE/password-reset-required account rejection from authoritative session path is not bypassed', async () => {
  for (const policy of ['inactive', 'status', 'password-reset']) {
    const db = fakeDb();
    db.state.credentials.push({ id: UUID_CRED, userId: UUID_USER, credentialId: 'credential-one', publicKey: Buffer.from([1]), counter: 0n, revokedAt: null });
    const server = fakeServer();
    const authService = { loginVerifiedUser: async () => { throw new HttpError(401, `blocked-${policy}`); } };
    const service = serviceWith(db, server, authService);
    const options = await service.authenticationOptions();
    await expectHttp(service.verifyAuthentication({ challengeId: options.challengeId, response: { id: 'credential-one' }, requestId: 'r', request: {} }), 401);
    assert.equal(db.state.audits.at(-1).action, 'PASSKEY_LOGIN_FAILED');
  }
});

test('revoke requires password step-up and revoked passkey no longer authenticates', async () => {
  const password = 'CorrectPassword!9';
  const db = fakeDb({ passwordHash: await passwordHash(password) });
  db.state.credentials.push({ id: UUID_CRED, userId: UUID_USER, credentialId: 'credential-one', publicKey: Buffer.from([1]), counter: 0n, revokedAt: null, displayName: 'Phone' });
  const server = fakeServer(); const service = serviceWith(db, server);
  await expectHttp(service.revokeCredential({ userId: UUID_USER, credentialId: UUID_CRED, currentPassword: 'wrong' }), 401);
  await service.revokeCredential({ userId: UUID_USER, credentialId: UUID_CRED, currentPassword: password });
  assert.ok(db.state.credentials[0].revokedAt);
  assert.equal(db.state.audits.at(-1).action, 'PASSKEY_REVOKED');
  const options = await service.authenticationOptions();
  await expectHttp(service.verifyAuthentication({ challengeId: options.challengeId, response: { id: 'credential-one' }, requestId: 'r', request: {} }), 401);
});
